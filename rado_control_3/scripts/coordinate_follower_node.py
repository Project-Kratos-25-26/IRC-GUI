#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from rclpy.qos import qos_profile_sensor_data
from std_msgs.msg import String, Bool, Float64
from geometry_msgs.msg import Twist
from sensor_msgs.msg import NavSatFix
import os
import time
import math
from pathlib import Path

class MissionManager(Node):
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
        
        # --- TUNING PARAMETERS (SAFE MODE) ---
        self.gps_tolerance = 2.0  # Meters (Radius to switch to cone)
        self.kp_heading = 0.05    # Higher = Stiffer turning
        self.kp_dist = 0.5        # Speed proportional to distance
        self.max_speed = 0.4      # Slower max speed for testing
        self.stop_turn_threshold = 10.0 # Degrees. If error > this, STOP and turn.
        # -------------------------------------

        # Path Setup
        home = str(Path.home())
        self.mission_file_path = os.path.join(home, 'ros2_ws/src/Main_Control/rado_control_3/config/mission_plan.txt')

        # Publishers
        self.velocity_pub = self.create_publisher(Twist, '/auto/cmd_vel', 10)
        self.cone_trigger_pub = self.create_publisher(String, '/auto/cone_follow/trigger', 10)

        # Subscribers
        self.create_subscription(String, '/rover_state', self.state_callback, 10)
        self.create_subscription(String, '/gcs/command', self.gcs_command_callback, 10)
        self.create_subscription(NavSatFix, '/mavros/global_position/global', self.gps_callback, 10)
        
        # Note: Changed to standard QoS 10 to ensure we hear the bridge
        self.create_subscription(Float64, '/mavros/global_position/compass_hdg', self.heading_callback, 10)
        self.create_subscription(String, '/auto/cone_follow/status', self.cone_status_callback, 10)

        self.timer = self.create_timer(0.1, self.control_loop)
        self.load_mission()
        self.internal_state = 'WAITING_FOR_PROCEED'
        self.get_logger().info('Mission Manager Initialized (Safe Mode).')

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
            self.stop_rover()
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
            self.get_logger().info("Starting GPS Navigation...")
        elif state == 'MANUAL':
            if self.internal_state in ['GPS_NAVIGATING', 'CONE_NAVIGATING']:
                self.internal_state = 'WAITING_FOR_PROCEED'
                self.cone_trigger_pub.publish(String(data="STOP"))

    def gps_callback(self, msg):
        self.current_lat = msg.latitude
        self.current_lon = msg.longitude

    def heading_callback(self, msg):
        self.current_heading = msg.data

    def cone_status_callback(self, msg):
        if self.internal_state == 'CONE_NAVIGATING' and msg.data == 'SUCCESS':
            self.handle_arrival()

    def handle_arrival(self):
        self.stop_rover()
        self.get_logger().info(f"Arrived at {self.current_goal['type']} ({self.current_goal['color']})")
        if self.current_goal['type'] == 'pickup':
            self.internal_state = 'WAITING_FOR_PROCEED'
        elif self.current_goal['type'] == 'dropoff':
            self.internal_state = 'DROPOFF_ACTION'
            self.dropoff_start_time = time.time()

    def stop_rover(self):
        self.velocity_pub.publish(Twist())

    def get_distance_bearing(self, lat1, lon1, lat2, lon2):
        R = 6371000
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2) * math.sin(dlambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        dist = R * c
        y = math.sin(dlambda) * math.cos(phi2)
        x = math.cos(phi1)*math.sin(phi2) - math.sin(phi1)*math.cos(phi2)*math.cos(dlambda)
        bearing = math.degrees(math.atan2(y, x))
        return dist, (bearing + 360) % 360

    def control_loop(self):
        if self.internal_state == 'GPS_NAVIGATING':
            # Check for valid GPS
            if self.current_lat == 0.0 and self.current_lon == 0.0:
                self.get_logger().warn("Waiting for valid GPS fix...", throttle_duration_sec=2)
                return

            dist, target_bearing = self.get_distance_bearing(
                self.current_lat, self.current_lon,
                self.current_goal['lat'], self.current_goal['lon']
            )

            # Calculate Error
            heading_error = target_bearing - self.current_heading
            if heading_error > 180: heading_error -= 360
            if heading_error < -180: heading_error += 360

            # --- BETTER LOGGING ---
            self.get_logger().info(
                f"Dist={dist:.1f}m | TgtBear={target_bearing:.0f} | CurHdg={self.current_heading:.0f} | Err={heading_error:.0f}", 
                throttle_duration_sec=0.5
            )

            # Check Arrival
            if dist < self.gps_tolerance:
                self.internal_state = 'CONE_NAVIGATING'
                self.stop_rover()
                self.get_logger().info(f"Within {dist:.2f}m. Switching to CONE FOLLOW.")
                self.cone_trigger_pub.publish(String(data=self.current_goal['color']))
                return

            twist = Twist()
            
            # --- STEERING LOGIC ---
            # Negative sign because Positive Error (Right) needs Negative Angular Z (Right Turn)
            twist.angular.z = -1.0 * (heading_error * self.kp_heading)
            
            # Cap angular velocity for safety
            twist.angular.z = max(min(twist.angular.z, 0.8), -0.8)

            # --- THROTTLE LOGIC ---
            # If error is large (>10 deg), SPIN IN PLACE. Do not drive forward.
            if abs(heading_error) > self.stop_turn_threshold:
                twist.linear.x = 0.0
            else:
                twist.linear.x = min(self.max_speed, dist * self.kp_dist)
                
            self.velocity_pub.publish(twist)

        elif self.internal_state == 'DROPOFF_ACTION':
            if time.time() - self.dropoff_start_time > 5.0:
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