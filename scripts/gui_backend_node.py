#!/usr/bin/env python3
import rclpy
from rclpy.node import Node
from std_msgs.msg import String
import subprocess
import os
from ament_index_python.packages import get_package_share_directory

class GuiBackend(Node):
    def __init__(self):
        super().__init__('gui_backend')
        
        # Subscribe to system commands from the Web GUI
        self.sys_sub = self.create_subscription(String, '/sys/command', self.command_callback, 10)
        
        self.script_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../irc_gui/scripts'))
        
        # Subscribe to log requests
        self.log_sub = self.create_subscription(String, '/gui/log_request', self.log_callback, 10)
        
        self.get_logger().info(f"GUI Backend Node Started. Listening on /sys/command.")

    def command_callback(self, msg):
        cmd = msg.data
        self.get_logger().info(f"Received command: {cmd}")
        
        if cmd == 'init_drive':
            self.run_script('start_drive.sh')
        elif cmd == 'init_servo':
            self.run_script('servo.sh')
        elif cmd == 'init_ld':
            self.run_script('start_ld.sh')
        elif cmd == 'init_arm':
            self.run_script('start_arm.sh')
        elif cmd == 'manual_mode' or cmd == 'MANUAL':
            self.run_script('switch_mode.sh', ['thrustmaster'])
        elif cmd == 'auto_mode' or cmd == 'PROCEED':
            self.run_script('switch_mode.sh', ['keyboard'])
        elif cmd == 'restart_mavros':
            self.get_logger().warn("Restart MAVROS not fully implemented in backend yet.")
        elif cmd == 'init_mission':
            self.run_script('start_mission.sh')

    def log_callback(self, msg):
        try:
            # Format: Type|Color|Lat|Lon (e.g., pickup|RED|12.345|67.890)
            parts = msg.data.split('|')
            if len(parts) >= 4:
                raw_type, raw_color, lat, lon = parts[0], parts[1], parts[2], parts[3]
                
                # Type is already 'pickup' or 'dropoff' from the new dropdown
                obj_type = raw_type.lower().strip()
                color = raw_color.lower().strip()
                
                # CSV Format: type,color,lat,lon
                line = f"{obj_type},{color},{lat},{lon}\n"
                
                # Append to file
                with open(self.mission_file, "a") as f:
                    f.write(line)
                
                self.get_logger().info(f"Logged to Mission Plan: {line.strip()} -> {self.mission_file}")
            else:
                self.get_logger().warn(f"Invalid log format: {msg.data}")
        except Exception as e:
            self.get_logger().error(f"Failed to write log: {e}")

    def run_script(self, script_name, args=[]):
        script_path = os.path.join(self.script_dir, script_name)
        
        if not os.path.exists(script_path):
            self.get_logger().error(f"Script not found: {script_path}")
            return

        try:
            # We execute it using subprocess
            cmd = [script_path] + args
            self.get_logger().info(f"Executing: {' '.join(cmd)}")
            
            # Pass environment with DISPLAY set for x-terminal-emulator
            env = os.environ.copy()
            if 'DISPLAY' not in env:
                env['DISPLAY'] = ':0'
            
            # Use Popen to run it with proper environment
            subprocess.Popen(cmd, cwd=self.script_dir, env=env)
            
        except Exception as e:
            self.get_logger().error(f"Failed to run script: {e}")

def main(args=None):
    rclpy.init(args=args)
    node = GuiBackend()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()