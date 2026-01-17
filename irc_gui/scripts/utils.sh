#!/usr/bin/env bash

# Utility functions for RADO Control Scripts

# Function to check for required system dependencies
check_dependencies() {
    local missing=0

    if ! command -v tmux &> /dev/null; then
        echo "[ERROR] 'tmux' is not installed."
        missing=1
    fi

    if ! command -v sshpass &> /dev/null; then
        echo "[ERROR] 'sshpass' is not installed."
        missing=1
    fi

    if [ $missing -eq 1 ]; then
        echo ""
        echo "Please run 'bash ./install.sh' to install required dependencies."
        exit 1
    fi
}

# Function to launch a command in a new terminal window
# Usage: launch_terminal "Title" "Command to run"
launch_terminal() {
    local title="$1"
    local cmd="$2"

    # If user provided a specific terminal command in config
    if [ -n "$TERMINAL_CMD" ]; then
        $TERMINAL_CMD "$cmd" &
        return
    fi

    # Auto-detect terminal emulator
    if command -v x-terminal-emulator &> /dev/null; then
        # Debian/Ubuntu default
        x-terminal-emulator -T "$title" -e "$cmd" &
    elif command -v gnome-terminal &> /dev/null; then
        gnome-terminal --title="$title" -- bash -c "$cmd" &
    elif command -v konsole &> /dev/null; then
        konsole -p tabtitle="$title" -e "$cmd" &
    elif command -v xfce4-terminal &> /dev/null; then
        xfce4-terminal -T "$title" -x bash -c "$cmd" &
    elif command -v terminator &> /dev/null; then
        terminator -T "$title" -x "$cmd" &
    elif command -v xterm &> /dev/null; then
        xterm -T "$title" -e "$cmd" &
    else
        echo "[WARNING] No supported terminal emulator found (gnome-terminal, konsole, xterm, etc)."
        echo "Executing command in background..."
        $cmd &
    fi
}

# Function to ping a host with short timeout
check_host() {
    local ip="$1"
    ping -c 1 -W 1 "$ip" > /dev/null 2>&1
}
