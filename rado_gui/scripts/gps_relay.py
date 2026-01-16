#!/usr/bin/env python3
"""
GPS Relay Node - Republishes MAVROS GPS data with RELIABLE QoS for rosbridge compatibility.
MAVROS publishes with BEST_EFFORT, but rosbridge subscriptions default to RELIABLE.
"""

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
from sensor_msgs.msg import NavSatFix


class GPSRelay(Node):
    def __init__(self):
        super().__init__('gps_relay')
        
        # QoS for subscribing to MAVROS (BEST_EFFORT)
        mavros_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            depth=10
        )
        
        # QoS for publishing to GUI (RELIABLE - rosbridge compatible)
        gui_qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            durability=DurabilityPolicy.VOLATILE,
            depth=10
        )
        
        self.sub = self.create_subscription(
            NavSatFix,
            '/mavros/global_position/global',
            self.gps_callback,
            mavros_qos
        )
        
        self.pub = self.create_publisher(
            NavSatFix,
            '/gps/global',
            gui_qos
        )
        
        self.get_logger().info('GPS Relay started: /mavros/global_position/global -> /gps/global')

    def gps_callback(self, msg):
        self.pub.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = GPSRelay()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
