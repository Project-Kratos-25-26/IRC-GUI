import os
from launch import LaunchDescription
from launch_ros.actions import Node, SetRemap
from launch.actions import IncludeLaunchDescription, DeclareLaunchArgument, GroupAction
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
# --- NEW IMPORT ---
from launch_xml.launch_description_sources import XMLLaunchDescriptionSource 
from ament_index_python.packages import get_package_share_directory

def generate_launch_description():
    pkg_name = 'rado_control_3'
    use_sim_time = LaunchConfiguration('use_sim_time', default='true')

    # --- 1. RTAB-Map (SLAM & Mapping) ---
    rtabmap_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([
            os.path.join(get_package_share_directory('rtabmap_launch'), 'launch', 'rtabmap.launch.py')
        ]),
        launch_arguments={
            'rtabmap_args': '--delete_db_on_start', # Start fresh map every time
            'frame_id': 'base_link',
            'odom_topic': '/odom', # Use MAVROS odometry
            'visual_odometry': 'false', # Use simulation/wheel odometry instead
            'subscribe_depth': 'true',
            'approx_sync': 'true',
            'wait_for_transform': '0.2',
            'qos': '1',
            'rgb_topic': '/zed/zed_node/left/image_rect_color',
            'depth_topic': '/zed/zed_node/depth/depth_registered',
            'camera_info_topic': '/zed/zed_node/left/camera_info',
        }.items()
    )

    # --- 3. Nav2 (Navigation Stack) ---
    # Remap Nav2 output to /auto/cmd_vel so State Manager can control it
    nav2_launch = GroupAction([
        SetRemap(src='/cmd_vel', dst='/auto/cmd_vel'),
        IncludeLaunchDescription(
            PythonLaunchDescriptionSource([
                os.path.join(get_package_share_directory('nav2_bringup'), 'launch', 'navigation_launch.py')
            ]),
            launch_arguments={
                'use_sim_time': use_sim_time,
                'autostart': 'true',
                'params_file': os.path.join(get_package_share_directory(pkg_name), 'config', 'nav2_params.yaml')
            }.items()
        )
    ])
    
    # --- UPDATED ROSBRIDGE BLOCK ---
    rosbridge = IncludeLaunchDescription(
        XMLLaunchDescriptionSource([
            os.path.join(get_package_share_directory('rosbridge_server'), 'launch', 'rosbridge_websocket_launch.xml')
        ])
    )

    return LaunchDescription([
        # --- Navigation Stack ---
        rtabmap_launch,
        nav2_launch,

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

        # 6. Coordinate Follower (Mission Manager)
        Node(
            package=pkg_name,
            executable='nav2_coordinate_follower.py',
            name='coordinate_follower'
        ),

        # 7. Cone Follower (Vision Pilot)
        Node(
            package=pkg_name,
            executable='cone_follower_node.py',
            name='cone_follower'
        )
    ])