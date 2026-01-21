#!/usr/bin/env bash
cd "$(dirname "$0")"

# Source centralized configuration and utilities
source "config/config.sh"
source "scripts/utils.sh"

# Check dependencies before starting
check_dependencies

# Trap to kill background processes on exit
cleanup() {
    echo ""
    echo "[LOCAL] Stopping services..."
    kill 0
}
trap cleanup EXIT

echo "=============================="
echo "   Drive GUI - Local System   "
echo "=============================="

# Cleanup old processes
echo "[LOCAL] Cleaning up old processes..."
pkill -f "rosbridge_websocket" || true
pkill -f "joy_node" || true
mkdir -p data

# 1. Start Joystick
echo "[LOCAL] Starting Thrustmaster joy node..."
ros2 run joy joy_node --ros-args \
  -r __node:=joy0 \
  -r /joy:=/joy0 \
  -p device_name:="Thrustmaster T.Flight Hotas One" \
  > "data/joy0.log" 2>&1 &

# 🕹️ Node 2: Sony Wireless Controller
# Note: Ensure config.sh has correct device names or use generic defaults if needed? 
# For now, keeping hardcoded device names as they are specific to the controllers, not the laptop.
ros2 run joy joy_node --ros-args \
  -r __node:=joy \
  -p device_name:="Sony Interactive Entertainment Wireless Controller" \
  > "data/joy.log" 2>&1 &


# 3. Start Nodes (Running directly from source for local dev)
echo "[LOCAL] Starting Telemetry Bridge..."
python3 ../scripts/telemetry_bridge_node.py > "data/bridge.log" 2>&1 &

echo "[LOCAL] Starting GUI Backend (with State Manager)..."
python3 ../scripts/gui_backend_node.py > "data/backend.log" 2>&1 &

# 2.2 Start Rosbridge (Essential for Web Communication)
echo "[LOCAL] Starting Rosbridge..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml port:=9099 > "data/rosbridge.log" 2>&1 &

# 2.3 Initialize NVGPU on Jetson
echo "[LOCAL] Initializing NVGPU on Jetson..."
bash scripts/init_nvgpu.sh > "data/init_nvgpu.log" 2>&1 &

# 2.4 Start Camera Streams on Jetson (via SSH)
echo "[LOCAL] Starting Jetson camera server..."
bash scripts/start_cameras.sh > "data/start_cameras.log" 2>&1 &

# 3. Start Server
echo "------------------------------"
echo " Server running at:"
echo " http://localhost:8080"
echo "------------------------------"
# ---- Background Ping Loop for RASPI and Jetson ----
echo "[LOCAL] Starting Heartbeat..."
(
    # IPs loaded from config.sh

    
    while true; do
        # Ping RASPI
        if ping -c 1 -W 1 $RASPI_IP > /dev/null 2>&1; then
            RASPI_STATUS="ONLINE"
        else
            RASPI_STATUS="OFFLINE"
        fi
        
        # Ping Jetson
        if ping -c 1 -W 1 $JETSON_IP > /dev/null 2>&1; then
            JETSON_STATUS="ONLINE"
        else
            JETSON_STATUS="OFFLINE"
        fi
        
        # Write status as JSON for frontend
        echo "{\"raspi\": \"$RASPI_STATUS\", \"jetson\": \"$JETSON_STATUS\"}" > "data/ping_status.json"
        
        sleep 2
    done
) &

# ---- Start Mission Status Monitor ----
bash scripts/monitor_mission.sh &

python3 scripts/server.py
