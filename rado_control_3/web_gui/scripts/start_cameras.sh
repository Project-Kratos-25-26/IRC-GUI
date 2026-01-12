#!/usr/bin/env bash
# Start camera streaming system
# This script SSHs into Jetson to start the Go camera server

JETSON_USER="kratos"
JETSON_IP="192.168.1.10"
JETSON_PASSWORD="kratos123"
GO_DIR="~/go_cams/go-cams-gstreamer"

echo "[CAMERAS] Starting camera streaming system..."

# Check if Jetson is reachable
if ! ping -c 1 -W 2 $JETSON_IP > /dev/null 2>&1; then
    echo "[CAMERAS] WARNING: Jetson ($JETSON_IP) is not reachable. Camera streaming will not start."
    exit 0
fi

# 1. Cleanup old process on Jetson
echo "[CAMERAS] Killing old camera processes on Jetson..."
sshpass -p "$JETSON_PASSWORD" ssh -tt $JETSON_USER@$JETSON_IP "pkill -f 'go run main.go' || true" 2>/dev/null

# 2. Start Go Server in Tmux
echo "[CAMERAS] Starting Go camera server in Tmux session 'camera_sys'..."
SESSION_NAME="camera_sys"

# Create session if it doesn't exist, or kill and recreate if needed (for fresh start)
# We chose to kill/recrate to ensure clean state
sshpass -p "$JETSON_PASSWORD" ssh -tt $JETSON_USER@$JETSON_IP "tmux kill-session -t $SESSION_NAME 2>/dev/null || true"
sshpass -p "$JETSON_PASSWORD" ssh -tt $JETSON_USER@$JETSON_IP "tmux new-session -d -s $SESSION_NAME"

# Send command to tmux session
sshpass -p "$JETSON_PASSWORD" ssh -tt $JETSON_USER@$JETSON_IP "tmux send-keys -t $SESSION_NAME 'source ~/.bashrc && cd $GO_DIR && go run main.go' C-m"

# 3. Wait for Server to Start
echo "[CAMERAS] Waiting 5s for server to initialize..."
sleep 5

# 4. Trigger Stream Start via HTTP
echo "[CAMERAS] sending start_stream command..."
curl -X POST "http://$JETSON_IP:51000/start_stream" \
     -d "resolution=720p" \
     -d "fps=15" \
     -d "bitrate=1000"

echo ""
echo "[CAMERAS] ---------------------------------------------------"
echo "[CAMERAS] Camera system started."
echo "[CAMERAS] - Go Server: http://$JETSON_IP:51000"
echo "[CAMERAS] - Streaming: 720p @ 15fps (1Mbps)"
echo "[CAMERAS] ---------------------------------------------------"
