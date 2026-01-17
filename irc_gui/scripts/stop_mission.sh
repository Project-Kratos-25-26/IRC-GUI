#!/usr/bin/env bash
# stop_mission.sh
# Kills local tmux session and remote processes on Jetson.
# Usage: ./stop_mission.sh [target]
# If [target] is provided (e.g., 'nav2'), it attempts to kill just that.
# If no target, it kills EVERYTHING (Kill Switch).

JETSON_USER="kratos"
JETSON_IP="192.168.1.10"
PASS="kratos123"
SESSION="mission_ui"

TARGET="${1:-all}"
ssh_cmd="sshpass -p '$PASS' ssh $JETSON_USER@$JETSON_IP"

if [ "$TARGET" = "all" ]; then
    echo "[STOP] KILLING ALL MISSION PROCESSES..."
    
    # 1. Kill Local Tmux Session
    tmux kill-session -t $SESSION 2>/dev/null
    echo " - Local session killed."

    # 2. Kill Remote Processes (The "Double Tap")
    # We explicitly kill the known node names/launch files.
    echo " - Killing remote processes on Jetson..."
    $ssh_cmd "pkill -f kratos_rtabmap; pkill -f static_transform_publisher; pkill -f kratos_nav2; pkill -f velclamp; pkill -f mavros; pkill -f cone_detector_node; pkill -f rado_mission" || true
    
    echo "✓ ALL SYSTEMS DOWN."

else
    # Individual Kill
    # Logic: Find the pane with the matching title and kill it.
    # Remote process cleanup is harder for individual nodes without killing everything,
    # but killing the pane usually stops the ssh->ros2 launch chain.
    # For robustness, we can try to pgrep specific patterns if needed, but pane killing is safer for "lego" logic.
    
    echo "[STOP] Stopping component: $TARGET"
    case "$TARGET" in
        "rtabmap")  PATTERN="RTAB-Map" ;;
        "tf")       PATTERN="TF_Static" ;;
        "nav2")     PATTERN="Nav2" ;;
        "velclamp") PATTERN="VelClamp" ;;
        "mavros")   PATTERN="MAVROS" ;;
        "cone")     PATTERN="ConeDetector" ;;
        "rado")     PATTERN="RADOControl" ;;
        *) echo "Unknown target"; exit 1 ;;
    esac
    
    PANE_ID=$(tmux list-panes -t $SESSION:0 -F "#{pane_id} #{pane_title}" 2>/dev/null | grep "$PATTERN" | awk '{print $1}')
    
    if [ -n "$PANE_ID" ]; then
        tmux kill-pane -t "$PANE_ID"
        echo " - Pane $PATTERN killed."
        # Optional: Explicit remote kill for stubborn processes?
        # For now, let's rely on SSH closing. If not, the "All" button is the backup.
    else
        echo " - Pane for $TARGET not found."
    fi
fi
