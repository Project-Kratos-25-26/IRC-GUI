#!/bin/bash
gnome-terminal --title="Servo Control" -- bash -c "source /opt/ros/humble/setup.bash; \
[ -f ~/microros_ws/install/setup.bash ] && source ~/microros_ws/install/setup.bash; \
[ -f ~/ros2_ws/install/setup.bash ] && source ~/ros2_ws/install/setup.bash; \
ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyUSB0 || read -p 'Command failed. Press enter to close...'; exec bash"
