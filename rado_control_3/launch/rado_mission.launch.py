import os
from launch import LaunchDescription
from launch_ros.actions import Node
from launch.actions import IncludeLaunchDescription
from launch.launch_description_sources import PythonLaunchDescriptionSource
# --- NEW IMPORT ---
from launch_xml.launch_description_sources import XMLLaunchDescriptionSource 
from ament_index_python.packages import get_package_share_directory

def generate_launch_description():
    pkg_name = 'rado_control_3'
    
    # --- UPDATED ROSBRIDGE BLOCK ---
    rosbridge = IncludeLaunchDescription(
        XMLLaunchDescriptionSource([
            os.path.join(get_package_share_directory('rosbridge_server'), 'launch', 'rosbridge_websocket_launch.xml')
        ])
    )

    return LaunchDescription([
        # 1. The Bridge (Port 9090)
        rosbridge,

        # 2. Video Streamer (Port 8080)
        Node(
            package='web_video_server',
            executable='web_video_server',
            name='web_video_server'
        ),

        # 3. System Monitor (The Doctor)
        Node(
            package=pkg_name,
            executable='system_monitor_node.py',
            name='system_monitor'
        ),

        # 4. Joystick
        Node(package='joy', executable='joy_node', name='joy_node'),
        Node(package='teleop_twist_joy', executable='teleop_node', name='teleop_node',
             remappings=[('/cmd_vel', '/manual/cmd_vel')]),

        # 5. State Manager
        Node(
            package=pkg_name,
            executable='state_manager_node.py',
            name='state_manager'
        ),

        # 6. Coordinate Follower
        Node(
            package=pkg_name,
            executable='coordinate_follower_node.py',
            name='coordinate_follower'
        )
    ])