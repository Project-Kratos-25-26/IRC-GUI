#!/usr/bin/env bash
set -e

RASPI_USER="kratos"
RASPI_IP="192.168.1.16"
PASS="kratos123"
SESSION="rover_ui"

CMD_MICROROS="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'source ~/rover/install/setup.bash && ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyUSB1 ; exec bash'"
CMD_LD="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'source ~/rover/install/setup.bash && export PYTHONUNBUFFERED=1 && ros2 run ld_controls ld_mapping '"

if ! tmux has-session -t $SESSION 2>/dev/null; then
    /usr/bin/env bash $(dirname "$0")/start_drive.sh
    sleep 1
fi

if tmux list-panes -t $SESSION:0 -F "#{pane_title}" | grep -q "LD_Control"; then
    echo "LD Control already running."
    if ! pgrep -f "tmux attach -t $SESSION" > /dev/null; then
        x-terminal-emulator -T "Rover: Unified Control" -e "tmux attach -t $SESSION" &
    fi
    exit 0
fi

# Create New Column (Right)
tmux split-window -h -f -t $SESSION:0

# Split Vertically
tmux split-window -v

# Bottom (Active) -> LD_Control
tmux select-pane -T "LD_Control"
tmux respawn-pane -k "bash"
tmux send-keys "$CMD_LD" C-m
P_BOT=$(tmux display-message -p "#{pane_id}")

# Top -> MicroROS_LD_USB1
tmux select-pane -U
tmux select-pane -T "MicroROS_LD_USB1"
tmux respawn-pane -k "bash"
tmux send-keys "$CMD_MICROROS" C-m
P_TOP=$(tmux display-message -p "#{pane_id}")

# Launch Monitor Loop for LD Column
(
    while tmux list-panes -t "$P_TOP" >/dev/null 2>&1 && tmux list-panes -t "$P_BOT" >/dev/null 2>&1; do
        sleep 1
    done
    tmux kill-pane -t "$P_TOP" 2>/dev/null
    tmux kill-pane -t "$P_BOT" 2>/dev/null
) & disown

if ! pgrep -f "tmux attach -t $SESSION" > /dev/null; then
    x-terminal-emulator -T "Rover: Unified Control" -e "tmux attach -t $SESSION" &
fi