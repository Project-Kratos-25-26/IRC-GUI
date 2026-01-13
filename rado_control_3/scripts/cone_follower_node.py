#!/usr/bin/env python3
# =================================================================================================
# STAGE 1: SETUP & INIT
# =================================================================================================
import rclpy
from rclpy.node import Node
from std_msgs.msg import String
from geometry_msgs.msg import Twist
import json
import math

class ConeFollower(Node):
    def __init__(self):
        super().__init__('cone_follower')

        # -------------------------------------------------------------------------
        # 1.1: State Variables
        # These variables keep track of what the robot is doing and seeing.
        # -------------------------------------------------------------------------
        self.active = False               # Is the robot allowed to move?
        self.target_color = None          # What color cone are we chasing? (e.g., 'blue', 'orange')
        self.latest_detections = []       # List of cones currently visible to the camera
        self.image_width = 1280.0         # Camera resolution width (updates dynamically from JSON)
        
        # -------------------------------------------------------------------------
        # 1.2: Tuning Parameters (Merged from Old Script)
        # Adjust these numbers to change how the robot behaves.
        # -------------------------------------------------------------------------

        # -------------------------------------------------------------------------
        # 1.2: Tuning Parameters (Merged from Old Script)
        # Adjust these numbers to change how the robot behaves.
        # -------------------------------------------------------------------------
        self.stop_distance = 1.0  # meters - Updated to match old script threshold (1.0m)
        self.linear_vel = 0.22    # Constant driving speed
        self.yaw_threshold = 40   # Logic threshold for "Drive Only" vs "Turn+Drive" (based on 640px width)
        self.conf_threshold = 0.3 # Minimum confidence to accept a detection

        # -------------------------------------------------------------------------
        # 1.3: ROS 2 Communication
        # Setting up how we talk to other parts of the robot.
        # -------------------------------------------------------------------------
        # Publishers: Sending commands OUT
        self.velocity_pub = self.create_publisher(Twist, '/auto/cmd_vel', 10)          # Driving instructions
        self.status_pub = self.create_publisher(String, '/auto/cone_follow/status', 10) # Tell the world what we are doing

        # Subscribers: Listening for messages IN
        self.create_subscription(String, '/cone_detector/detections', self.detection_callback, 10) # Camera data
        self.create_subscription(String, '/auto/cone_follow/trigger', self.trigger_callback, 10)   # remote control / brain commands

        # Timer: The heartbeat of the node. Runs the control loop 10 times a second (0.1s).
        self.timer = self.create_timer(0.1, self.control_loop)
        
        self.get_logger().info(f'Cone Follower Node Ready (Slave Mode - Turn-Then-Drive). Stop Dist: {self.stop_distance}m')

    # =================================================================================================
    # STAGE 2: INPUT HANDLING (Callbacks)
    # =================================================================================================

    def trigger_callback(self, msg):
        """
        Received a command from the main brain or user.
        Commands: 'stop' or a color like 'blue', 'orange'.
        """
        command = msg.data.lower().strip()
        
        if command == 'stop':
            # Stop everything immediately
            self.active = False
            self.target_color = None
            self.stop_rover()
            self.get_logger().info('Cone Follower STOPPED')
        else:
            # Start following a specific color
            self.target_color = command
            self.active = True
            self.latest_detections = [] # Clear old data so we don't react to ghosts
            self.get_logger().info(f'Cone Follower ACTIVATED. Target: {self.target_color}')
            self.status_pub.publish(String(data="BUSY"))

    def detection_callback(self, msg):
        """
        Received new data from the camera node (cone_detector).
        The message is a JSON string containing a list of detected cones.
        """
        try:
            data = json.loads(msg.data)
            dets = data.get('detections', [])
            
            # Robust filtering
            filtered = []
            for d in dets:
                # 1. Confidence Check
                conf = float(d.get('confidence', 1.0)) if d.get('confidence') is not None else 1.0
                if conf < self.conf_threshold:
                    continue
                
                # 2. Key Validation (Prevent Crashes)
                if 'center' not in d or 'depth_m' not in d:
                    continue
                    
                # 3. Type Conversion (Ensure floats)
                try:
                    d['depth_m'] = float(d.get('depth_m', 0.0))
                    d['center'] = [float(d['center'][0]), float(d['center'][1])]
                    d['confidence'] = float(conf)
                except (ValueError, TypeError):
                    continue
                    
                filtered.append(d)

            self.latest_detections = filtered
            
            # Update image width if the camera node sent it, so our math matches the camera resolution
            if 'width' in data:
                try:
                    self.image_width = float(data['width'])
                except (ValueError, TypeError):
                    pass
        except json.JSONDecodeError:
            pass

    def stop_rover(self):
        """Helper to act just stop the wheels."""
        self.velocity_pub.publish(Twist())

    # =================================================================================================
    # STAGE 3: MAIN CONTROL LOOP
    # This runs 10 times per second.
    # =================================================================================================
    def control_loop(self):
        # 3.1: Safety Check
        # If we aren't active or don't have a target color, do nothing.
        if not self.active or not self.target_color:
            return

        # 3.2: Filter Candidates
        # Look through all detections and find the ones that match our target color.
        target_cone = None
        # Note: self.latest_detections is already filtered for valid depth/center in callback
        candidates = [d for d in self.latest_detections if d.get('color', '').lower() == self.target_color]
        
        # =============================================================================================
        # STAGE 4: SEARCH BEHAVIOR (No Cone Found)
        # =============================================================================================
        if not candidates:
            # If we don't see the cone, we spin slowly to look around.
            # This logic is retained from the original node as it is robust.
            self.get_logger().info("Searching for cone...", throttle_duration_sec=2)
            twist = Twist()
            twist.angular.z = 0.5  # Spin speed (positive = left/CCW)
            self.velocity_pub.publish(twist)
            return

        # =============================================================================================
        # STAGE 5: TARGET SELECTION (Cone Found)
        # =============================================================================================
        
        # Pick the closest cone (Smallest Depth). 
        # This effectively selects the "dominant" cone just like the Area logic of the old script.
        # We also treat depth < 0.1 as invalid (very close/noise) and push it to end
        candidates.sort(key=lambda x: x['depth_m'] if x['depth_m'] > 0.1 else 999.0)
        target_cone = candidates[0] # The winner is the first one in the sorted list

        # =============================================================================================
        # STAGE 6: CONTROL LOGIC (Calculate Movement) - MERGED LOGIC
        # =============================================================================================

        center_x = target_cone['center'][0]
        img_center = self.image_width / 2.0
        
        # 1. Calculate Error (Pixel based)
        # Logic: error = center - cx
        # If cone is to the Left (e.g. 100), error = 640 - 100 = 540 (Positive) -> Turn Left (Positive Z)
        error_px = img_center - center_x
        
        # 2. Scale Error
        # The original logic used hardcoded values for 640x480 resolution (center 320).
        # We normalize our error to match that scale so the PID constants work as intended.
        scale_factor = 640.0 / self.image_width 
        scaled_error = error_px * scale_factor

        # 3. Calculate Angular Velocity
        # Formula: angular = error * 0.2 / 80
        angular_z = scaled_error * 0.2 / 80.0
        


        # 4. Check Depth & Success
        depth = target_cone.get('depth_m')
        
        if depth and depth > 0.1 and depth < self.stop_distance:
             # =========================================================================================
             # STAGE 7: GOAL REACHED
             # =========================================================================================
             self.stop_rover()
             self.active = False
             self.status_pub.publish(String(data="SUCCESS"))
             self.get_logger().info(f'Reached {self.target_color} cone! (Dist: {depth:.2f}m)')
             return

        # 5. Movement Decision (Yaw Threshold)
        twist = Twist()
        # Scale the threshold (40px on 640 width) to current resolution
        start_drive_threshold = self.yaw_threshold / scale_factor
        
        if abs(error_px) > start_drive_threshold:
             # Logic: "Align First"
             # Error is too high, so we ONLY turn. No forward movement.
             twist.linear.x = 0.0          # STOP forward motion
             twist.angular.z = angular_z   # TURN only
        else:
             # Logic: "Move Forward"
             # We are aligned enough. Drive forward.
             twist.linear.x = self.linear_vel
             #twist.angular.z = angular_z   # Keep fine corrections while driving
             
        # =============================================================================================
        # STAGE 8: EXECUTION
        # =============================================================================================
        self.velocity_pub.publish(twist)

def main(args=None):
    rclpy.init(args=args)
    node = ConeFollower()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()
    