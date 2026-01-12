#!/usr/bin/env bash
set -e

RASPI_USER="kratos"
RASPI_IP="192.168.1.16"
PASS="kratos123"
SESSION="rover_ui"

CMD_MICROROS="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'source ~/rover/install/setup.bash && ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyUSB0'"
CMD_DRIVE="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'source ~/rover/install/setup.bash && export PYTHONUNBUFFERED=1 && ros2 run drive_controls drive.py'"

# 1. Ensure Session Exists
if ! tmux has-session -t $SESSION 2>/dev/null; then
    tmux new-session -d -s $SESSION
    tmux rename-window -t $SESSION:0 'RoverControl'
    
    # Enable Panel Titles
    tmux set -t $SESSION pane-border-status top
    tmux set -t $SESSION pane-border-format "#{pane_index}: #{pane_title}"
    
    # Split Col 1 (Drive)
    tmux split-window -v -t $SESSION:0
    
    # Pane 0: Micro-ROS
    tmux select-pane -t $SESSION:0.0
    tmux select-pane -T "MicroROS_Drive_USB0"
    tmux respawn-pane -k -t $SESSION:0.0 "bash"
    tmux send-keys -t $SESSION:0.0 "$CMD_MICROROS" C-m
    P_TOP=$(tmux display-message -p -t $SESSION:0.0 "#{pane_id}")
    
    # Pane 1: Drive Control
    tmux select-pane -t $SESSION:0.1
    tmux select-pane -T "Drive_Control"
    tmux respawn-pane -k -t $SESSION:0.1 "bash"
    tmux send-keys -t $SESSION:0.1 "$CMD_DRIVE" C-m
    P_BOT=$(tmux display-message -p -t $SESSION:0.1 "#{pane_id}")

    # Launch Monitor Loop for Drive Column
    (
        while tmux list-panes -t "$P_TOP" >/dev/null 2>&1 && tmux list-panes -t "$P_BOT" >/dev/null 2>&1; do
            sleep 1
        done
        tmux kill-pane -t "$P_TOP" 2>/dev/null
        tmux kill-pane -t "$P_BOT" 2>/dev/null
    ) & disown

else
    # Session exists.
    tmux set -t $SESSION pane-border-status top
    tmux set -t $SESSION pane-border-format "#{pane_index}: #{pane_title}"
    
    DRIVE_PANE_ID=$(tmux list-panes -t $SESSION:0 -F "#{pane_id} #{pane_title}" | grep "Drive_Control" | awk '{print $1}')
    
    if [ -z "$DRIVE_PANE_ID" ]; then
        DRIVE_PANE_ID="$SESSION:0.1"
        tmux select-pane -t $DRIVE_PANE_ID -T "Drive_Control"
    fi
    
    tmux respawn-pane -k -t $DRIVE_PANE_ID "bash"
    sleep 0.5
    tmux send-keys -t $DRIVE_PANE_ID "$CMD_DRIVE" C-m
fi

# Cleanup Teleop
TELEOP_PANE_ID=$(tmux list-panes -t $SESSION:0 -F "#{pane_id} #{pane_title}" | grep "Teleop_Input" | awk '{print $1}')
if [ -n "$TELEOP_PANE_ID" ]; then
    tmux kill-pane -t $TELEOP_PANE_ID
fi

if ! pgrep -f "tmux attach -t $SESSION" > /dev/null; then
    x-terminal-emulator -T "Rover: Unified Control" -e "tmux attach -t $SESSION" &
fi

datadir="$(cd "$(dirname "$0")" && pwd)/../data"
if ! pgrep -f "ssh.*pgrep.*micro_ros" > /dev/null; then
    ( while true; do
      sshpass -p '$PASS' ssh $RASPI_USER@$RASPI_IP \
        "pgrep -f micro_ros_agent >/dev/null && echo RUNNING || echo STOPPED" \
        > "$datadir/microros.txt"
      sleep 2
    done ) &
fi