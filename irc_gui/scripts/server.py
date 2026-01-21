#!/usr/bin/env python3
"""
Unified Web GUI Server
Serves static files and camera MJPEG streams on port 8001.
"""

import os
import cv2
import time
import threading
import numpy as np
from flask import Flask, Response, send_from_directory, jsonify, request

import gi
gi.require_version('Gst', '1.0')
from gi.repository import Gst, GLib

# Flask app
app = Flask(__name__)
Gst.init(None)

# Directory containing static files (parent of scripts/)
STATIC_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Orin SSH Configuration for remote file access
ORIN_USER = "kratos"
ORIN_IP = "192.168.1.10"
ORIN_PASSWORD = "kratos123"
ORIN_MISSION_PATH = "~/ros2_ws/src/rado_control_3/config/mission_plan.txt"

def ssh_read_file(remote_path):
    """Read file content from Orin via SSH."""
    try:
        import subprocess
        cmd = f"sshpass -p '{ORIN_PASSWORD}' ssh {ORIN_USER}@{ORIN_IP} 'cat {remote_path}'"
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            return result.stdout
        return ""
    except Exception as e:
        print(f"SSH read error: {e}")
        return ""

def ssh_write_file(remote_path, content):
    """Write content to file on Orin via SSH."""
    try:
        import subprocess
        # Escape content for shell
        escaped_content = content.replace("'", "'\"'\"'")
        cmd = f"sshpass -p '{ORIN_PASSWORD}' ssh {ORIN_USER}@{ORIN_IP} 'echo -n \"{escaped_content}\" > {remote_path}'"
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        return result.returncode == 0
    except Exception as e:
        print(f"SSH write error: {e}")
        return False

def ssh_append_file(remote_path, content):
    """Append content to file on Orin via SSH."""
    try:
        import subprocess
        # Escape content for shell
        escaped_content = content.replace("'", "'\"'\"'")
        cmd = f"sshpass -p '{ORIN_PASSWORD}' ssh {ORIN_USER}@{ORIN_IP} 'echo \"{escaped_content}\" >> {remote_path}'"
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=5)
        return result.returncode == 0
    except Exception as e:
        print(f"SSH append error: {e}")
        return False


class GStreamerVideo:
    """GStreamer pipeline manager for a single camera stream."""
    
    def __init__(self, pipeline_str):
        self.pipeline_str = pipeline_str
        self.pipeline = None
        self.video_sink = None
        self.latest_frame = None
        self.last_frame_time = 0
        self.running = False
        self.lock = threading.Lock()

    def start(self):
        self.pipeline = Gst.parse_launch(self.pipeline_str)
        self.video_sink = self.pipeline.get_by_name("appsink0")
        
        self.video_sink.set_property("emit-signals", True)
        self.video_sink.set_property("max-buffers", 1)
        self.video_sink.set_property("drop", True)
        self.video_sink.set_property("sync", False)
        self.video_sink.connect("new-sample", self.on_new_sample)
        
        self.pipeline.set_state(Gst.State.PLAYING)
        self.running = True
        
        self.loop = GLib.MainLoop()
        self.thread = threading.Thread(target=self.loop.run, daemon=True)
        self.thread.start()

    def on_new_sample(self, sink):
        sample = sink.emit("pull-sample")
        if not sample:
            return Gst.FlowReturn.OK
        
        buffer = sample.get_buffer()
        caps = sample.get_caps()
        structure = caps.get_structure(0)
        
        width = structure.get_value("width")
        height = structure.get_value("height")
        
        success, map_info = buffer.map(Gst.MapFlags.READ)
        if not success:
            return Gst.FlowReturn.OK
        
        frame = np.ndarray(
            shape=(height, width, 3),
            dtype=np.uint8,
            buffer=map_info.data
        )
        
        with self.lock:
            self.latest_frame = frame.copy()
            self.last_frame_time = time.time()
        
        buffer.unmap(map_info)
        return Gst.FlowReturn.OK

    def get_frame(self):
        with self.lock:
            return None if self.latest_frame is None else self.latest_frame.copy()

    def is_active(self):
        """Check if camera has received a frame recently (5s timeout)."""
        with self.lock:
            return (time.time() - self.last_frame_time) < 5.0

    def stop(self):
        self.running = False
        if self.pipeline:
            self.pipeline.set_state(Gst.State.NULL)
        if hasattr(self, "loop"):
            self.loop.quit()
        if hasattr(self, "thread"):
            self.thread.join(timeout=2)


# Camera pipeline definitions (UDP ports 9000-9005)
CAMERA_PIPELINES = {
    "Camera 1": (
        "udpsrc port=9000 ! application/x-rtp,payload=96,encoding-name=H265 ! "
        "rtph265depay ! h265parse ! avdec_h265 ! videoconvert ! "
        "video/x-raw,format=BGR ! appsink name=appsink0 sync=false max-buffers=1 drop=true"
    ),
    "Camera 2": (
        "udpsrc port=9001 ! application/x-rtp,payload=96,encoding-name=H265 ! "
        "rtph265depay ! h265parse ! avdec_h265 ! videoconvert ! "
        "video/x-raw,format=BGR ! appsink name=appsink0 sync=false max-buffers=1 drop=true"
    ),
    "Camera 3": (
        "udpsrc port=9002 ! application/x-rtp,payload=96,encoding-name=H265 ! "
        "rtph265depay ! h265parse ! avdec_h265 ! videoconvert ! "
        "video/x-raw,format=BGR ! appsink name=appsink0 sync=false max-buffers=1 drop=true"
    ),
    "Camera 4": (
        "udpsrc port=9003 ! application/x-rtp,payload=96,encoding-name=H265 ! "
        "rtph265depay ! h265parse ! avdec_h265 ! videoconvert ! "
        "video/x-raw,format=BGR ! appsink name=appsink0 sync=false max-buffers=1 drop=true"
    ),
    "Camera 5": (
        "udpsrc port=9004 ! application/x-rtp,payload=96,encoding-name=H265 ! "
        "rtph265depay ! h265parse ! avdec_h265 ! videoconvert ! "
        "video/x-raw,format=BGR ! appsink name=appsink0 sync=false max-buffers=1 drop=true"
    ),
    "Camera 6": (
        "udpsrc port=9005 ! application/x-rtp,payload=96,encoding-name=H265 ! "
        "rtph265depay ! h265parse ! avdec_h265 ! videoconvert ! "
        "video/x-raw,format=BGR ! appsink name=appsink0 sync=false max-buffers=1 drop=true"
    )
}

camera_instances = {}


def generate_frames(camera):
    """Generator that yields MJPEG frames."""
    target_fps = 10
    interval = 1.0 / target_fps
    
    while camera.running:
        start = time.time()
        frame = camera.get_frame()
        
        if frame is None:
            time.sleep(0.01)
            continue
        
        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
        
        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" +
            buffer.tobytes() +
            b"\r\n"
        )
        
        elapsed = time.time() - start
        if elapsed < interval:
            time.sleep(interval - elapsed)


# --- ROUTES ---

@app.route("/active_cameras")
def active_cameras():
    """Return list of currently active camera streams (received data within 5s)."""
    # List active cameras
    active = [name for name, cam in camera_instances.items() if cam.running and cam.is_active()]
    return jsonify(list(active))


@app.route("/health")
def health():
    """Health check endpoint."""
    active_count = sum(1 for cam in camera_instances.values() if cam.running and cam.is_active())
    return jsonify({"status": "ok", "cameras": active_count})


@app.route("/api/run_script", methods=['POST'])
def run_script():
    """Run a local script (for init_mission, etc.)."""
    import subprocess
    try:
        data = request.json
        script_name = data.get('script', '')
        
        # Only allow specific scripts for security
        allowed_scripts = ['start_mission.sh', 'start_drive.sh', 'start_arm.sh', 'start_ld.sh', 'start_cameras.sh', 'stop_mission.sh', 'switch_mode.sh']
        
        if script_name not in allowed_scripts:
            return jsonify({'success': False, 'error': f'Script not allowed: {script_name}'}), 403
        
        # Get the scripts directory
        scripts_dir = os.path.join(STATIC_DIR, 'scripts')
        script_path = os.path.join(scripts_dir, script_name)
        
        if not os.path.exists(script_path):
            return jsonify({'success': False, 'error': f'Script not found: {script_path}'}), 404
        
        # Run the script directly in background (script handles its own terminal via tmux)
        env = os.environ.copy()
        if 'DISPLAY' not in env:
            env['DISPLAY'] = ':0'
        
        # Prepare command with arguments
        cmd = ['bash', script_path]
        script_args = data.get('args', [])
        if isinstance(script_args, list):
            cmd.extend(script_args)
        elif isinstance(script_args, str):
            cmd.append(script_args)
            
        # Run script directly - it will open its own tmux terminal
        subprocess.Popen(
            cmd,
            cwd=scripts_dir,
            env=env,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL
        )
        
        return jsonify({'success': True, 'message': f'Started {script_name}'})
    except Exception as e:
        print(f"Error running script: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route("/api/mission_plan")
def get_mission_plan():
    """Return mission plan data structured for the GUI grid display (reads from Orin)."""
    result = {
        'pickup': {'red': [], 'green': [], 'blue': [], 'yellow': [], 'orange': []},
        'dropoff': {'red': [], 'green': [], 'blue': [], 'yellow': [], 'orange': []}
    }
    
    try:
        content = ssh_read_file(ORIN_MISSION_PATH)
        for line in content.split('\n'):
            line = line.strip()
            if not line:
                continue
            parts = line.split(',')
            if len(parts) >= 4:
                try:
                    obj_type = parts[0].lower().strip()
                    color = parts[1].lower().strip()
                    lat = float(parts[2])
                    lon = float(parts[3])
                    
                    if obj_type in result and color in result[obj_type]:
                        result[obj_type][color].append({'lat': lat, 'lon': lon})
                except (ValueError, IndexError):
                    continue
    except Exception as e:
        print(f"Error reading mission plan: {e}")
    
    return jsonify(result)


@app.route("/api/mission_plan/clear", methods=['POST'])
def clear_mission_plan():
    """Clear the mission plan file on Orin."""
    try:
        if ssh_write_file(ORIN_MISSION_PATH, ""):
            return jsonify({'success': True})
        return jsonify({'success': False, 'error': 'SSH write failed'}), 500
    except Exception as e:
        print(f"Error clearing mission plan: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route("/api/mission_plan/add", methods=['POST'])
def add_mission_entry():
    """Add a new entry to mission_plan.txt on Orin."""
    try:
        data = request.json
        obj_type = data.get('type', '').lower().strip()
        color = data.get('color', '').lower().strip()
        lat = data.get('lat')
        lon = data.get('lon')
        
        if not all([obj_type, color, lat, lon]):
            return jsonify({'success': False, 'error': 'Missing required fields'}), 400
        
        # CSV Format: type,color,lat,lon
        line = f"{obj_type},{color},{lat},{lon}"
        
        if ssh_append_file(ORIN_MISSION_PATH, line):
            print(f"Added to mission plan: {line}")
            return jsonify({'success': True})
        return jsonify({'success': False, 'error': 'SSH append failed'}), 500
    except Exception as e:
        print(f"Error adding mission entry: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route("/api/mission_plan/update", methods=['POST'])
def update_mission_plan():
    """Update coordinates in mission_plan.txt on Orin."""
    try:
        data = request.json
        obj_type = data.get('type', '').lower().strip()
        color = data.get('color', '').lower().strip()
        old_lat = float(data.get('old_lat'))
        old_lon = float(data.get('old_lon'))
        new_lat = float(data.get('new_lat'))
        new_lon = float(data.get('new_lon'))
        
        lines = []
        updated = False
        
        content = ssh_read_file(ORIN_MISSION_PATH)
        for line in content.split('\n'):
            line_stripped = line.strip()
            if not line_stripped:
                continue
            parts = line_stripped.split(',')
            if len(parts) >= 4:
                line_type = parts[0].lower().strip()
                line_color = parts[1].lower().strip()
                line_lat = float(parts[2])
                line_lon = float(parts[3])
                
                # Match by type, color, and approximate coordinates
                if (line_type == obj_type and line_color == color and 
                    abs(line_lat - old_lat) < 0.000001 and 
                    abs(line_lon - old_lon) < 0.000001):
                    lines.append(f"{obj_type},{color},{new_lat},{new_lon}")
                    updated = True
                else:
                    lines.append(line_stripped)
            else:
                lines.append(line_stripped)
        
        ssh_write_file(ORIN_MISSION_PATH, '\n'.join(lines) + '\n' if lines else '')
        
        return jsonify({'success': updated})
    except Exception as e:
        print(f"Error updating mission plan: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route("/api/mission_plan/delete", methods=['POST'])
def delete_mission_entry():
    """Delete a specific entry from mission_plan.txt on Orin."""
    try:
        data = request.json
        obj_type = data.get('type', '').lower().strip()
        color = data.get('color', '').lower().strip()
        lat = float(data.get('lat'))
        lon = float(data.get('lon'))
        
        lines = []
        deleted = False
        
        content = ssh_read_file(ORIN_MISSION_PATH)
        for line in content.split('\n'):
            line_stripped = line.strip()
            if not line_stripped:
                continue
            parts = line_stripped.split(',')
            if len(parts) >= 4:
                line_type = parts[0].lower().strip()
                line_color = parts[1].lower().strip()
                line_lat = float(parts[2])
                line_lon = float(parts[3])
                
                # Skip the matching entry (delete it)
                if (line_type == obj_type and line_color == color and 
                    abs(line_lat - lat) < 0.000001 and 
                    abs(line_lon - lon) < 0.000001):
                    deleted = True
                    continue
                else:
                    lines.append(line_stripped)
            else:
                lines.append(line_stripped)
        
        ssh_write_file(ORIN_MISSION_PATH, '\n'.join(lines) + '\n' if lines else '')
        
        return jsonify({'success': deleted})
    except Exception as e:
        print(f"Error deleting mission entry: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route("/api/mission_plan/raw")
def get_mission_plan_raw():
    """Return raw mission plan as ordered list for queue display (reads from Orin)."""
    result = []
    try:
        content = ssh_read_file(ORIN_MISSION_PATH)
        for idx, line in enumerate(content.split('\n')):
            line = line.strip()
            if not line:
                continue
            parts = line.split(',')
            if len(parts) >= 4:
                try:
                    result.append({
                        'index': idx,
                        'type': parts[0].lower().strip(),
                        'color': parts[1].lower().strip(),
                        'lat': float(parts[2]),
                        'lon': float(parts[3])
                    })
                except (ValueError, IndexError):
                    continue
    except Exception as e:
        print(f"Error reading mission plan: {e}")
    
    return jsonify(result)


@app.route("/video_feed/<camera_name>")
def video_feed(camera_name):
    """Serve MJPEG stream for a specific camera."""
    if camera_name not in camera_instances:
        pipeline = CAMERA_PIPELINES.get(camera_name)
        if not pipeline:
            return "Camera not found", 404
        
        cam = GStreamerVideo(pipeline)
        cam.start()
        camera_instances[camera_name] = cam
    
    return Response(
        generate_frames(camera_instances[camera_name]),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(STATIC_DIR, path)


def init_all_cameras():
    """Start all camera pipelines immediately to listen for streams."""
    print("Initializing all camera pipelines...")
    for name, pipeline in CAMERA_PIPELINES.items():
        if name not in camera_instances:
            print(f"Starting pipeline for {name}...")
            cam = GStreamerVideo(pipeline)
            cam.start()
            camera_instances[name] = cam
    print("All cameras initialized.")


if __name__ == "__main__":
    try:
        init_all_cameras()
        print(f"Serving from: {STATIC_DIR}")
        print("Server starting on http://0.0.0.0:8080")
        app.run(host="0.0.0.0", port=8080, debug=False, threaded=True)
    finally:
        print("Shutting down...")
        for camera in camera_instances.values():
            camera.stop()
