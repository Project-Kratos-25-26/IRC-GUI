// This module uses CONFIG defined in config.js (loaded first)
// No duplicate definition needed

// Initialize ROS connection
const ros = new ROSLIB.Ros({ url: CONFIG.ROSBRIDGE_URL });

ros.on('connection', () => {
    console.log("ROS Connected");
});

ros.on('close', () => {
    console.log("ROS Disconnected");
});

// --- HELPER TO CREATE TOPICS ---
function createTopic(name, type) {
    return new ROSLIB.Topic({
        ros: ros,
        name: name,
        messageType: type
    });
}

// --- DEFINE TOPICS ---
const cmdPub = createTopic(CONFIG.TOPICS.CMD, 'std_msgs/String');
const sysPub = createTopic(CONFIG.TOPICS.SYS, 'std_msgs/String');
const armPub = createTopic(CONFIG.TOPICS.ARM, 'std_msgs/String');
const logPub = createTopic(CONFIG.TOPICS.LOG, 'std_msgs/String');

// --- SUBSCRIBE TO HEALTH ---
const healthSub = createTopic(CONFIG.TOPICS.HEALTH, 'std_msgs/String');
healthSub.subscribe((msg) => {
    if (window.renderHealth) window.renderHealth(JSON.parse(msg.data));
});

// --- DATA BUFFER ---
window.telemetry = {
    joy: [],
    vel: { linear: { x: 0 }, angular: { z: 0 } },
    joy_ps5: null,
    local_calc: null
};

// --- JOYSTICK SUBSCRIBERS (via rosbridge websocket) ---
// Thrustmaster (for Drive visualization)
const joySub = createTopic('/joy0', 'sensor_msgs/Joy');
joySub.subscribe((msg) => {
    window.telemetry.joy = msg.axes;

    // Calculate local_calc from raw axes (same logic as telemetry_bridge.py)
    let linear = msg.axes[1] || 0;
    let rotational = msg.axes[0] || 0;
    let speed = msg.axes[2] || 0;

    // Apply deadzone
    if (Math.abs(linear) > 0.1 || Math.abs(rotational) > 0.1) {
        // teleop logic from telemetry_bridge.py
        let rover_x = (linear * ((speed + 1) / 2) + rotational * ((speed + 1) / 2)) * 100;
        let rover_z = (linear * ((speed + 1) / 2) - rotational * ((speed + 1) / 2)) * 100;

        // Clamp to circle
        let magnitude = Math.sqrt(rover_x * rover_x + rover_z * rover_z);
        if (magnitude > 100) {
            let scale = 100 / magnitude;
            rover_x *= scale;
            rover_z *= scale;
        }

        window.telemetry.local_calc = {
            rover_x: rover_x,
            rover_z: rover_z,
            velx: rover_x,
            velz: rover_z
        };
    } else {
        window.telemetry.local_calc = { rover_x: 0, rover_z: 0, velx: 0, velz: 0 };
    }

    requestAnimationFrame(() => {
        if (window.drawJoyInput) window.drawJoyInput(msg.axes);
        if (window.updateVectorVis) window.updateVectorVis(window.telemetry.joy, null, window.telemetry.local_calc);
    });
});

// PS5 Controller (for LD visualization)
const ps5Sub = createTopic('/joy', 'sensor_msgs/Joy');
ps5Sub.subscribe((msg) => {
    window.telemetry.joy_ps5 = msg;
    requestAnimationFrame(() => {
        if (window.updatePS5) window.updatePS5(msg);
    });
});

// --- STATE SUBSCRIBER ---
const stateSub = createTopic('/system/state', 'std_msgs/String');
stateSub.subscribe((msg) => {
    const badge = document.getElementById('state-badge');
    if (badge) {
        badge.innerText = msg.data;
        badge.className = `status-badge ${msg.data}`;
    }

    // Sync mode radio buttons in SETUP tab
    const state = msg.data;
    const thrustmasterRadio = document.querySelector('input[name="controlMode"][value="thrustmaster"]');
    const keyboardRadio = document.querySelector('input[name="controlMode"][value="keyboard"]');

    if (state === 'MANUAL' && thrustmasterRadio) {
        thrustmasterRadio.checked = true;
    } else if (state === 'AUTONOMOUS' && keyboardRadio) {
        keyboardRadio.checked = true;
    }
});

// --- MISSION STATUS SUBSCRIBER ---
const missionStatusSub = createTopic('/mission/status', 'std_msgs/String');
missionStatusSub.subscribe((msg) => {
    try {
        const parts = msg.data.split('|');
        const statusType = parts[0];
        const queueIndex = parseInt(parts[1]);
        
        if (statusType === 'ARRIVED') {
            const goalType = parts[2];
            console.log(`Mission status: Arrived at ${goalType} (queue index: ${queueIndex})`);
            
            // Call the handler in main.js
            if (window.onWaypointReached) {
                window.onWaypointReached(queueIndex, goalType);
            }
        } else if (statusType === 'DROPOFF_COMPLETE') {
            console.log(`Mission status: Dropoff complete (queue index: ${queueIndex})`);
            // Dropoff countdown is handled in GUI, this is just confirmation
        }
    } catch (e) {
        console.error('Error parsing mission status:', e);
    }
});

// --- GPS SUBSCRIBER FOR MAP ---
const gpsSub = createTopic('/mavros/global_position/global', 'sensor_msgs/NavSatFix');
gpsSub.subscribe((msg) => {
    // Update GPS display
    const latEl = document.getElementById('recon-lat');
    const lonEl = document.getElementById('recon-lon');
    if (latEl) latEl.textContent = msg.latitude.toFixed(6);
    if (lonEl) lonEl.textContent = msg.longitude.toFixed(6);
    
    // Update map marker if available
    if (window.updateRoverMarker) {
        window.updateRoverMarker(msg.latitude, msg.longitude);
    }
});