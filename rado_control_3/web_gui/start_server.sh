#!/usr/bin/env bash
cd "$(dirname "$0")"

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

mkdir -p data

# 1. Start Joystick
echo "[LOCAL] Starting Thrustmaster joy node..."
ros2 run joy joy_node --ros-args \
  -r __node:=joy0 \
  -r /joy:=/joy0 \
  -p device_name:="Thrustmaster T.Flight Hotas One" \
  > "data/joy0.log" 2>&1 &

# 🕹️ Node 2: Sony Wireless Controller
ros2 run joy joy_node --ros-args \
  -r __node:=joy \
  -p device_name:="Sony Interactive Entertainment Wireless Controller" \
  > "data/joy.log" 2>&1 &


# 3. Start Nodes (Running directly from source for local dev)
echo "[LOCAL] Starting Telemetry Bridge..."
python3 scripts/telemetry_bridge_node.py > "data/bridge.log" 2>&1 &

echo "[LOCAL] Starting GUI Backend..."
python3 scripts/gui_backend_node.py > "data/backend.log" 2>&1 &

echo "[LOCAL] Starting State Manager..."
python3 ../scripts/state_manager_node.py > "data/state_manager.log" 2>&1 &

# 2.2 Start Rosbridge (Essential for Web Communication)
echo "[LOCAL] Starting Rosbridge..."
ros2 launch rosbridge_server rosbridge_websocket_launch.xml > "data/rosbridge.log" 2>&1 &

# 2.3 Start Web Video Server (For Camera)
echo "[LOCAL] Starting Web Video Server..."
ros2 run web_video_server web_video_server > "data/webvideo.log" 2>&1 &

# 3. Start Server
echo "------------------------------"
echo " Server running at:"
echo " http://localhost:8001"
echo "------------------------------"
# ---- Background Ping Loop for RASPI and Jetson ----
echo "[LOCAL] Starting Heartbeat..."
(
    RASPI_IP="192.168.1.16"
    JETSON_IP="192.168.1.17"
    
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
        echo "{\"raspi\": \"$RASPI_STATUS\", \"jetson\": \"$JETSON_STATUS\"}" > data/ping_status.json
        
        sleep 2
    done
) &

python3 -m http.server 8001
