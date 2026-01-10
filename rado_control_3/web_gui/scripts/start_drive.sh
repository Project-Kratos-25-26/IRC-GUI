#!/usr/bin/env bash
set -euo pipefail

RASPI_USER="kratos"
RASPI_IP="192.168.1.16"

# We log remote specific stuff here, but local joy logs are now handled by start_server.sh
datadir="$(cd "$(dirname "$0")" && pwd)/../data"

echo "[REMOTE] Connecting to Rover..."

# -------------------------------
# 1. MICRO-ROS AGENT (Persistent)
# -------------------------------
echo "[REMOTE] Checking/Starting Micro-ROS Agent..."

x-terminal-emulator -T "Drive: Micro-ROS" -e bash -c "
sshpass -p 'kratos123' ssh -tt ${RASPI_USER}@${RASPI_IP} '
  # Check if session exists
  if ! tmux has-session -t rover_microros 2>/dev/null; then
      tmux new-session -d -s rover_microros
      tmux send-keys -t rover_microros \"
        source ~/rover/install/setup.bash
        ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyUSB0
      \" C-m
  fi
  tmux attach -t rover_microros
'
" &

# -------------------------------
# 2. DRIVE CONTROL (Swappable)
# -------------------------------
echo "[REMOTE] Starting Drive Control..."

# Prevent duplicates
pkill -f "Rover: Manual Drive" 2>/dev/null || true

x-terminal-emulator -T "Rover: Manual Drive" -e bash -c "
sshpass -p 'kratos123' ssh -tt ${RASPI_USER}@${RASPI_IP} '
  # Kill existing drive session to ensure fresh start (optional, but requested behavior implies one active drive mode)
  tmux kill-session -t rover_drive 2>/dev/null || true

  tmux new-session -d -s rover_drive
  tmux send-keys -t rover_drive \"
    source ~/rover/install/setup.bash
    export PYTHONUNBUFFERED=1
    ros2 run drive_controls drive.py
  \" C-m
  
  tmux attach -t rover_drive || echo "Tmux session failed/closed"
'
; exec bash
" &

echo "=============================="
echo "Rover terminal opened."
echo "Monitoring remote status..."

# ==================================================
# =============== MONITORING =======================
# ==================================================

# ---- Remote Logs ----
echo "Connecting to remote CLI..." > "$datadir/remote_log.txt"

# Capture the last 20 lines of the rover:0.0 pane where drive.py is running
( while true; do
  # capture to a temp var/file first
  # Added BatchMode=yes so it fails instantly if no keys, preventing hang.
  if OUTPUT=$(sshpass -p 'kratos123' ssh ${RASPI_USER}@${RASPI_IP} "tmux capture-pane -pt rover:0.0 -S -20" 2>/dev/null); then
      if [ -n "$OUTPUT" ]; then
          echo "$OUTPUT" > "$datadir/remote_log.txt"
      else
          touch "$datadir/remote_log.txt"
      fi
  fi
  sleep 0.5
done ) &

# ---- micro-ROS agent status ----
( while true; do
  sshpass -p 'kratos123' ssh ${RASPI_USER}@${RASPI_IP} \
    "pgrep -f micro_ros_agent >/dev/null && echo RUNNING || echo STOPPED" \
    > "$datadir/microros.txt"
  sleep 2
done ) &

wait