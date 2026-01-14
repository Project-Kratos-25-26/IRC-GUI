# RADO Mission Control

## Repository Structure

This repository is split into two parts:

### `rado_control_3/` - ROS Package (Jetson Orin)
Copy only this folder to the Orin at `~/ros2_ws/src/rado_control_3/`

Contains:
- ROS 2 nodes (mission control, state manager, etc.)
- Launch files
- Config files (mission_plan.txt)

```bash
# On Orin
cd ~/ros2_ws
colcon build --packages-select rado_control_3
source install/setup.bash
```

### `rado_gui/` - Web GUI (Laptop Only)
Keep this on your laptop only. **Do not copy to Orin.**

Contains:
- Web interface (HTML/CSS/JS)
- Python Flask server
- Startup scripts (SSH to Orin)

```bash
# On Laptop
cd rado_gui
./start_server.sh  # Starts web server + joystick
# Then run: ./scripts/start_mission.sh
```

**How they connect:**
1. Laptop runs the web GUI server (port 8001)
2. Startup scripts SSH into Orin to launch ROS nodes
3. Browser connects to rosbridge on Orin (port 9090)
4. Mission plan is synced from laptop to Orin before mission start

---

## Web GUI & System Control Documentation

## Initialization Functions

### Init Drive
The **Init Drive** function is the primary startup sequence. It launches everything required for **Manual Drive** control.
- **Micro-ROS Agent**: Establishes communication with the microcontroller.
- **Drive Control Node**: Launches the main drive logic.
- **Tmux Setup**: Creates the `rover_ui` session and the initial Drive Control column.

**Workflow:**
1. Click **Init Drive** to start in Manual Mode.
2. Click **Proceed** to switch the system to **Auto Mode**.

### Init LD (Life Detection)
Initializes the Life Detection subsystem.
- Creates a new column in the tmux session.
- Launches the **LD Control** node (Bottom Pane) and its specific **Micro-ROS Agent** (Top Pane).

### Init ARM
Initializes the Robotic Arm subsystem.
- Creates a new column in the tmux session.
- Launches the **Arm Control** node (Bottom Pane) and its specific **Micro-ROS Agent** (Top Pane).

### Manual Mode Switching
In the **Setup Tab** of the Web GUI, there is an option to manually change the control mode back to **Manual** if needed (e.g., if you are in Auto and need to take over).

## Tmux Terminal Navigation (Session: `rover_ui`)

The backend system runs in a `tmux` session.

### Navigation
*   **Switch Panes**: Press `Ctrl + b` then use the **Arrow Keys** (Left/Right/Up/Down) to move between panes.

### Managing Panes & Groups
The terminal is organized into vertical "Groups" or "Columns" for each subsystem (Drive, LD, Arm).
*   **Top Pane**: Micro-ROS Agent (Communication).
*   **Bottom Pane**: Control Node (Logic).

**Closing a Group:**
*   To close a subsystem, simply **close the Bottom Pane** (type `exit` or `Ctrl+D` in the bottom pane).
*   The automation script monitors the panes; if the bottom control pane closes, it will **automatically close the top Micro-ROS pane** to keep the session clean.

**Closing a Tab/Pane:**
*   Type `exit` in the terminal prompt.
*   Or use `Ctrl + b`, then `x`, then `y` to confirm kill.

### Tab Names & Descriptions

The tmux window is divided into named panes for clarity:

| Pane Name | Position | Description |
| :--- | :--- | :--- |
| **MicroROS_Drive_USB0** | Drive Col (Top) | Micro-ROS agent for Drive microcontrollers (USB0). |
| **Drive_Control** | Drive Col (Bottom) | Main drive logic processing commands. Default start pane. |
| **MicroROS_LD_USB1** | LD Col (Top) | Micro-ROS agent for Life Detection (USB1). |
| **LD_Control** | LD Col (Bottom) | Life Detection mapping and control logic. |
| **MicroROS_ARM_USB1** | Arm Col (Top) | Micro-ROS agent for Arm (USB1). |
| **ARM_Control** | Arm Col (Bottom) | Robotic Arm kinematics and control logic. |
| **Teleop_Input** | Split (Dynamic) | Temporary pane spawned when keyboard teleop is active in Auto mode. |
