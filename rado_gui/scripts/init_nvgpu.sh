#!/usr/bin/env bash
# Initialize nvgpu kernel module on Jetson
# This script SSHs into Jetson and runs sudo modprobe nvgpu

# Source Config
source "$(dirname "$0")/../config/config.sh"

# Password for sudo is explicitly handled here (matches JETSON_PASS in config but ensured for safety)
SUDO_PASS="kratos123"

echo "[NVGPU] Initializing nvgpu kernel module on Jetson ($JETSON_IP)..."

# Check if Jetson is reachable
if ! ping -c 1 -W 2 $JETSON_IP > /dev/null 2>&1; then
    echo "[NVGPU] ERROR: Jetson ($JETSON_IP) is not reachable."
    exit 1
fi

# Execute command
# Uses sshpass for SSH authentication
# Uses echo | sudo -S for remote sudo password entry
sshpass -p "$JETSON_PASS" ssh -tt $JETSON_USER@$JETSON_IP "echo '$SUDO_PASS' | sudo -S modprobe nvgpu"

if [ $? -eq 0 ]; then
    echo "[NVGPU] Successfully executed modprobe nvgpu."
else
    echo "[NVGPU] Failed to execute modprobe nvgpu."
    exit 1
fi
