# mission_only.launch.py
from launch import LaunchDescription
from launch_ros.actions import Node

def generate_launch_description():
    return LaunchDescription([
        Node(
            package='rado_control_3',
            executable='system_monitor_node.py',
            name='system_monitor'
        ),
        Node(
            package='rado_control_3',
            executable='state_manager_node.py',
            name='state_manager'
        ),
        Node(
            package='rado_control_3',
            executable='coordinate_follower_node.py',
            name='mission_manager',
            parameters=[
                {'use_sim_time': True},
                {'map_frame': 'map'}
            ]
        ),
        Node(
            package='rado_control_3',
            executable='cone_follower_node.py',
            name='cone_follower'
        )
    ])

