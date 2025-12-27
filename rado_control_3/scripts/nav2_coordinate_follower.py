#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from rclpy.action import ActionClient
from rclpy.duration import Duration
from std_msgs.msg import String, Float64
from geometry_msgs.msg import PoseStamped
from sensor_msgs.msg import NavSatFix
from nav2_msgs.action import NavigateToPose
import os
import time
import math
from pathlib import Path

class Nav2CoordinateFollower(Node):
    def __init__(self):
        super().__init__('coordinate_follower')

        # State machine
        self.internal_state = 'IDLE'
        self.mission_goals = []
        self.current_goal = None
        self.current_goal_index = -1
        
        # Navigation State
        self.current_lat = 0.0
        self.current_lon = 0.0
        self.current_heading = 0.0
        self.datum_lat = None
        self.datum_lon = None
        self.nav_goal_handle = None
        
        # --- TUNING PARAMETERS ---
        self.gps_tolerance = 2.0  # Meters (Radius to switch to cone)
        
        # Path Setup
        home = str(Path.home())
        self.mission_file_path = os.path.join(home, 'ros2_ws/src/Main_Control/rado_control_3/config/mission_plan.txt')
        
        # Publishers
        self.cone_trigger_pub = self.create_publisher(String, '/auto/cone_follow/trigger', 10)
        
        # Subscribers
        self.create_subscription(String, '/rover_state', self.state_callback, 10)
        self.create_subscription(String, '/gcs/command', self.gcs_command_callback, 10)
        self.create_subscription(NavSatFix, '/mavros/global_position/global', self.gps_callback, 10)
        self.create_subscription(Float64, '/mavros/global_position/compass_hdg', self.heading_callback, 10)
        self.create_subscription(String, '/auto/cone_follow/status', self.cone_status_callback, 10)
        
        # Nav2 Action Client
        self.nav_to_pose_client = ActionClient(self, NavigateToPose, 'navigate_to_pose')
        
        self.timer = self.create_timer(0.1, self.control_loop)
        self.load_mission()
        self.internal_state = 'WAITING_FOR_PROCEED'
        self.get_logger().info('Nav2 Coordinate Follower Initialized.')

    def load_mission(self):
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
                            except ValueError:
                                pass
            self.get_logger().info(f'Loaded {len(self.mission_goals)} goals.')
        except Exception as e:
            self.get_logger().error(f'Failed to load mission: {e}')

    def gcs_command_callback(self, msg):
        command = msg.data.upper().strip()
        if command == 'PROCEED':
            if self.internal_state == 'WAITING_FOR_PROCEED':
                self.select_next_goal()
        elif command == 'MANUAL':
            self.internal_state = 'WAITING_FOR_PROCEED'
            self.cancel_nav_goal()
            self.cone_trigger_pub.publish(String(data="STOP"))

    def select_next_goal(self):
        next_goal = None
        if self.current_goal and self.current_goal['type'] == 'pickup':
            color = self.current_goal['color']
            for g in self.mission_goals:
                if g['type'] == 'dropoff' and g['color'] == color:
                    next_goal = g
                    break
        else:
            start_search = self.current_goal_index + 1
            for i in range(start_search, len(self.mission_goals)):
                if self.mission_goals[i]['type'] == 'pickup':
                    next_goal = self.mission_goals[i]
                    self.current_goal_index = i
                    break
        
        if next_goal:
            self.current_goal = next_goal
            self.get_logger().info(f"Selected Goal: {next_goal['type']} {next_goal['color']}")
            self.internal_state = 'WAITING_FOR_AUTONOMOUS'
        else:
            self.get_logger().info("No more goals found.")
            self.internal_state = 'IDLE'

    def state_callback(self, msg):
        state = msg.data.upper().strip()
        if state == 'AUTONOMOUS' and self.internal_state == 'WAITING_FOR_AUTONOMOUS':
            self.internal_state = 'GPS_NAVIGATING'
            self.get_logger().info("Starting GPS Navigation with Nav2...")
            self.send_nav_goal()
        elif state == 'MANUAL':
            if self.internal_state in ['GPS_NAVIGATING', 'CONE_NAVIGATING']:
                self.internal_state = 'WAITING_FOR_PROCEED'
                self.cancel_nav_goal()
                self.cone_trigger_pub.publish(String(data="STOP"))

    def gps_callback(self, msg):
        self.current_lat = msg.latitude
        self.current_lon = msg.longitude
        
        # Set datum if not set (assuming robot starts at 0,0 map frame or close to it)
        # Ideally, use robot_localization's datum or map origin.
        if self.datum_lat is None:
            self.datum_lat = self.current_lat
            self.datum_lon = self.current_lon
            self.get_logger().info(f"Datum set to: {self.datum_lat}, {self.datum_lon}")

    def heading_callback(self, msg):
        self.current_heading = msg.data

    def cone_status_callback(self, msg):
        if self.internal_state == 'CONE_NAVIGATING' and msg.data == 'SUCCESS':
            self.handle_arrival()

    def handle_arrival(self):
        self.cancel_nav_goal() # Ensure stopped
        self.get_logger().info(f"Arrived at {self.current_goal['type']} ({self.current_goal['color']})")
        
        if self.current_goal['type'] == 'pickup':
            self.internal_state = 'WAITING_FOR_PROCEED'
        elif self.current_goal['type'] == 'dropoff':
            self.internal_state = 'DROPOFF_ACTION'
            self.dropoff_start_time = time.time()

    def cancel_nav_goal(self):
        if self.nav_goal_handle:
            self.get_logger().info('Canceling Nav2 goal...')
            future = self.nav_goal_handle.cancel_goal_async()
            # We don't wait for result here to avoid blocking, but we reset handle
            self.nav_goal_handle = None

    def latlon_to_map(self, lat, lon):
        # Simple flat earth approximation relative to datum
        # NOTE: This assumes 'map' frame origin (0,0) is at (self.datum_lat, self.datum_lon)
        # and X is East, Y is North (ENU).
        # If your map frame is different, you MUST adjust this conversion.
        
        if self.datum_lat is None:
            return 0.0, 0.0
            
        R = 6371000
        dlat = math.radians(lat - self.datum_lat)
        dlon = math.radians(lon - self.datum_lon)
        lat0 = math.radians(self.datum_lat)
        
        y = R * dlat
        x = R * dlon * math.cos(lat0)
        
        return x, y

    def send_nav_goal(self):
        if not self.current_goal or self.datum_lat is None:
            self.get_logger().warn("Cannot send goal: No goal or No GPS fix for datum.")
            return

        if not self.nav_to_pose_client.wait_for_server(timeout_sec=10.0):
            self.get_logger().error("Nav2 NavigateToPose action server not available!")
            return

        x, y = self.latlon_to_map(self.current_goal['lat'], self.current_goal['lon'])
        
        goal_msg = NavigateToPose.Goal()
        goal_msg.pose.header.frame_id = 'map'
        goal_msg.pose.header.stamp = self.get_clock().now().to_msg()
        goal_msg.pose.pose.position.x = x
        goal_msg.pose.pose.position.y = y
        goal_msg.pose.pose.orientation.w = 1.0 # No specific orientation
        
        self.get_logger().info(f"Sending Nav2 Goal: x={x:.2f}, y={y:.2f} (Lat: {self.current_goal['lat']}, Lon: {self.current_goal['lon']})")
        
        self.send_goal_future = self.nav_to_pose_client.send_goal_async(goal_msg)
        self.send_goal_future.add_done_callback(self.goal_response_callback)

    def goal_response_callback(self, future):
        goal_handle = future.result()
        if not goal_handle.accepted:
            self.get_logger().info('Goal rejected :(')
            return

        self.get_logger().info('Goal accepted :)')
        self.nav_goal_handle = goal_handle

    def get_distance_to_goal(self):
        if not self.current_goal:
            return float('inf')
        
        # Use Haversine for true GPS distance
        R = 6371000
        phi1 = math.radians(self.current_lat)
        phi2 = math.radians(self.current_goal['lat'])
        dphi = math.radians(self.current_goal['lat'] - self.current_lat)
        dlambda = math.radians(self.current_goal['lon'] - self.current_lon)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2) * math.sin(dlambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        dist = R * c
        return dist

    def control_loop(self):
        if self.internal_state == 'GPS_NAVIGATING':
            # Check for valid GPS
            if self.current_lat == 0.0 and self.current_lon == 0.0:
                self.get_logger().warn("Waiting for valid GPS fix...", throttle_duration_sec=2)
                return
            
            # If we haven't sent a goal yet (and we have a datum), send it
            # (This handles the case where we started navigating before GPS fix)
            if self.nav_goal_handle is None and self.datum_lat is not None:
                 # We might want to ensure we don't spam goals. 
                 # The state transition calls send_nav_goal, but if datum was missing, it failed.
                 # So we retry here.
                 # But we need to be careful not to resend if we are just waiting for acceptance.
                 pass 

            dist = self.get_distance_to_goal()
            self.get_logger().info(f"Distance to goal: {dist:.2f}m", throttle_duration_sec=1.0)

            # Check Arrival
            if dist < self.gps_tolerance:
                self.get_logger().info(f"Within {dist:.2f}m. Switching to CONE FOLLOW.")
                self.cancel_nav_goal()
                self.internal_state = 'CONE_NAVIGATING'
                self.cone_trigger_pub.publish(String(data=self.current_goal['color']))
                return

        elif self.internal_state == 'DROPOFF_ACTION':
            if time.time() - self.dropoff_start_time > 5.0:
                self.select_next_goal()

def main(args=None):
    rclpy.init(args=args)
    node = Nav2CoordinateFollower()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
