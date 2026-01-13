#!/usr/bin/env bash
# Installer script for RADO Control Web GUI dependencies

set -e

echo "=========================================="
echo "    RADO Control Web GUI Installer"
echo "=========================================="

echo "[*] Updating package lists..."
sudo apt-get update

echo "[*] Installing system dependencies (sshpass, tmux)..."
sudo apt-get install -y sshpass tmux gstreamer1.0-plugins-* gstreamer1.0-tools gstreamer1.0-libav ros-humble-joy ros-humble-rosbridge-server 
 

echo "[*] Checking for Python requirements..."
if [ -f "requirements.txt" ]; then
    pip3 install -r requirements.txt
else
    # Install check for critical python libs if no req file
    pip3 install flask flask-cors
fi

echo ""
echo "[SUCCESS] Installation complete! You can now run:"
echo "          ./start_server.sh"
echo "=========================================="
