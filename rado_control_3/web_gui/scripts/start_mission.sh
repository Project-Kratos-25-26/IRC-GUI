#!/usr/bin/env bash
set -euo pipefail

# Jetson Orin Configuration
JETSON_USER="kratos"
JETSON_IP="192.168.1.10"
JETSON_PASSWORD="kratos123"

echo "================================="
echo "   MISSION INITIALIZATION"
echo "================================="
echo ""

# ===================================
# 1. Check Jetson Orin Connectivity
# ===================================
echo "[REMOTE] Checking Jetson Orin connectivity..."
if ! ping -c 2 -W 2 ${JETSON_IP} > /dev/null 2>&1; then
    echo ""
    echo "❌ ================================="
    echo "   JETSON ORIN OFFLINE"
    echo "   IP: ${JETSON_IP}"
    echo "================================="
    echo ""
    
    # Show GUI popup
    zenity --error \
        --title="Jetson Orin Offline" \
        --text="Cannot connect to Jetson Orin at ${JETSON_IP}\n\nPlease check:\n• Jetson is powered on\n• Network connection is active\n• IP address is correct" \
        --width=400 2>/dev/null || \
    notify-send -u critical "Jetson Orin Offline" "Cannot connect to ${JETSON_IP}" 2>/dev/null || true
    
    exit 1
fi

echo "✓ Jetson Orin is online (${JETSON_IP})"

# ===================================
# 2. Launch Bringup on Jetson Orin
# ===================================
echo ""
echo "[REMOTE] Launching Bringup on Jetson Orin..."
x-terminal-emulator -T "Mission: Bringup (Jetson)" -e bash -c "
sshpass -p '${JETSON_PASSWORD}' ssh -tt ${JETSON_USER}@${JETSON_IP} '
  echo \"=================================\";
  echo \"   BRINGUP LAUNCH (JETSON ORIN)\";
  echo \"=================================\";
  echo \"\";
  
  # Check if session exists, create if not
  if ! tmux has-session -t mission_bringup 2>/dev/null; then
      tmux new-session -d -s mission_bringup;
      tmux send-keys -t mission_bringup \"
        source ~/ros2_ws/install/setup.bash
        ros2 launch kratos_bringup bringup.launch.py
      \" C-m;
  fi
  
  tmux attach -t mission_bringup || echo \"Tmux session failed/closed\";
'
; exec bash
" &

# Wait for bringup to initialize
echo "Waiting 3 seconds for BRINGUP to initialize on Jetson..."
sleep 3

echo "✓ Jetson Orin is online (${JETSON_IP})"

# ===================================
# 3. Launch RTABMAP on Jetson Orin
# ===================================
echo ""
echo "[REMOTE] Launching RTABMAP on Jetson Orin..."
x-terminal-emulator -T "Mission: RTABMAP (Jetson)" -e bash -c "
sshpass -p '${JETSON_PASSWORD}' ssh -tt ${JETSON_USER}@${JETSON_IP} '
  echo \"=================================\";
  echo \"   RTABMAP LAUNCH (JETSON ORIN)\";
  echo \"=================================\";
  echo \"\";
  
  # Check if session exists, create if not
  if ! tmux has-session -t mission_rtabmap 2>/dev/null; then
      tmux new-session -d -s mission_rtabmap;
      tmux send-keys -t mission_rtabmap \"
        source ~/ros2_ws/install/setup.bash
        ros2 launch kratos_rtabmap kratos_rtabmap.launch.py
      \" C-m;
  fi
  
  tmux attach -t mission_rtabmap || echo \"Tmux session failed/closed\";
'
; exec bash
" &

# Wait for rtabmap to initialize
echo "Waiting 10 seconds for RTABMAP to initialize on Jetson..."
sleep 10

# ===================================
# 4. Launch NAV2 on Jetson Orin
# ===================================
echo ""
echo "[REMOTE] Launching NAV2 on Jetson Orin..."
x-terminal-emulator -T "Mission: NAV2 (Jetson)" -e bash -c "
sshpass -p '${JETSON_PASSWORD}' ssh -tt ${JETSON_USER}@${JETSON_IP} '
  echo \"=================================\";
  echo \"   NAV2 LAUNCH (JETSON ORIN)\";
  echo \"=================================\";
  echo \"\";
  
  # Check if session exists, create if not
  if ! tmux has-session -t mission_nav2 2>/dev/null; then
      tmux new-session -d -s mission_nav2;
      tmux send-keys -t mission_nav2 \"
        source ~/ros2_ws/install/setup.bash
        ros2 launch kratos_nav2 kratos_nav2.launch.py
      \" C-m;
  fi
  
  tmux attach -t mission_nav2 || echo \"Tmux session failed/closed\";
'
; exec bash
" &

echo ""
echo "================================="
echo "✓ All systems launched on Jetson!"
echo "  - Jetson: Bringup"
echo "  - Jetson: RTABMAP"
echo "  - Jetson: NAV2"
echo "================================="
echo ""
