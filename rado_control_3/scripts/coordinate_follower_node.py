#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from std_msgs.msg import String, Bool
from geometry_msgs.msg import Twist, Point
from sensor_msgs.msg import NavSatFix
import os
import time

class MissionManager(Node):
    def __init__(self):
        super().__init__('coordinate_follower')

        # State machine
        self.internal_state = 'IDLE'
        self.mission_goals = []
        self.current_goal_index = -1

        # Dummy execution duration (seconds)
        self.drive_duration = 5.0
        self.drive_start_time = None

        # Position State (Defaults to BITS Goa if no mission loaded)
        self.current_lat = 15.3911
        self.current_lon = 73.8782
        self.start_lat = 0.0
        self.start_lon = 0.0
        self.target_lat = 0.0
        self.target_lon = 0.0

        home_dir = os.path.expanduser('~')
        self.mission_file_path = os.path.join(home_dir, 'flask_gcs', 'mission_plan.txt')

        # Publishers
        self.task_complete_pub = self.create_publisher(Bool, '/auto/task_complete', 10)
        self.velocity_pub = self.create_publisher(Twist, '/auto/cmd_vel', 10)
        # Keep a publisher for GCS if you need it for other signals (not used to self-trigger)
        self.gcs_command_pub = self.create_publisher(String, '/gcs/command', 10)

        # Subscribers
        self.create_subscription(String, '/rover_state', self.state_callback, 10)
        self.create_subscription(String, '/gcs/command', self.gcs_command_callback, 10)
        self.create_subscription(NavSatFix, '/mavros/global_position/global', self.mavros_gps_callback, 10)

        # Timer
        self.timer = self.create_timer(0.1, self.control_loop)  # 10Hz

        # Load mission and set initial internal state so PROCEED will be handled
        self.load_mission()

        # if mission exists, be ready to accept PROCEED; otherwise still ready (keeps UX simple)
        self.internal_state = 'WAITING_FOR_PROCEED'
        self.get_logger().info(f'Initialized. Internal state set to {self.internal_state}. '
                               f'Mission file: {self.mission_file_path}')

        if self.mission_goals:
            self.get_logger().info(f'Loaded {len(self.mission_goals)} goals. Waiting for PROCEED.')
        else:
            self.get_logger().info('No mission goals found; initialized at BITS Goa coords.')

    def load_mission(self):
        self.get_logger().info('Loading mission plan...')
        try:
            self.mission_goals = []
            # Ensure directory exists (helpful if Flask writes file)
            os.makedirs(os.path.dirname(self.mission_file_path), exist_ok=True)
            with open(self.mission_file_path, 'r') as f:
                for line in f:
                    parts = line.strip().split(',')
                    if len(parts) == 4:
                        try:
                            lat = float(parts[2])
                            lon = float(parts[3])
                            self.mission_goals.append(Point(x=lat, y=lon))
                        except ValueError:
                            self.get_logger().warn(f"Skipping invalid mission line: {line.strip()}")
            self.get_logger().info(f'Loaded {len(self.mission_goals)} goals.')
        except FileNotFoundError:
            self.get_logger().warn(f'Mission file not found: {self.mission_file_path}')
            self.mission_goals = []
        except Exception as e:
            self.get_logger().error(f'Failed to load mission file: {e}')
            self.mission_goals = []

    def gcs_command_callback(self, msg):
        command = msg.data.upper().strip()
        self.get_logger().info(f"Received /gcs/command: {command} (internal_state={self.internal_state})")

        # Accept PROCEED if we're IDLE or waiting for PROCEED (covers startup and normal)
        if command == 'PROCEED' and self.internal_state in ('WAITING_FOR_PROCEED', 'IDLE'):
            # Do not reset index here; continue from current index + 1
            self.load_mission()  # reload in case file changed
            # If we have no goals, log and ignore (or you can optionally start a test-run)
            if not self.mission_goals:
                self.get_logger().warn('PROCEED received but mission_goals empty.')
                return
            # Request next goal (increments index)
            self.request_next_goal()

        elif command == 'MANUAL':
            # Emergency stop: cancel running task and reset to safe waiting state
            self.internal_state = 'WAITING_FOR_PROCEED'
            self.current_goal_index = max(-1, self.current_goal_index)  # keep sane
            self.drive_start_time = None
            self.get_logger().info('Received MANUAL from GCS, switching to WAITING_FOR_PROCEED.')

        else:
            self.get_logger().info(f"Ignoring command {command} in state {self.internal_state}")

    def request_next_goal(self):
        # Advance to the next goal index
        self.current_goal_index += 1

        if self.current_goal_index < len(self.mission_goals):
            goal = self.mission_goals[self.current_goal_index]
            self.start_lat = self.current_lat
            self.start_lon = self.current_lon
            self.target_lat = goal.x
            self.target_lon = goal.y

            self.get_logger().info(
                f'Requested Goal {self.current_goal_index + 1}: ({self.target_lat}, {self.target_lon})'
            )

            # Do NOT publish PROCEED back to GCS — that caused self-trigger loops
            # Wait for rover to switch to AUTONOMOUS (StateManager controls that)
            self.internal_state = 'WAITING_FOR_AUTONOMOUS'

        else:
            # No more goals
            self.get_logger().info('No more goals. Waiting for new PROCEED.')
            self.internal_state = 'WAITING_FOR_PROCEED'
            # Keep index within bounds (-1 means start-over next time)
            self.current_goal_index = len(self.mission_goals) - 1

    def state_callback(self, msg):
        rover_state = msg.data.upper().strip()
        # If the rover actually switches into AUTONOMOUS while we were waiting, start the dummy task
        if rover_state == 'AUTONOMOUS' and self.internal_state == 'WAITING_FOR_AUTONOMOUS':
            self.internal_state = 'AUTONOMOUS_ACTIVE'
            self.drive_start_time = time.time()
            self.get_logger().info('AUTONOMOUS detected — starting 5s dummy task.')
        elif rover_state == 'MANUAL':
            # Cancel any running autonomous task
            if self.internal_state == 'AUTONOMOUS_ACTIVE':
                self.get_logger().info('Switched to MANUAL — cancelling current dummy task.')
            self.internal_state = 'WAITING_FOR_PROCEED'
            self.drive_start_time = None

    def mavros_gps_callback(self, msg):
        # Update current lat/lon from MAVROS (if available)
        try:
            self.current_lat = float(msg.latitude)
            self.current_lon = float(msg.longitude)
        except Exception:
            # ignore invalid messages
            pass

    def control_loop(self):
        # Dummy execution: wait drive_duration seconds, then mark task complete.
        if self.internal_state == 'AUTONOMOUS_ACTIVE' and self.drive_start_time is not None:
            elapsed = time.time() - self.drive_start_time
            if elapsed >= self.drive_duration:
                self.get_logger().info('Dummy task complete after 5s.')
                self.task_complete_pub.publish(Bool(data=True))
                # After completion, go back to waiting for the operator to PROCEED again
                self.internal_state = 'WAITING_FOR_PROCEED'
                self.drive_start_time = None
        # Nothing else to do in this dummy node
        return

def main(args=None):
    rclpy.init(args=args)
    node = MissionManager()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
