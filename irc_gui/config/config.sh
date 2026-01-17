#!/usr/bin/env bash

# ==========================================
#  RADO Control Web GUI Configuration
# ==========================================

# Network Configuration
# ------------------------------------------
# Raspberry Pi (Drive Control & Main Interface)
export RASPI_IP="192.168.1.16"
export RASPI_USER="kratos"
export RASPI_PASS="kratos123"

# Nvidia Jetson (Camera Streaming & AI)
export JETSON_IP="192.168.1.10"
export JETSON_USER="kratos"
export JETSON_PASS="kratos123"

# Local System Configuration
# ------------------------------------------
# Terminal Emulator Command override (Optional)
# Leave empty to auto-detect system terminal
# Examples: "gnome-terminal --", "konsole -e", "xterm -e"
export TERMINAL_CMD=""

# tmux Session Name
export TMUX_SESSION="rover_ui"
