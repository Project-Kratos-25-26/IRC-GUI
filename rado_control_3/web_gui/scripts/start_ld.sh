#!/usr/bin/env bash
set -euo pipefail

RASPI_USER="kratos"
RASPI_IP="192.168.1.16"

# We log remote specific stuff here, but local joy logs are now handled by start_server.sh
datadir="$(cd "$(dirname "$0")" && pwd)/../data"

echo "[REMOTE] Connecting to Rover..."

# -------------------------------
# -------------------------------
# 1. MICRO-ROS AGENT (Persistent)
# -------------------------------

# Start Local PS5 Controller Node
echo "[LOCAL] Starting PS5 Joy Node..."
ros2 run joy joy_node --ros-args \
  -r __node:=joy \
  -p device_name:="Sony Interactive Entertainment Wireless Controller" \
  > ".data/joy_ps5.log" 2>&1 &

echo "[REMOTE] Checking/Starting Micro-ROS Agent..."

x-terminal-emulator -T "LD: Micro-ROS" -e bash -c "
sshpass -p 'kratos123' ssh -tt ${RASPI_USER}@${RASPI_IP} '
  # Check if session exists
  if ! tmux has-session -t ld_microros 2>/dev/null; then
      tmux new-session -d -s ld_microros
      tmux send-keys -t ld_microros \"
        source ~/rover/install/setup.bash
        ros2 run micro_ros_agent micro_ros_agent serial --dev /dev/ttyUSB1
      \" C-m
  fi
  tmux attach -t ld_microros || echo "Tmux session failed/closed"
'
; exec bash
" &

# -------------------------------
# 2. LD CONTROL (Swappable)
# -------------------------------
echo "[REMOTE] Starting LD Control..."

# Prevent duplicates
pkill -f "Rover: LD Control" 2>/dev/null || true

x-terminal-emulator -T "Rover: LD Control" -e bash -c "
sshpass -p 'kratos123' ssh -tt ${RASPI_USER}@${RASPI_IP} '
  # Kill existing drive session to ensure fresh start (optional, but requested behavior implies one active drive mode)
  tmux kill-session -t ld_drive 2>/dev/null || true

  tmux new-session -d -s ld_drive
  tmux send-keys -t ld_drive \"
    source ~/rover/install/setup.bash
    export PYTHONUNBUFFERED=1
    ros2 run ld_controls ld_mapping
  \" C-m
  
  tmux attach -t ld_drive || echo "Tmux session failed/closed"
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

# Capture the last 20 lines of the ld_drive:0.0 pane where ld_mapping is running
( while true; do
  # capture to a temp var/file first
  # Added BatchMode=yes so it fails instantly if no keys, preventing hang.
  if OUTPUT=$(sshpass -p 'kratos123' ssh ${RASPI_USER}@${RASPI_IP} "tmux capture-pane -pt ld_drive:0.0 -S -20" 2>/dev/null); then
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