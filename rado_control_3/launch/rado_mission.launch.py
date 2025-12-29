import os
from launch import LaunchDescription
from launch_ros.actions import Node, SetRemap
from launch.actions import IncludeLaunchDescription, DeclareLaunchArgument, GroupAction, LogInfo
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration
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
            'rtabmap_args': '--delete_db_on_start',
            'frame_id': 'base_link',
            'odom_topic': '/odom',
            'visual_odometry': 'false',
            'subscribe_depth': 'true',
            'approx_sync': 'true',
            'wait_for_transform': '0.2',
            'qos': '1',
            'use_sim_time': 'true',
            'rgb_topic': '/zed/zed_node/left/image_rect_color',
            'depth_topic': '/zed/zed_node/depth/depth_registered',
            'camera_info_topic': '/zed/zed_node/left/camera_info',
        }.items()
    )

    # --- 2. Nav2 (Navigation Stack) ---
    # Now uses nav2_params.yaml from THIS package (rado_control_3)
    nav2_config_path = '/home/neel/ros2_ws/src/Main_Control/rado_control_3/config/nav2_params.yaml'
    
    # Debug: Print the params file path
    print(f"[DEBUG] Nav2 params_file: {nav2_config_path}")
    
    nav2_launch = IncludeLaunchDescription(
        PythonLaunchDescriptionSource([
            os.path.join(get_package_share_directory('nav2_bringup'), 'launch', 'navigation_launch.py')
        ]),
        launch_arguments={
            'use_sim_time': 'true',
            'autostart': 'true',
            'slam': 'false',
            'params_file': nav2_config_path,
        }.items()
    )
    
    # --- 3. ROS Bridge ---
    rosbridge = IncludeLaunchDescription(
        XMLLaunchDescriptionSource([
            os.path.join(get_package_share_directory('rosbridge_server'), 'launch', 'rosbridge_websocket_launch.xml')
        ])
    )

    return LaunchDescription([
        # Navigation Stack
        rtabmap_launch,
        nav2_launch,

        # Web Interface
        rosbridge,
        Node(
            package='web_video_server',
            executable='web_video_server',
            name='web_video_server'
        ),

        # Control Nodes
        Node(
            package=pkg_name,
            executable='system_monitor_node.py',
            name='system_monitor'
        ),

        # Joystick Control
        Node(package='joy', executable='joy_node', name='joy_node'),
        Node(
            package='teleop_twist_joy',
            executable='teleop_node',
            name='teleop_node',
            remappings=[('/cmd_vel', '/manual/cmd_vel')]
        ),

        # State Manager
        Node(
            package=pkg_name,
            executable='state_manager_node.py',
            name='state_manager'
        ),

        # Coordinate Follower (Mission Manager with Nav2)
        Node(
            package=pkg_name,
            executable='coordinate_follower_node.py',
            name='coordinate_follower',
            parameters=[{
                'use_sim_time': use_sim_time,
                'map_frame': 'map',
                'gps_origin_lat': 0.0,  # SET YOUR MAP ORIGIN
                'gps_origin_lon': 0.0   # SET YOUR MAP ORIGIN
            }]
        ),

        # Cone Follower (Vision-based final approach)
        Node(
            package=pkg_name,
            executable='cone_follower_node.py',
            name='cone_follower'
        ),
    ])
