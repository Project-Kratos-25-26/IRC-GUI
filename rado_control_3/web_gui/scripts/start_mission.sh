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

# Commands to run on the Orin (wrapped in SSH)
SSH_PRE="sshpass -p '${JETSON_PASSWORD}' ssh -tt ${JETSON_USER}@${JETSON_IP}"
SSH_CMD="sshpass -p '${JETSON_PASSWORD}' ssh ${JETSON_USER}@${JETSON_IP}"
ROS_SRC="source ~/ros2_ws/install/setup.bash"

# Cleanup function to kill all ROS processes on Jetson
cleanup_jetson() {
    echo "Cleaning up Jetson ROS processes..."
    $SSH_CMD "pkill -f 'ros2|rtabmap|nav2|zed' 2>/dev/null || true"
    echo "Cleanup complete."
}

# 1. RTABMAP (Immediate)
CMD_1="${SSH_PRE} '${ROS_SRC} && ros2 launch kratos_rtabmap kratos_rtabmap.launch.py'"

# 2. TF (5s delay)
CMD_2="${SSH_PRE} '${ROS_SRC} && echo \"Waiting 5s...\" && sleep 5 && ros2 run tf2_ros static_transform_publisher -0.4 0.0 0.0 0.0 0.0 0.0 zed_camera_link base_link'"

# 3. NAV2 (5s + 3s = 8s delay)
CMD_3="${SSH_PRE} '${ROS_SRC} && echo \"Waiting 8s...\" && sleep 8 && ros2 launch kratos_nav2 kratos_nav2.launch.py'"

# 4. VEL CLAMP (No delay specified, running immediately/parallel)
CMD_4="${SSH_PRE} '${ROS_SRC} && ros2 run kratos_vel_clamp velclamp.py'"

# Ensure Session Exists
if ! tmux has-session -t $SESSION 2>/dev/null; then
    echo "Creating new session: $SESSION"
    tmux new-session -d -s $SESSION
    tmux rename-window -t $SESSION:0 'MissionControl'

    # Kill session when last client detaches
    tmux set-option -t $SESSION destroy-unattached on

    # Enable Panel Titles
    tmux set -t $SESSION pane-border-status top
    tmux set -t $SESSION pane-border-format "#{pane_index}: #{pane_title}"
    
    # Start background cleanup monitor
    (
        while tmux has-session -t $SESSION 2>/dev/null; do
            sleep 1
        done
        # Session is gone, cleanup remote processes
        cleanup_jetson
    ) &

    # Setup 2x2 Grid
    # Pane 0 is top-left
    # Split horizontally to get Pane 1 (top-right)
    tmux split-window -h -t $SESSION:0.0
    # Split Pane 0 vertically to get Pane 2 (bottom-left)
    tmux split-window -v -t $SESSION:0.0
    # Split Pane 1 vertically to get Pane 3 (bottom-right)
    tmux split-window -v -t $SESSION:0.1
    
    # Layout should now be:
    # 0 | 1
    # --+--
    # 2 | 3
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

    echo "✓ Session started with 4 remote panes."

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
    
    echo "✓ Session refreshed."
fi

# Bring to foreground if running in a GUI terminal context
if ! pgrep -f "tmux attach -t $SESSION" > /dev/null; then
    x-terminal-emulator -T "Mission: Unified Control" -e "tmux attach -t $SESSION" &
fi

echo "Done."
