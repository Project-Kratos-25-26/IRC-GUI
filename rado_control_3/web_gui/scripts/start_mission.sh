#!/usr/bin/env bash
set -euo pipefail

# Jetson Orin Configuration
JETSON_USER="kratos"
JETSON_IP="192.168.1.10"
JETSON_PASSWORD="kratos123"
SESSION="mission_ui"

echo "================================="
echo "   MISSION INITIALIZATION"
echo "================================="
echo ""

# Commands to run on the Orin (wrapped in SSH)
SSH_PRE="sshpass -p '${JETSON_PASSWORD}' ssh -tt ${JETSON_USER}@${JETSON_IP}"
ROS_SRC="source ~/ros2_ws/install/setup.bash"

# 1. RTABMAP (Immediate)
CMD_1="${SSH_PRE} '${ROS_SRC} && ros2 launch kratos_rtabmap kratos_rtabmap.launch.py; exec bash'"

# 2. TF (5s delay)
CMD_2="${SSH_PRE} '${ROS_SRC} && echo \"Waiting 5s...\" && sleep 5 && ros2 run tf2_ros static_transform_publisher -0.4 0.0 0.0 0.0 0.0 0.0 zed_camera_link base_link; exec bash'"

# 3. NAV2 (5s + 3s = 8s delay)
CMD_3="${SSH_PRE} '${ROS_SRC} && echo \"Waiting 8s...\" && sleep 8 && ros2 launch kratos_nav2 kratos_nav2.launch.py; exec bash'"

# 4. VEL CLAMP (No delay specified, running immediately/parallel)
CMD_4="${SSH_PRE} '${ROS_SRC} && ros2 run kratos_vel_clamp velclamp.py; exec bash'"

# Ensure single session instance
if ! tmux has-session -t $SESSION 2>/dev/null; then
    echo "Creating new session: $SESSION"
    tmux new-session -d -s $SESSION
    tmux rename-window -t $SESSION:0 'MissionControl'

    # Pane 0: RTABMAP
    tmux select-pane -t $SESSION:0.0
    tmux select-pane -T "RTAB-Map"
    tmux send-keys -t $SESSION:0.0 "$CMD_1" C-m

    # Split for Pane 1: TF (Horizontal split)
    tmux split-window -h -t $SESSION:0.0
    tmux select-pane -t $SESSION:0.1
    tmux select-pane -T "TF_Static"
    tmux send-keys -t $SESSION:0.1 "$CMD_2" C-m

    # Split for Pane 2: Nav2 (Vertical split of Pane 0)
    tmux select-pane -t $SESSION:0.0
    tmux split-window -v -t $SESSION:0.0
    tmux select-pane -t $SESSION:0.2
    tmux select-pane -T "Nav2"
    tmux send-keys -t $SESSION:0.2 "$CMD_3" C-m

    # Split for Pane 3: Vel Clamp (Vertical split of Pane 1)
    tmux select-pane -t $SESSION:0.1
    tmux split-window -v -t $SESSION:0.1
    tmux select-pane -t $SESSION:0.3
    tmux select-pane -T "VelClamp"
    tmux send-keys -t $SESSION:0.3 "$CMD_4" C-m

    # Arrange tiles
    tmux select-layout -t $SESSION:0 tiled
    
    echo "✓ Session started with 4 remote panes."
    
else
    echo "Session $SESSION already exists. attaching..."
fi

# Bring to foreground if running in a GUI terminal context
if ! pgrep -f "tmux attach -t $SESSION" > /dev/null; then
    x-terminal-emulator -T "Mission: Unified Control" -e "tmux attach -t $SESSION" &
fi

echo "Done."
