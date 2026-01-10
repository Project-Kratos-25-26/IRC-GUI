#!/bin/bash

MODE="$1"
RASPI_USER="kratos"
RASPI_IP="192.168.1.16"
PASS="kratos123"
SESSION="rover_ui"

echo "Switching to mode: $MODE"

CMD_MANUAL="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'source ~/rover/install/setup.bash && export PYTHONUNBUFFERED=1 && ros2 run drive_controls drive.py; exec bash'"
CMD_AUTO="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'source ~/rover/install/setup.bash && export PYTHONUNBUFFERED=1 && ros2 run drive_controls drive_auto.py; exec bash'"
CMD_TELEOP="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'source ~/rover/install/setup.bash && ros2 run teleop_twist_keyboard teleop_twist_keyboard; exec bash'"

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
    
    # 2. Check/Create Teleop Split
    TELEOP_PANE_ID=$(tmux list-panes -t $SESSION:0 -F "#{pane_id} #{pane_title}" | grep "Teleop_Input" | awk '{print $1}')
    
    if [ -z "$TELEOP_PANE_ID" ]; then
        # Create split from Drive Pane
        tmux split-window -h -t $DRIVE_PANE_ID
        # New split is active
        tmux select-pane -T "Teleop_Input"
        TELEOP_PANE_ID=$(tmux display-message -p "#{pane_id}")
    else
        # Just select it
        tmux select-pane -t $TELEOP_PANE_ID
    fi
    
    # 3. Run Teleop
    tmux respawn-pane -k -t $TELEOP_PANE_ID "bash"
    sleep 0.5
    tmux send-keys -t $TELEOP_PANE_ID "$CMD_TELEOP" C-m
    
else
    echo "Unknown mode: $MODE"
fi
