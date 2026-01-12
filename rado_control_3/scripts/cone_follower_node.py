#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from std_msgs.msg import String
from geometry_msgs.msg import Twist
import json
import math

class ConeFollower(Node):
    def __init__(self):
        super().__init__('cone_follower')

        # State
        self.active = False
        self.target_color = None
        self.latest_detections = []
        self.image_width = 1280.0 # Default fallback
        self.last_detection_time = None
        
        # Tuning
        self.stop_distance = 1.0  # meters
        self.kp_turn = 0.8
        self.kp_drive = 0.5
        self.max_speed = 0.5
        self.conf_threshold = 0.3
        self.debug = True

        # Publishers
        self.velocity_pub = self.create_publisher(Twist, '/auto/cmd_vel', 10)
        self.status_pub = self.create_publisher(String, '/auto/cone_follow/status', 10)

        # Subscribers
        self.create_subscription(String, '/cone_detector/detections', self.detection_callback, 10)
        self.create_subscription(String, '/auto/cone_follow/trigger', self.trigger_callback, 10)

        # Timer
        self.timer = self.create_timer(0.1, self.control_loop)
        self.get_logger().info('Cone Follower Node Ready (Slave Mode)')
        self.get_logger().info(f'Debug logging: {self.debug}, conf_threshold: {self.conf_threshold}')

    def trigger_callback(self, msg):
        command = msg.data.lower().strip()
        if command == 'stop':
            self.active = False
            self.target_color = None
            self.stop_rover()
            self.get_logger().info('Cone Follower STOPPED')
            self.status_pub.publish(String(data="IDLE"))
        else:
            self.target_color = command
            self.active = True
            self.latest_detections = [] # Clear stale data
            self.get_logger().info(f'Cone Follower ACTIVATED. Target: {self.target_color}')
            self.status_pub.publish(String(data="BUSY"))
            if self.debug:
                self.get_logger().info('Waiting for detections...')

    def detection_callback(self, msg):
        try:
            data = json.loads(msg.data)
            dets = data.get('detections', [])
            # Filter detections by confidence if provided
            filtered = []
            for d in dets:
                conf = float(d.get('confidence', 1.0)) if d.get('confidence') is not None else 1.0
                # Ensure depth and center are present
                if conf < self.conf_threshold:
                    continue
                if 'center' not in d or 'depth_m' not in d:
                    continue
                # Cast numeric fields to Python floats
                try:
                    d['depth_m'] = float(d.get('depth_m', 0.0))
                    d['center'] = [float(d['center'][0]), float(d['center'][1])]
                    d['confidence'] = float(conf)
                except Exception:
                    continue
                filtered.append(d)

            self.latest_detections = filtered
            # Update image width if available
            if 'width' in data:
                try:
                    self.image_width = float(data['width'])
                except Exception:
                    pass
            # record time
            self.last_detection_time = self.get_clock().now()

            if self.debug:
                self.get_logger().info(f"Detections received: {len(dets)} -> filtered: {len(filtered)}; image_width={self.image_width}")
                for d in filtered:
                    self.get_logger().info(f"  det: color={d.get('color')} conf={d.get('confidence'):.2f} depth={d.get('depth_m'):.2f} center=({d['center'][0]:.1f},{d['center'][1]:.1f})")
        except json.JSONDecodeError:
            pass

    def stop_rover(self):
        self.velocity_pub.publish(Twist())

    def control_loop(self):
        if not self.active or not self.target_color:
            return

        # Find target cone
        target_cone = None
        # Filter by color and valid depth
        candidates = [d for d in self.latest_detections if d.get('color', '').lower() == self.target_color and d.get('depth_m') is not None]
        
        if not candidates:
            # Search behavior: Spin slowly to find the cone
            self.get_logger().info("Searching for cone...", throttle_duration_sec=2)
            twist = Twist()
            twist.angular.z = 0.4  # Spin speed
            self.velocity_pub.publish(twist)
            return

        # Pick the closest one (smallest depth)
        # We filter out invalid depths (None or 0.0) by treating them as very far (999.0)
        # This ensures we lock onto the closest valid cone.
        candidates.sort(key=lambda x: x.get('depth_m') if x.get('depth_m') and x.get('depth_m') > 0.1 else 999.0)
        target_cone = candidates[0]

        # Control Logic
        center_x = float(target_cone['center'][0])
        
        # Use dynamic image width
        img_width = self.image_width
        error_x = (center_x - (img_width / 2)) / (img_width / 2) # -1 to 1

        depth = target_cone.get('depth_m')

        twist = Twist() 
        
        # Turn
        twist.angular.z = -1.0 * error_x * self.kp_turn

        if self.debug:
            self.get_logger().info(f"Target locked: color={target_cone.get('color')} conf={target_cone.get('confidence'):.2f} depth={depth:.2f} error_x={error_x:.2f}")

        # Drive
        if depth and depth > 0.1: # Ignore invalid/zero depth
            if depth > self.stop_distance:
                twist.linear.x = min(self.max_speed, (depth - self.stop_distance) * self.kp_drive)
                if self.debug:
                    self.get_logger().info(f"Driving: linear.x={twist.linear.x:.2f} angular.z={twist.angular.z:.2f}")
            else:
                # Arrived!
                self.stop_rover()
                self.active = False
                self.status_pub.publish(String(data="SUCCESS"))
                self.get_logger().info(f'Reached {self.target_color} cone!')
                return
        else:
            # No depth, just creep forward blindly? Or just turn? Grace was here lol
            # Safer to just turn until we get depth
            twist.linear.x = 0.1
            if self.debug:
                self.get_logger().info(f"No valid depth yet; turning/searching. angular.z={twist.angular.z:.2f}")

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
