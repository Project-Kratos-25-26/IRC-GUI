#!/usr/bin/env bash
# start_mission.sh
# Dynamic "Lego-style" launcher for mission components.
# Usage: ./start_mission.sh [target]
# targets: rtabmap, tf, nav2, velclamp, mavros, cone, rado

set -e

# --- CONFIGURATION ---
JETSON_USER="kratos"
JETSON_IP="192.168.1.10"
PASS="kratos123"
SESSION="mission_ui"

TARGET="${1:-all}"

echo "[START] Requested component: $TARGET"

# --- COMMAND DEFINITIONS ---
SSH_PRE="sshpass -p "$PASS" ssh -tt $JETSON_USER@$JETSON_IP"
ROS_SRC="source ~/ros2_ws/install/setup.bash"

case "$TARGET" in
    "rtabmap")
        TITLE="RTAB-Map"
        CMD="${SSH_PRE} '${ROS_SRC} && ros2 launch kratos_rtabmap kratos_rtabmap.launch.py; exec bash'"
        ;;
    "tf")
        TITLE="TF_Static"
        CMD="${SSH_PRE} '${ROS_SRC} && ros2 run tf2_ros static_transform_publisher -0.4 0.0 0.0 0.0 0.0 0.0 zed_camera_link base_link; exec bash'"
        ;;
    "nav2")
        TITLE="Nav2"
        CMD="${SSH_PRE} '${ROS_SRC} && ros2 launch kratos_nav2 kratos_nav2.launch.py; exec bash'"
        ;;
    "velclamp")
        TITLE="VelClamp"
        CMD="${SSH_PRE} '${ROS_SRC} && ros2 run kratos_vel_clamp velclamp.py; exec bash'"
        ;;
    "mavros")
        TITLE="MAVROS"
        # Includes chmod fix
        CMD="${SSH_PRE} '${ROS_SRC} && sudo chmod 666 /dev/tty* 2>/dev/null; ros2 launch mavros px4.launch; exec bash'"
        ;;
    "cone")
        TITLE="ConeDetector"
        CMD="${SSH_PRE} '${ROS_SRC} && ros2 run cone_detector cone_detector_node; exec bash'"
        ;;
    "rado")
        TITLE="RADOControl"
        CMD="${SSH_PRE} '${ROS_SRC} && ros2 launch rado_control_3 rado_mission.launch.py; exec bash'"
        ;;
    "all")
        # Run sequentially to avoid tmux race conditions (panes overlapping)
        # Sleep slightly between them to allow tmux to register the layout
        bash "$0" rtabmap
        sleep 0.5
        bash "$0" tf
        sleep 0.5
        bash "$0" nav2
        sleep 0.5
        bash "$0" velclamp
        sleep 0.5
        bash "$0" mavros
        sleep 0.5
        bash "$0" cone
        sleep 0.5
        bash "$0" rado
        exit 0
        ;;
    *)
        echo "Unknown target: $TARGET"
        exit 1
        ;;
esac

# --- DYNAMIC PANE MANAGEMENT ---

# 1. Ensure Session Exists
if ! tmux has-session -t $SESSION 2>/dev/null; then
    echo "Creating new session: $SESSION"
    tmux new-session -d -s $SESSION
    tmux rename-window -t $SESSION:0 'MissionControl'
    tmux set -t $SESSION pane-border-status top
    tmux set -t $SESSION pane-border-format "#{pane_index}: #{pane_title}"
    
    # First pane is ours by default
    tmux select-pane -t $SESSION:0.0
    tmux select-pane -T "$TITLE"
    tmux respawn-pane -k -t $SESSION:0.0 "bash"
    tmux send-keys -t $SESSION:0.0 "$CMD" C-m
    
    echo "Started $TITLE in first pane."
else
    # Session exists. Check if our pane exists.
    PANE_ID=$(tmux list-panes -t $SESSION:0 -F "#{pane_id} #{pane_title}" | grep "$TITLE" | awk '{print $1}')
    
    if [ -n "$PANE_ID" ]; then
        # RESTART EXISTING
        echo "Restarting $TITLE in existing pane $PANE_ID..."
        tmux select-pane -t "$PANE_ID"
        tmux select-pane -T "$TITLE" # Ensure title matches
        tmux respawn-pane -k -t "$PANE_ID" "bash"
        tmux send-keys -t "$PANE_ID" "$CMD" C-m
    else
        # CREATE NEW (LEGO STYLE)
        echo "Adding new Lego block for $TITLE..."
        
        # Split logic: We just split the currently active pane or pane 0.
        # To make it grid-like, we rely on tmux's tiling.
        
        tmux split-window -t $SESSION:0
        tmux select-layout -t $SESSION:0 tiled
        
        # The new pane becomes active. Get its ID.
        NEW_PANE=$(tmux display-message -p -t $SESSION:0 "#{pane_id}")
        
        tmux select-pane -t "$NEW_PANE"
        tmux select-pane -T "$TITLE"
        tmux send-keys -t "$NEW_PANE" "$CMD" C-m
        
        echo "Started $TITLE in new pane $NEW_PANE."
    fi
fi

# Bring to foreground if running in a GUI terminal context
echo "[LOCAL] Checking for existing terminal window..." >> /tmp/mission_debug.log

if ! pgrep -f "tmux attach -t $SESSION" > /dev/null; then
    echo "[LOCAL] launching new terminal window..." >> /tmp/mission_debug.log
    
    # Try terminator first (User Request)
    if command -v terminator &> /dev/null; then
        terminator -T "Mission: Unified Control" -e "tmux attach -t $SESSION" &
    # Try gnome-terminal
    elif command -v gnome-terminal &> /dev/null; then
        gnome-terminal --title="Mission: Unified Control" -- tmux attach -t $SESSION
    # Fallback to x-terminal-emulator
    elif command -v x-terminal-emulator &> /dev/null; then
        x-terminal-emulator -T "Mission: Unified Control" -e "tmux attach -t $SESSION" &
    # Fallback to konsole
    elif command -v konsole &> /dev/null; then
        konsole -e "tmux attach -t $SESSION" &
    else
        echo "[ERROR] No suitable terminal emulator found!" >> /tmp/mission_debug.log
    fi
else
    echo "[LOCAL] Terminal already attached." >> /tmp/mission_debug.log
fi