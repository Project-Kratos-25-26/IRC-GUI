#!/usr/bin/env bash

set -e

# --- CONFIGURATION (Change these if your robot changes name or IP) ---
RASPI_USER="kratos"      # Username on the Raspberry Pi
RASPI_IP="192.168.1.16"  # IP Address of the Raspberry Pi
PASS="kratos123"         # Password for the Pi
SESSION="rover_ui"       # Name of the tmux session we create on this laptop

# --- COMMAND DEFINITIONS ---
# 1. KILL COMMAND: Explicitly stops old programs on the Pi
#    'pkill -f' finds processes by name and kills them.
#    We do this to free up the USB port (/dev/ttyUSB0) before starting again.
CLEANUP_CMD="pkill -f micro_ros_agent; pkill -f drive.py"

# 2. MICRO-ROS COMMAND: Connects the Pi to the Microcontroller (ESP32/Teensy)
#    - ssh -tt: Forces a pseudo-terminal (needed for some interactive programs)
#    - source ...: Loads ROS2 commands
#    - ros2 run ...: actually starts the agent
CMD_MICROROS="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'source ~/rover/install/setup.bash && ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyUSB0; exec bash'"

# 3. DRIVE COMMAND: Starts the logic that calculates wheel speeds
#    - python3 drive.py: The brain that converts joystick inputs to motor commands
CMD_DRIVE="sshpass -p '$PASS' ssh -tt $RASPI_USER@$RASPI_IP 'source ~/rover/install/setup.bash && export PYTHONUNBUFFERED=1 && ros2 run drive_controls drive.py; exec bash'"

# ==============================================================================
# STEP 0: PRE-FLIGHT CLEANUP (THE "DOUBLE TAP")
# ==============================================================================
echo "[LOCAL] Cleaning up remote processes on Raspberry Pi..."
# We run the kill command via SSH. 
# '|| true' means "if you don't find anything to kill, don't crash, just keep going".
sshpass -p "$PASS" ssh $RASPI_USER@$RASPI_IP "$CLEANUP_CMD" || true
echo "[LOCAL] Cleanup complete. Old zombies are dead."

# ==============================================================================
# STEP 1: INITIALIZE TMUX SESSION
# ==============================================================================
# Check if a session named "rover_ui" already exists.
if ! tmux has-session -t $SESSION 2>/dev/null; then
    # --- SCENARIO A: SESSION DOES NOT EXIST (Fresh Start) ---
    echo "[LOCAL] Creating new tmux session: $SESSION"

    # Create a new detached session (background window)
    tmux new-session -d -s $SESSION
    tmux rename-window -t $SESSION:0 'RoverControl'
    
    # Make the window titles visible so we know what is what
    tmux set -t $SESSION pane-border-status top
    tmux set -t $SESSION pane-border-format "#{pane_index}: #{pane_title}"
    
    # Split the window into two halves (top and bottom)
    tmux split-window -v -t $SESSION:0
    
    # --- PANE 0 (TOP): MICRO-ROS AGENT ---
    echo "[LOCAL] Starting Micro-ROS in Top Pane..."
    tmux select-pane -t $SESSION:0.0
    tmux select-pane -T "MicroROS_Drive_USB0"  # Set Title
    tmux respawn-pane -k -t $SESSION:0.0 "bash" # Clear any old junk
    tmux send-keys -t $SESSION:0.0 "$CMD_MICROROS" C-m # Type the command and hit Enter
    P_TOP=$(tmux display-message -p -t $SESSION:0.0 "#{pane_id}") # Remember ID for monitoring

    # --- PANE 1 (BOTTOM): DRIVE CONTROLLER ---
    echo "[LOCAL] Starting Drive Logic in Bottom Pane..."
    tmux select-pane -t $SESSION:0.1
    tmux select-pane -T "Drive_Control"         # Set Title
    tmux respawn-pane -k -t $SESSION:0.1 "bash" # Clear any old junk
    tmux send-keys -t $SESSION:0.1 "$CMD_DRIVE" C-m # Type the command and hit Enter
    P_BOT=$(tmux display-message -p -t $SESSION:0.1 "#{pane_id}") # Remember ID for monitoring

    # --- WATCHDOG (Background Monitor) ---
    # This little background loop checks if the panes are still alive.
    # If users close the terminal manually, this cleans up.
    (
        while tmux list-panes -t "$P_TOP" >/dev/null 2>&1 && tmux list-panes -t "$P_BOT" >/dev/null 2>&1; do
            sleep 1
        done
        # If loop exits, kill whatever is left so we don't have orphans
        tmux kill-pane -t "$P_TOP" 2>/dev/null
        tmux kill-pane -t "$P_BOT" 2>/dev/null
    ) & disown

else
    # --- SCENARIO B: SESSION ALREADY EXISTS (Restarting) ---
    echo "[LOCAL] Session exists. Restarting Drive Pane only..."
    tmux set -t $SESSION pane-border-status top
    tmux set -t $SESSION pane-border-format "#{pane_index}: #{pane_title}"
    
    # Find the pane labeled "Drive_Control"
    DRIVE_PANE_ID=$(tmux list-panes -t $SESSION:0 -F "#{pane_id} #{pane_title}" | grep "Drive_Control" | awk '{print $1}')
    
    # Fallback if we can't find it (default to pane 1)
    if [ -z "$DRIVE_PANE_ID" ]; then
        DRIVE_PANE_ID="$SESSION:0.1"
        tmux select-pane -t $DRIVE_PANE_ID -T "Drive_Control"
    fi
    
    # Kill the local shell in that pane and start fresh
    tmux respawn-pane -k -t $DRIVE_PANE_ID "bash"
    sleep 0.5
    tmux send-keys -t $DRIVE_PANE_ID "$CMD_DRIVE" C-m
fi

# ==============================================================================
# STEP 2: CLEANUP GUI STUFF (Teleop)
# ==============================================================================
# If there was an old "Teleop_Input" pane (keyboard control), kill it.
# We don't need keyboard control if we are starting the main drive system.
TELEOP_PANE_ID=$(tmux list-panes -t $SESSION:0 -F "#{pane_id} #{pane_title}" | grep "Teleop_Input" | awk '{print $1}')
if [ -n "$TELEOP_PANE_ID" ]; then
    tmux kill-pane -t $TELEOP_PANE_ID
fi

# ==============================================================================
# STEP 3: SHOW THE WINDOW
# ==============================================================================
# If the terminal window isn't open, open it so you can see the logs.
if ! pgrep -f "tmux attach -t $SESSION" > /dev/null; then
    x-terminal-emulator -T "Rover: Unified Control" -e "tmux attach -t $SESSION" &
fi

# ==============================================================================
# STEP 4: HEALTH MONITORING (STATUS FILE)
# ==============================================================================
# This runs in the background and writes to 'microros.txt'.
# The GUI reads this file to show if Micro-ROS is RUNNING or STOPPED.
datadir="$(cd "$(dirname "$0")" && pwd)/../data"
if ! pgrep -f "ssh.*pgrep.*micro_ros" > /dev/null; then
    echo "[LOCAL] Starting background health monitor..."
    ( while true; do
      # SSH into Pi and check if 'micro_ros_agent' is in the process list
      sshpass -p "$PASS" ssh $RASPI_USER@$RASPI_IP \
        "pgrep -f micro_ros_agent >/dev/null && echo RUNNING || echo STOPPED" \
        > "$datadir/microros.txt"
      sleep 2
    done ) &
fi