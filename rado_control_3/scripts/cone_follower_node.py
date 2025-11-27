#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from std_msgs.msg import String, Bool, Float32
from geometry_msgs.msg import Twist
import os
import math

class MissionManager(Node):
    def __init__(self):
        super().__init__('heading_cone_follower')

        # --- STATE MACHINE ---
        self.internal_state = 'IDLE'
        self.mission_headings = []      # List of float headings
        self.current_goal_index = -1

        # --- ROBOT SENSOR STATE ---
        self.current_heading = 0.0      # From IMU (0-360)
        self.target_heading = 0.0       # From Mission File
        
        # --- VISION STATE (From your Camera Node) ---
        self.cone_detected = False      # True if cone is in frame
        self.cone_center_x = 0.0        # -1.0 (Left) to 1.0 (Right)
        self.cone_distance = 99.0       # Distance to cone in meters

        # --- TUNING PARAMETERS (Adjust these!) ---
        self.kp_heading = 0.02          # How hard to turn for compass error
        self.kp_vision = 0.8            # How hard to turn for vision error
        self.base_speed = 0.3           # Forward speed (m/s)
        self.stop_distance = 1.0        # Stop 1 meter from cone

        # --- FILE SETUP ---
        home_dir = os.path.expanduser('~')
        self.mission_file_path = os.path.join(home_dir, 'flask_gcs', 'mission_plan.txt')

        # --- PUBLISHERS ---
        self.velocity_pub = self.create_publisher(Twist, '/auto/cmd_vel', 10)
        self.task_complete_pub = self.create_publisher(Bool, '/auto/task_complete', 10)
        self.gcs_command_pub = self.create_publisher(String, '/gcs/command', 10)

        # --- SUBSCRIBERS ---
        # 1. Command & State
        self.create_subscription(String, '/rover_state', self.state_callback, 10)
        self.create_subscription(String, '/gcs/command', self.gcs_command_callback, 10)
        
        # 2. SENSORS (You must ensure your other nodes publish these!)
        self.create_subscription(Float32, '/sensors/heading', self.heading_callback, 10) 
        self.create_subscription(Bool, '/vision/cone_detected', self.vision_status_callback, 10)
        self.create_subscription(Float32, '/vision/cone_x_error', self.vision_error_callback, 10)
        self.create_subscription(Float32, '/vision/cone_distance', self.vision_dist_callback, 10)

        # --- TIMER (CONTROL LOOP) ---
        self.timer = self.create_timer(0.1, self.control_loop) # 10Hz

        self.load_mission()
        self.internal_state = 'WAITING_FOR_PROCEED'
        self.get_logger().info('Initialized Heading+Cone Logic.')

    # ---------------------------------------------------
    #       FILE LOADING (Reads Headings, not GPS)
    # ---------------------------------------------------
    def load_mission(self):
        self.get_logger().info('Loading mission plan...')
        try:
            self.mission_headings = []
            if os.path.exists(self.mission_file_path):
                with open(self.mission_file_path, 'r') as f:
                    for line in f:
                        parts = line.strip().split(',')
                        # Assuming format: id, type, HEADING_VALUE
                        # Example file line:  1, heading, 180.0
                        if len(parts) >= 3:
                            try:
                                heading = float(parts[2])
                                self.mission_headings.append(heading)
                            except ValueError:
                                pass
                self.get_logger().info(f'Loaded {len(self.mission_headings)} headings.')
            else:
                self.get_logger().warn("File not found.")
        except Exception as e:
            self.get_logger().error(f'Error loading mission: {e}')

    # ---------------------------------------------------
    #       SENSOR CALLBACKS
    # ---------------------------------------------------
    def heading_callback(self, msg):
        self.current_heading = msg.data

    def vision_status_callback(self, msg):
        # This receives the True/False from your camera node
        self.cone_detected = msg.data

    def vision_error_callback(self, msg):
        self.cone_center_x = msg.data

    def vision_dist_callback(self, msg):
        self.cone_distance = msg.data

    # ---------------------------------------------------
    #       STATE MANAGEMENT
    # ---------------------------------------------------
    def gcs_command_callback(self, msg):
        command = msg.data.upper().strip()
        
        if command == 'PROCEED' and self.internal_state in ('WAITING_FOR_PROCEED', 'IDLE'):
            self.load_mission() 
            if self.mission_headings:
                # Move to next heading in list
                self.current_goal_index += 1
                if self.current_goal_index < len(self.mission_headings):
                    self.target_heading = self.mission_headings[self.current_goal_index]
                    self.get_logger().info(f"Accepted PROCEED. Target Heading: {self.target_heading}")
                    self.internal_state = 'WAITING_FOR_AUTONOMOUS'
                else:
                    self.get_logger().info("All mission headings finished.")
                    # Keep index at end so we don't crash
                    self.current_goal_index = len(self.mission_headings) - 1
            else:
                self.get_logger().warn("No headings found in file.")

        elif command == 'MANUAL':
            self.internal_state = 'WAITING_FOR_PROCEED'
            self.stop_rover()
            self.get_logger().info("MANUAL command received. Stopping.")

    def state_callback(self, msg):
        rover_state = msg.data.upper().strip()
        
        # If we are waiting for the switch, and it happens: GO.
        if rover_state == 'AUTONOMOUS' and self.internal_state == 'WAITING_FOR_AUTONOMOUS':
            self.internal_state = 'AUTONOMOUS_ACTIVE'
            self.get_logger().info("Switched to AUTONOMOUS. Starting Drive Logic.")
            
        # If manual is triggered at the hardware level
        elif rover_state == 'MANUAL':
            if self.internal_state == 'AUTONOMOUS_ACTIVE':
                 self.get_logger().info("Manual Switch Detected. Aborting Task.")
            self.internal_state = 'WAITING_FOR_PROCEED'
            self.stop_rover()

    # ---------------------------------------------------
    #       CONTROL LOOP (The Logic You Requested)
    # ---------------------------------------------------
    def control_loop(self):
        # Only drive if we are in the active state
        if self.internal_state != 'AUTONOMOUS_ACTIVE':
            return

        twist = Twist()

        # --- PHASE 1: CHECK FOR COMPLETION ---
        # If we see the cone AND are close enough
        if self.cone_detected and self.cone_distance < self.stop_distance:
            self.get_logger().info(f"Target Reached! Distance: {self.cone_distance:.2f}m")
            self.stop_rover()
            self.task_complete_pub.publish(Bool(data=True))
            self.internal_state = 'WAITING_FOR_PROCEED'
            return

        # --- PHASE 2: VISUAL SERVOING (Priority) ---
        if self.cone_detected:
            # We see the cone, so we ignore the compass and steer relative to the image
            # cone_center_x is usually -1.0 (left) to 1.0 (right). 
            # We want it to be 0.0.
            
            twist.linear.x = self.base_speed
            # If x is positive (right), we turn negative (right) -> coordinate system dependent
            twist.angular.z = -1.0 * self.kp_vision * self.cone_center_x
            
            # Debug log (optional, remove if too spammy)
            # self.get_logger().info(f"Vision Mode: Error {self.cone_center_x:.2f}")

        # --- PHASE 3: COMPASS FOLLOW (Search Mode) ---
        else:
            # We don't see the cone, so we maintain the heading from the file
            error = self.target_heading - self.current_heading
            
            # Normalize error to smallest angle (-180 to 180)
            # Example: Target 10, Current 350 -> Error -340 -> Corrected +20
            while error > 180: error -= 360
            while error < -180: error += 360

            twist.linear.x = self.base_speed
            twist.angular.z = self.kp_heading * error
            
            # self.get_logger().info(f"Compass Mode: Tgt {self.target_heading} Curr {self.current_heading}")

        # Send command to wheels
        self.velocity_pub.publish(twist)

    def stop_rover(self):
        self.velocity_pub.publish(Twist()) # Publishes all zeros

def main(args=None):
    rclpy.init(args=args)
    node = MissionManager()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        node.stop_rover()
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()