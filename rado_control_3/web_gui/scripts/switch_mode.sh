#!/bin/bash

MODE="$1"
RASPI_USER="kratos"
RASPI_IP="192.168.1.16"

# Ensure we have the helper function for clean spawning
# We use 'exec bash' at the end to keep the terminal open for debugging/password entry results.

if [ "$MODE" == "thrustmaster" ]; then
    # 1. Clean up Keyboard Mode (Hybrid Approach: Title + Process)
    pkill -f "Rover: Auto Drive" 2>/dev/null || true
    pkill -f "Rover: Teleop Input" 2>/dev/null || true
    
    # Process fallback
    pkill -f "drive_auto.py" 2>/dev/null || true
    pkill -f "teleop_twist_keyboard" 2>/dev/null || true
    pkill -f "rover_drive" 2>/dev/null || true # Kill tmux attach session
    pkill -f "rover_teleop" 2>/dev/null || true
    
    # Clean up Manual Drive too (just in case)
    pkill -f "Rover: Manual Drive" 2>/dev/null || true
    pkill -f "drive.py" 2>/dev/null || true

    # 2. Spawn Manual Drive (Thrustmaster)
    # Remote Command: Kill old sessions, Start new 'rover_drive' with drive.py, Attach
    REMOTE_CMD="tmux kill-session -t rover_drive 2>/dev/null || true; \
                tmux kill-session -t rover_teleop 2>/dev/null || true; \
                tmux new-session -d -s rover_drive; \
                tmux send-keys -t rover_drive \"source ~/rover/install/setup.bash; export PYTHONUNBUFFERED=1; ros2 run drive_controls drive.py\" C-m; \
                tmux attach -t rover_drive"

    # We use single quotes for SSH command argument, so we must be careful not to use single quotes inside REMOTE_CMD (we used none).
    x-terminal-emulator -T "Rover: Manual Drive" -e bash -c "echo 'Switching to Manual Drive...'; /usr/bin/sshpass -p 'kratos123' ssh -tt $RASPI_USER@$RASPI_IP '$REMOTE_CMD'" &

elif [ "$MODE" == "keyboard" ]; then
    # 1. Clean up Manual Drive (Hybrid Approach)
    pkill -f "Rover: Manual Drive" 2>/dev/null || true
    pkill -f "drive.py" 2>/dev/null || true
    
    # Clean up Keyboard windows (to be safe)
    pkill -f "Rover: Auto Drive" 2>/dev/null || true
    pkill -f "Rover: Teleop Input" 2>/dev/null || true
    pkill -f "drive_auto.py" 2>/dev/null || true
    pkill -f "teleop_twist_keyboard" 2>/dev/null || true

    # 2. Spawn Auto Drive
    # Remote Command: Kill old rover_drive, Start new 'rover_drive' with drive_auto.py, Attach
    REMOTE_CMD_DRIVE="tmux kill-session -t rover_drive 2>/dev/null || true; \
                      tmux new-session -d -s rover_drive; \
                      tmux send-keys -t rover_drive \"source ~/rover/install/setup.bash; export PYTHONUNBUFFERED=1; ros2 run drive_controls drive_auto.py\" C-m; \
                      tmux attach -t rover_drive"

    x-terminal-emulator -T "Rover: Auto Drive" -e bash -c "echo 'Switching to Auto Drive (Keyboard)...'; /usr/bin/sshpass -p 'kratos123' ssh -tt $RASPI_USER@$RASPI_IP '$REMOTE_CMD_DRIVE'" &

    # 3. Spawn Teleop
    # Remote Command: Kill old rover_teleop, Start new 'rover_teleop' with input node, Attach
    REMOTE_CMD_TELEOP="tmux kill-session -t rover_teleop 2>/dev/null || true; \
                       tmux new-session -d -s rover_teleop; \
                       tmux send-keys -t rover_teleop \"source ~/rover/install/setup.bash; ros2 run teleop_twist_keyboard teleop_twist_keyboard\" C-m; \
                       tmux attach -t rover_teleop"

    x-terminal-emulator -T "Rover: Teleop Input" -e bash -c "echo 'Starting Teleop Input...'; /usr/bin/sshpass -p 'kratos123' ssh -tt $RASPI_USER@$RASPI_IP '$REMOTE_CMD_TELEOP'" &

else
    echo "Unknown mode: $MODE"
    exit 1
fi

echo "Switch command issued for mode: $MODE"
