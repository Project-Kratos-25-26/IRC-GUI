#!/bin/bash

MODE="$1"
RASPI_USER="kratos"
RASPI_IP="192.168.1.16"
PASS="kratos123"
SESSION="rover_ui"

echo "Switching to mode: $MODE"

CMD_MANUAL="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'source ~/rover/install/setup.bash && export PYTHONUNBUFFERED=1 && ros2 run drive_controls drive.py; exec bash'"
CMD_AUTO="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'source ~/rover/install/setup.bash && export PYTHONUNBUFFERED=1 && ros2 run drive_controls drive_auto.py; exec bash'"
CMD_KILL="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'pkill -f drive.py; pkill -f drive_auto.py' || true"

if ! tmux has-session -t $SESSION 2>/dev/null; then
    echo "Session $SESSION not found. Please init drive first."
    exit 1
fi

# Find Drive Pane by Title "Drive_Control"
# (Use awk to get first word which is pane_id)
DRIVE_PANE_ID=$(tmux list-panes -t $SESSION:0 -F "#{pane_id} #{pane_title}" | grep "Drive_Control" | awk '{print $1}')

if [ -z "$DRIVE_PANE_ID" ]; then
    echo "Drive Control pane not found!"
    exit 1
fi

echo "Killing previous processes on Raspi..."
eval "$CMD_KILL"


if [ "$MODE" == "thrustmaster" ]; then
    # MANUAL
    
    # 1. Kill Teleop if exists
    TELEOP_PANE_ID=$(tmux list-panes -t $SESSION:0 -F "#{pane_id} #{pane_title}" | grep "Teleop_Input" | awk '{print $1}')
    if [ -n "$TELEOP_PANE_ID" ]; then
        tmux kill-pane -t $TELEOP_PANE_ID
    fi
    
    # 2. Reset Drive Pane
    tmux select-pane -t $DRIVE_PANE_ID
    tmux respawn-pane -k -t $DRIVE_PANE_ID "bash"
    sleep 0.5
    tmux send-keys -t $DRIVE_PANE_ID "$CMD_MANUAL" C-m
    
elif [ "$MODE" == "keyboard" ]; then
    # AUTO
    
    # 1. Reset Drive Pane
    tmux select-pane -t $DRIVE_PANE_ID
    tmux respawn-pane -k -t $DRIVE_PANE_ID "bash"
    sleep 0.5
    tmux send-keys -t $DRIVE_PANE_ID "$CMD_AUTO" C-m
    
else
    echo "Unknown mode: $MODE"
fi