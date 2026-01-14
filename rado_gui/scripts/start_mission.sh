#!/usr/bin/env bash
set -e

# Jetson Orin Configuration
JETSON_USER="kratos"
JETSON_IP="192.168.1.10"
JETSON_PASSWORD="kratos123"
SESSION="mission_ui"

echo "================================="
echo "   MISSION INITIALIZATION"
echo "================================="
echo ""

# Set TTY permissions (may require sudo password)
echo "Setting TTY permissions..."
sudo chmod 666 /dev/tty*
echo "✓ TTY permissions set"
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

# 5. MAVROS (runs last, after 10s delay for everything to initialize)
CMD_5="${SSH_PRE} '${ROS_SRC} && echo \"Waiting 10s for other nodes...\" && sleep 10 && ros2 launch mavros px4.launch; exec bash'"

# 6. Cone Detector (runs on Orin, 3s delay)
CMD_6="${SSH_PRE} '${ROS_SRC} && echo \"Waiting 3s...\" && sleep 3 && ros2 run cone_detector cone_detector_node; exec bash'"

# 7. RADO Control (runs on Orin, 5s delay - needs to be on same machine as Nav2/MAVROS)
CMD_7="${SSH_PRE} '${ROS_SRC} && echo \"Waiting 5s...\" && sleep 5 && ros2 launch rado_control_3 rado_mission.launch.py; exec bash'"

# Ensure Session Exists
if ! tmux has-session -t $SESSION 2>/dev/null; then
    echo "Creating new session: $SESSION"
    tmux new-session -d -s $SESSION
    tmux rename-window -t $SESSION:0 'MissionControl'

    # Enable Panel Titles
    tmux set -t $SESSION pane-border-status top
    tmux set -t $SESSION pane-border-format "#{pane_index}: #{pane_title}"

    # Setup 7 panes in tiled layout
    # Pane 0 is top-left
    # Split horizontally to get Pane 1 (top-right)
    tmux split-window -h -t $SESSION:0.0
    # Split Pane 0 vertically to get Pane 2 (bottom-left)
    tmux split-window -v -t $SESSION:0.0
    # Split Pane 1 vertically to get Pane 3 (bottom-right)
    tmux split-window -v -t $SESSION:0.1
    # Split Pane 2 horizontally to get Pane 4
    tmux split-window -h -t $SESSION:0.2
    # Split Pane 3 horizontally to get Pane 5
    tmux split-window -h -t $SESSION:0.3
    # Split Pane 4 vertically to get Pane 6
    tmux split-window -v -t $SESSION:0.4
    
    tmux select-layout -t $SESSION:0 tiled

    # Pane 0: RTABMAP
    tmux select-pane -t $SESSION:0.0
    tmux select-pane -T "RTAB-Map"
    tmux respawn-pane -k -t $SESSION:0.0 "bash"
    tmux send-keys -t $SESSION:0.0 "$CMD_1" C-m

    # Pane 1: TF
    tmux select-pane -t $SESSION:0.1
    tmux select-pane -T "TF_Static"
    tmux respawn-pane -k -t $SESSION:0.1 "bash"
    tmux send-keys -t $SESSION:0.1 "$CMD_2" C-m

    # Pane 2: Nav2
    tmux select-pane -t $SESSION:0.2
    tmux select-pane -T "Nav2"
    tmux respawn-pane -k -t $SESSION:0.2 "bash"
    tmux send-keys -t $SESSION:0.2 "$CMD_3" C-m

    # Pane 3: Vel Clamp
    tmux select-pane -t $SESSION:0.3
    tmux select-pane -T "VelClamp"
    tmux respawn-pane -k -t $SESSION:0.3 "bash"
    tmux send-keys -t $SESSION:0.3 "$CMD_4" C-m

    # Pane 4: MAVROS (runs last)
    tmux select-pane -t $SESSION:0.4
    tmux select-pane -T "MAVROS"
    tmux respawn-pane -k -t $SESSION:0.4 "bash"
    tmux send-keys -t $SESSION:0.4 "$CMD_5" C-m

    # Pane 5: Cone Detector
    tmux select-pane -t $SESSION:0.5
    tmux select-pane -T "ConeDetector"
    tmux respawn-pane -k -t $SESSION:0.5 "bash"
    tmux send-keys -t $SESSION:0.5 "$CMD_6" C-m

    # Pane 6: RADO Control (local)
    tmux select-pane -t $SESSION:0.6
    tmux select-pane -T "RADOControl"
    tmux respawn-pane -k -t $SESSION:0.6 "bash"
    tmux send-keys -t $SESSION:0.6 "$CMD_7" C-m

    echo "✓ Session started with 7 panes (6 remote + 1 local)."

else
    echo "Session $SESSION already exists. Respawning panes..."
    
    # Ensure titles are on
    tmux set -t $SESSION pane-border-status top
    tmux set -t $SESSION pane-border-format "#{pane_index}: #{pane_title}"

    # We assume the layout is roughly correct or we just target indices if they exist.
    # To be safe using similar logic to start_drive, we could look up by title, but 
    # since we are enforcing a structure, let's just use indices 0-3.
    # If the user messed with the layout manually, this might be weird, but it's a "reset" script.

    # Pane 0: RTABMAP
    tmux select-pane -t $SESSION:0.0
    tmux select-pane -T "RTAB-Map"
    tmux respawn-pane -k -t $SESSION:0.0 "bash"
    tmux send-keys -t $SESSION:0.0 "$CMD_1" C-m

    # Pane 1: TF
    tmux select-pane -t $SESSION:0.1
    tmux select-pane -T "TF_Static"
    tmux respawn-pane -k -t $SESSION:0.1 "bash"
    tmux send-keys -t $SESSION:0.1 "$CMD_2" C-m

    # Pane 2: Nav2
    tmux select-pane -t $SESSION:0.2
    tmux select-pane -T "Nav2"
    tmux respawn-pane -k -t $SESSION:0.2 "bash"
    tmux send-keys -t $SESSION:0.2 "$CMD_3" C-m

    # Pane 3: Vel Clamp
    tmux select-pane -t $SESSION:0.3
    tmux select-pane -T "VelClamp"
    tmux respawn-pane -k -t $SESSION:0.3 "bash"
    tmux send-keys -t $SESSION:0.3 "$CMD_4" C-m

    # Pane 4: MAVROS (runs last)
    # Check if pane 4 exists, if not create it
    if ! tmux list-panes -t $SESSION:0 | grep -q "^4:"; then
        tmux split-window -h -t $SESSION:0.3
    fi
    tmux select-pane -t $SESSION:0.4
    tmux select-pane -T "MAVROS"
    tmux respawn-pane -k -t $SESSION:0.4 "bash"
    tmux send-keys -t $SESSION:0.4 "$CMD_5" C-m

    # Pane 5: Cone Detector
    if ! tmux list-panes -t $SESSION:0 | grep -q "^5:"; then
        tmux split-window -v -t $SESSION:0.4
    fi
    tmux select-pane -t $SESSION:0.5
    tmux select-pane -T "ConeDetector"
    tmux respawn-pane -k -t $SESSION:0.5 "bash"
    tmux send-keys -t $SESSION:0.5 "$CMD_6" C-m

    # Pane 6: RADO Control (local)
    if ! tmux list-panes -t $SESSION:0 | grep -q "^6:"; then
        tmux split-window -h -t $SESSION:0.5
    fi
    tmux select-pane -t $SESSION:0.6
    tmux select-pane -T "RADOControl"
    tmux respawn-pane -k -t $SESSION:0.6 "bash"
    tmux send-keys -t $SESSION:0.6 "$CMD_7" C-m

    tmux select-layout -t $SESSION:0 tiled
    
    echo "✓ Session refreshed."
fi

# Bring to foreground if running in a GUI terminal context
if ! pgrep -f "tmux attach -t $SESSION" > /dev/null; then
    x-terminal-emulator -T "Mission: Unified Control" -e "tmux attach -t $SESSION" &
fi

echo "Done."