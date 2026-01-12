#!/usr/bin/env python3
"""
Mission Manager with Nav2 Integration
Converts GPS waypoints to map coordinates and sends goals to Nav2
Falls back to cone following for final approach
"""
import rclpy
from rclpy.node import Node
from rclpy.action import ActionClient
from rclpy.duration import Duration
from std_msgs.msg import String
from geometry_msgs.msg import PoseStamped
from sensor_msgs.msg import NavSatFix
from nav2_msgs.action import NavigateToPose
from tf2_ros import Buffer, TransformListener
from tf2_geometry_msgs import do_transform_pose
import os
import time
import math
from pathlib import Path


class MissionManager(Node):
    def __init__(self):
        super().__init__('mission_manager')

        # Parameters
        self.declare_parameter('map_frame', 'map')
        self.declare_parameter('base_frame', 'base_link')
        self.declare_parameter('gps_origin_lat', 0.0)  # Set your map origin
        self.declare_parameter('gps_origin_lon', 0.0)  # Set your map origin
        
        self.map_frame = self.get_parameter('map_frame').value
        self.base_frame = self.get_parameter('base_frame').value
        self.gps_origin_lat = self.get_parameter('gps_origin_lat').value
        self.gps_origin_lon = self.get_parameter('gps_origin_lon').value

        # State machine
        self.internal_state = 'IDLE'
        self.mission_goals = []
        self.current_goal = None
        self.current_goal_index = -1
        
        # Navigation State
        self.current_lat = 0.0
        self.current_lon = 0.0
        self.current_heading = 0.0
        
        # --- TUNING PARAMETERS ---
        self.cone_switch_distance = 0.5  # Meters - when to switch from Nav2 to cone following
        self.nav2_goal_tolerance = 2.0   # Nav2 goal tolerance
        self.nav2_timeout = 300.0        # Nav2 navigation timeout (seconds)
        # -------------------------

        # Path Setup
        home = str(Path.home())
        self.mission_file_path = os.path.join(
            home, 'ros2_ws/src/Main_Control/rado_control_3/config/mission_plan.txt'
        )

        # TF2 Setup
        self.tf_buffer = Buffer()
        self.tf_listener = TransformListener(self.tf_buffer, self)

        # Publishers
        self.cone_trigger_pub = self.create_publisher(
            String, '/auto/cone_follow/trigger', 10
        )

        # Subscribers
        self.create_subscription(
            String, '/rover_state', self.state_callback, 10
        )
        self.create_subscription(
            String, '/gcs/command', self.gcs_command_callback, 10
        )
        self.create_subscription(
            NavSatFix, '/mavros/global_position/global', self.gps_callback, 10
        )
        self.create_subscription(
            String, '/auto/cone_follow/status', self.cone_status_callback, 10
        )
        # Subscribe to GUI goal selection
        self.create_subscription(
            String, '/mission/set_goal', self.set_goal_callback, 10
        )

        # Nav2 Action Client
        self.nav2_client = ActionClient(self, NavigateToPose, 'navigate_to_pose')
        self.nav2_goal_handle = None

        # Timer
        self.timer = self.create_timer(0.2, self.control_loop)
        
        # Load mission and wait for Nav2
        self.load_mission()
        self.internal_state = 'WAITING_FOR_PROCEED'
        
        self.get_logger().info('Mission Manager (Nav2 Integrated) Initialized.')
        self.get_logger().info(f'Loaded {len(self.mission_goals)} mission goals.')
        
        # Wait for Nav2 action server
        self.create_timer(1.0, self.check_nav2_ready)

    def check_nav2_ready(self):
        """Check if Nav2 action server is available"""
        if not self.nav2_client.server_is_ready():
            self.get_logger().info('Waiting for Nav2 action server...', throttle_duration_sec=5)
        else:
            self.get_logger().info('Nav2 action server is ready!')

    def load_mission(self):
        """Load mission waypoints from file"""
        self.mission_goals = []
        try:
            if os.path.exists(self.mission_file_path):
                with open(self.mission_file_path, 'r') as f:
                    for line in f:
                        parts = line.strip().split(',')
                        if len(parts) == 4:
                            try:
                                goal = {
                                    'type': parts[0].lower().strip(),
                                    'color': parts[1].lower().strip(),
                                    'lat': float(parts[2]),
                                    'lon': float(parts[3])
                                }
                                self.mission_goals.append(goal)
                            except ValueError as e:
                                self.get_logger().warn(f'Invalid line in mission file: {line}')
            else:
                self.get_logger().error(f'Mission file not found: {self.mission_file_path}')
        except Exception as e:
            self.get_logger().error(f'Failed to load mission: {e}')

    def gcs_command_callback(self, msg):
        """Handle commands from ground control station"""
        command = msg.data.upper().strip()
        
        if command == 'PROCEED':
            if self.internal_state == 'WAITING_FOR_PROCEED':
                # If we have a manually selected goal, use that
                if self.current_goal:
                    self.internal_state = 'WAITING_FOR_AUTONOMOUS'
                    self.get_logger().info(
                        f"Proceeding to manually selected goal: {self.current_goal['type']} "
                        f"{self.current_goal['color']} at ({self.current_goal['lat']:.6f}, "
                        f"{self.current_goal['lon']:.6f})"
                    )
                else:
                    self.select_next_goal()
        elif command == 'MANUAL':
            self.internal_state = 'WAITING_FOR_PROCEED'
            self.cancel_nav2_goal()
            self.cone_trigger_pub.publish(String(data="STOP"))
        elif command == 'CANCEL':
            self.cancel_nav2_goal()
            self.internal_state = 'WAITING_FOR_PROCEED'

    def set_goal_callback(self, msg):
        """Handle goal selection from GUI"""
        try:
            # Format: GOAL|type|color|lat|lon
            parts = msg.data.split('|')
            if len(parts) >= 5 and parts[0] == 'GOAL':
                goal_type = parts[1].lower().strip()
                color = parts[2].lower().strip()
                lat = float(parts[3])
                lon = float(parts[4])
                
                self.current_goal = {
                    'type': goal_type,
                    'color': color,
                    'lat': lat,
                    'lon': lon
                }
                
                self.get_logger().info(
                    f"GUI Goal Set: {goal_type} {color} at ({lat:.6f}, {lon:.6f})"
                )
                self.internal_state = 'WAITING_FOR_PROCEED'
            else:
                self.get_logger().warn(f"Invalid goal format: {msg.data}")
        except Exception as e:
            self.get_logger().error(f"Failed to parse goal: {e}")

    def select_next_goal(self):
        """Select the next goal in mission sequence"""
        next_goal = None
        
        # If we just completed a pickup, find matching dropoff
        if self.current_goal and self.current_goal['type'] == 'pickup':
            color = self.current_goal['color']
            for g in self.mission_goals:
                if g['type'] == 'dropoff' and g['color'] == color:
                    next_goal = g
                    break
        else:
            # Find next pickup
            start_search = self.current_goal_index + 1
            for i in range(start_search, len(self.mission_goals)):
                if self.mission_goals[i]['type'] == 'pickup':
                    next_goal = self.mission_goals[i]
                    self.current_goal_index = i
                    break
        
        if next_goal:
            self.current_goal = next_goal
            self.get_logger().info(
                f"Selected Goal: {next_goal['type']} {next_goal['color']} "
                f"at ({next_goal['lat']:.6f}, {next_goal['lon']:.6f})"
            )
            self.internal_state = 'WAITING_FOR_AUTONOMOUS'
        else:
            self.get_logger().info("No more goals found. Mission complete!")
            self.internal_state = 'IDLE'

    def state_callback(self, msg):
        """Handle rover state changes"""
        state = msg.data.upper().strip()
        
        if state == 'AUTONOMOUS' and self.internal_state == 'WAITING_FOR_AUTONOMOUS':
            self.internal_state = 'NAV2_NAVIGATING'
            self.send_nav2_goal()
        elif state == 'MANUAL':
            if self.internal_state in ['NAV2_NAVIGATING', 'CONE_NAVIGATING']:
                self.internal_state = 'WAITING_FOR_PROCEED'
                self.cancel_nav2_goal()
                self.cone_trigger_pub.publish(String(data="STOP"))

    def gps_callback(self, msg):
        """Update current GPS position"""
        self.current_lat = msg.latitude
        self.current_lon = msg.longitude

    def cone_status_callback(self, msg):
        """Handle cone following status updates"""
        if self.internal_state == 'CONE_NAVIGATING' and msg.data == 'SUCCESS':
            self.handle_arrival()

    def gps_to_map_coords(self, lat, lon):
        """
        Convert GPS coordinates to map coordinates
        Uses simple equirectangular projection relative to origin
        For better accuracy, consider using robot_localization or a proper UTM converter
        """
        # If no origin set, log warning
        if self.gps_origin_lat == 0.0 and self.gps_origin_lon == 0.0:
            self.get_logger().warn(
                'GPS origin not set! Using (0,0). Set gps_origin_lat and gps_origin_lon parameters.',
                throttle_duration_sec=5
            )
        
        # Earth radius in meters
        R = 6371000.0
        
        # Convert to radians
        lat_rad = math.radians(lat)
        origin_lat_rad = math.radians(self.gps_origin_lat)
        
        # Calculate differences
        dlat = lat - self.gps_origin_lat
        dlon = lon - self.gps_origin_lon
        
        # Convert to meters (equirectangular approximation)
        x = -1.0 * (R * math.radians(dlon) * math.cos(origin_lat_rad))
        y = -1.0 * (R * math.radians(dlat))
        
        return x, y

    def send_nav2_goal(self):
        """Send navigation goal to Nav2"""
        if not self.nav2_client.server_is_ready():
            self.get_logger().error('Nav2 action server not available!')
            self.internal_state = 'WAITING_FOR_PROCEED'
            return

        # Convert GPS to map coordinates
        x, y = self.gps_to_map_coords(
            self.current_goal['lat'],
            self.current_goal['lon']
        )

        # Create Nav2 goal
        goal_msg = NavigateToPose.Goal()
        goal_msg.pose.header.frame_id = self.map_frame
        goal_msg.pose.header.stamp = self.get_clock().now().to_msg()
        goal_msg.pose.pose.position.x = x
        goal_msg.pose.pose.position.y = y
        goal_msg.pose.pose.position.z = 0.0
        
        # Orientation (quaternion for yaw=0, can be calculated based on approach direction)
        goal_msg.pose.pose.orientation.w = 1.0

        self.get_logger().info(
            f'Sending Nav2 goal to map coords: ({x:.2f}, {y:.2f})'
        )

        # Send goal
        send_goal_future = self.nav2_client.send_goal_async(
            goal_msg,
            feedback_callback=self.nav2_feedback_callback
        )
        send_goal_future.add_done_callback(self.nav2_goal_response_callback)

    def nav2_goal_response_callback(self, future):
        """Handle Nav2 goal acceptance/rejection"""
        self.nav2_goal_handle = future.result()
        
        if not self.nav2_goal_handle.accepted:
            self.get_logger().error('Nav2 goal was rejected!')
            self.internal_state = 'WAITING_FOR_PROCEED'
            return

        self.get_logger().info('Nav2 goal accepted, navigating...')
        
        # Get result asynchronously
        result_future = self.nav2_goal_handle.get_result_async()
        result_future.add_done_callback(self.nav2_result_callback)

    def nav2_feedback_callback(self, feedback_msg):
        """Handle Nav2 navigation feedback"""
        feedback = feedback_msg.feedback
        
        # Calculate distance to goal
        if self.current_goal:
            dist, _ = self.get_distance_bearing(
                self.current_lat, self.current_lon,
                self.current_goal['lat'], self.current_goal['lon']
            )
            
            self.get_logger().info(
                f'Nav2 feedback - Distance remaining: {dist:.2f}m',
                throttle_duration_sec=2
            )
            
            # Switch to cone following when close enough
            if dist < self.cone_switch_distance:
                self.get_logger().info(
                    f'Within {dist:.2f}m. Canceling Nav2, switching to CONE FOLLOW.'
                )
                self.cancel_nav2_goal()
                self.internal_state = 'CONE_NAVIGATING'
                self.cone_trigger_pub.publish(String(data=self.current_goal['color']))

    def nav2_result_callback(self, future):
        """Handle Nav2 navigation result"""
        result = future.result().result
        status = future.result().status
        
        if status == 4:  # SUCCEEDED
            self.get_logger().info('Nav2 navigation succeeded!')
            # Switch to cone following for final approach
            self.internal_state = 'CONE_NAVIGATING'
            self.cone_trigger_pub.publish(String(data=self.current_goal['color']))
        elif status == 5:  # CANCELED
            self.get_logger().info('Nav2 navigation was canceled')
        else:
            self.get_logger().error(f'Nav2 navigation failed with status: {status}')
            self.internal_state = 'WAITING_FOR_PROCEED'

    def cancel_nav2_goal(self):
        """Cancel current Nav2 navigation goal"""
        if self.nav2_goal_handle is not None:
            self.get_logger().info('Canceling Nav2 goal...')
            cancel_future = self.nav2_goal_handle.cancel_goal_async()
            self.nav2_goal_handle = None

    def handle_arrival(self):
        """Handle arrival at goal location"""
        self.get_logger().info(
            f"Arrived at {self.current_goal['type']} ({self.current_goal['color']})"
        )
        
        if self.current_goal['type'] == 'pickup':
            self.internal_state = 'WAITING_FOR_PROCEED'
        elif self.current_goal['type'] == 'dropoff':
            self.internal_state = 'DROPOFF_ACTION'
            self.dropoff_start_time = time.time()

    def get_distance_bearing(self, lat1, lon1, lat2, lon2):
        """Calculate distance and bearing between two GPS coordinates"""
        R = 6371000  # Earth radius in meters
        
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        
        # Haversine formula
        a = (math.sin(dphi/2)**2 + 
             math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2)**2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        dist = R * c
        
        # Bearing calculation
        y = math.sin(dlambda) * math.cos(phi2)
        x = (math.cos(phi1) * math.sin(phi2) - 
             math.sin(phi1) * math.cos(phi2) * math.cos(dlambda))
        bearing = math.degrees(math.atan2(y, x))
        
        return dist, (bearing + 360) % 360

    def control_loop(self):
        """Main control loop"""
        if self.internal_state == 'DROPOFF_ACTION':
            # Wait for dropoff action to complete (e.g., 5 seconds)
            if time.time() - self.dropoff_start_time > 5.0:
                self.get_logger().info('Dropoff complete. Proceeding to next goal.')
                self.select_next_goal()


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
