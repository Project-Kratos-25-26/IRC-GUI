// --- TAB SWITCHING ---
function openTab(id) {
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');

    // Highlight button based on ID
    // (Simple logic to find button by index for this specific HTML structure)
    const btnIndex = ['tab-setup', 'tab-health', 'tab-recon', 'tab-mission', 'tab-arm'].indexOf(id);
    if (btnIndex >= 0) document.querySelectorAll('.tab-btn')[btnIndex].classList.add('active');

    // Fix map rendering bug when unhiding div
    if (id === 'tab-mission' && typeof map !== 'undefined') {
        setTimeout(() => map.invalidateSize(), 200);
    }
}

// --- COMMAND SENDERS ---
let raspiStatus = "OFFLINE";

function sendCmd(cmd) {
    if ((cmd === 'PROCEED') && raspiStatus !== 'ONLINE') {
        alert("Cannot Proceed: Raspberry Pi is OFFLINE!");
        return;
    }
    // Publish to /sys/command so state_manager receives it
    sysPub.publish(new ROSLIB.Message({ data: cmd }));
    addMissionLog(`Sent command: ${cmd}`);
    if (cmd === 'PROCEED') updateMode('AUTO');
}

function sendSysCommand(cmd) {
    // Blocking check for init and mode commands
    const blockedCmds = ['init_drive', 'init_ld', 'init_arm', 'manual_mode', 'auto_mode'];
    if (blockedCmds.includes(cmd) && raspiStatus !== 'ONLINE') {
        alert("Cannot Execute: Raspberry Pi is OFFLINE!");
        // Revert radio button if needed (simple fix: user sees alert, radio stays checked but cmd not sent. acceptable for now)
        return;
    }

    sysPub.publish(new ROSLIB.Message({ data: cmd }));
    // Optimistic UI update for mode
    if (cmd === 'manual_mode' || cmd === 'init_drive') updateMode('MANUAL');
    if (cmd === 'auto_mode') updateMode('AUTO');
    console.log(`System Command sent: ${cmd}`);
}

function updateMode(mode) {
    const badge = document.getElementById('state-badge');
    if (badge) {
        badge.textContent = mode;
        badge.className = `status-badge ${mode}`;

        const m = mode.toUpperCase();
        if (m === 'AUTO' || m === 'AUTONOMOUS') {
            badge.style.backgroundColor = '#9b59b6'; // Purple
        } else if (m === 'MANUAL') {
            badge.style.backgroundColor = '#e67e22'; // Orange-ish
        } else {
            badge.style.backgroundColor = '#444';
        }
    }
}

// --- LOGGING LOGIC ---
let selectedColor = null;

function selColor(c) {
    selectedColor = c;
    document.getElementById('log-msg').textContent = `Selected: ${c}`;
}

function sendLog() {
    if (!selectedColor) { alert("Select Color First!"); return; }
    const obj = document.getElementById('obj-select').value;

    // Get current GPS
    const latStr = document.getElementById('recon-lat').textContent;
    const lonStr = document.getElementById('recon-lon').textContent;

    // Publish Log Request (Format: Object|Color|Lat|Lon)
    logPub.publish(new ROSLIB.Message({ data: `${obj}|${selectedColor}|${latStr}|${lonStr}` }));

    const logText = `Logged: ${obj} | Color: ${selectedColor} | Loc: [${latStr}, ${lonStr}]`;
    document.getElementById('log-msg').textContent = logText;
    console.log(logText); // Print to console as well

    // Add visual marker to map
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (typeof map !== 'undefined' && lat !== 0) {
        L.marker([lat, lon]).addTo(map).bindPopup(obj).openPopup();
    }
}

// --- ARM CONTROLS ---
function updateArm(jointIndex, value) {
    const labels = document.querySelectorAll('.arm-slider-group label span');
    labels[jointIndex].textContent = value + (jointIndex < 3 ? '°' : '%');
    armPub.publish(new ROSLIB.Message({ data: `${jointIndex}:${value}` }));
}

function sendArmPreset(pose) {
    armPub.publish(new ROSLIB.Message({ data: `PRESET:${pose}` }));
}

// --- HEALTH DISPLAY ---
window.renderHealth = function (data) {
    const list = document.getElementById('health-list');
    let html = "";

    // Update Main Health Tab
    for (const [k, v] of Object.entries(data.pings)) {
        html += `<div class="health-row"><span>${k}</span><span class="${v ? 'health-ok' : 'health-err'}">${v ? 'ONLINE' : 'OFFLINE'}</span></div>`;

        // Update Recon/Mission Tabs
        const color = v ? 'lime' : 'red';
        const text = v ? 'ONLINE' : 'OFFLINE';

        // Recon
        const elRecon = document.getElementById(`status-${k.toLowerCase()}-recon`);
        if (elRecon) { elRecon.style.color = color; elRecon.textContent = text; }

        // Mission
        const elMission = document.getElementById(`status-${k.toLowerCase()}-mission`);
        if (elMission) { elMission.style.color = color; elMission.textContent = text; }
    }
    for (const [k, v] of Object.entries(data.topics)) {
        html += `<div class="health-row"><span>${k}</span><span class="${v == 'OK' ? 'health-ok' : 'health-err'}">${v}</span></div>`;
    }
    list.innerHTML = html;
}

function addMissionLog(text) {
    const ul = document.getElementById('mission-log');
    if (ul) {
        const li = document.createElement('li');
        li.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
        ul.prepend(li);
    }
}

// Set Video Source
document.getElementById('video-stream').src = CONFIG.VIDEO_URL;

// --- CONTROLLER VISUALIZATION ---
// --- VECTOR VISUALIZATION ---
function drawArrow(ctx, fromX, fromY, toX, toY, color) {
    const headlen = 10;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const angle = Math.atan2(dy, dx);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;

    // Draw line
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();

    // Draw arrowhead (fixed direction)
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
}

// --- THRUSTMASTER RAW INPUT BARS (Exact from drive_gui/test/app.js) ---
window.drawJoyInput = function (joy) {
    if (!joy) return;

    const joyCanvas = document.getElementById("joyCanvas");
    if (!joyCanvas) return;
    const joyCtx = joyCanvas.getContext("2d");

    const w = joyCanvas.width;
    const h = joyCanvas.height;
    joyCtx.clearRect(0, 0, w, h);

    const axes = ["Turn", "Fwd", "Thr"];
    const colors = ["#00ff00", "#0088ff", "#ffaa00"];

    joyCtx.font = "12px monospace";
    joyCtx.textBaseline = "middle";

    for (let i = 0; i < 3; i++) {
        let val = joy[i];
        if (i === 0) val = -val; // Invert Turn for visualization
        if (val === undefined || val === null) val = 0;

        let y = 15 + i * 30;

        // Label
        joyCtx.fillStyle = "#aaa";
        joyCtx.fillText(axes[i], 5, y);

        // Bar bg
        joyCtx.fillStyle = "#333";
        joyCtx.fillRect(40, y - 6, w - 50, 12);

        // Bar value
        let barW = w - 50;

        if (i === 2) {
            // SPECIAL CASE: Throttle (Thr)
            let norm = (val + 1) / 2.0;
            if (norm < 0) norm = 0;
            if (norm > 1) norm = 1;

            let startX = 40;
            joyCtx.fillStyle = colors[i];
            joyCtx.fillRect(startX, y - 6, norm * barW, 12);

        } else {
            // STANDARD CASE: Turn/Fwd (Centered)
            let center = 40 + barW / 2;
            let valPx = (val * (barW / 2));

            joyCtx.fillStyle = colors[i];
            joyCtx.fillRect(center, y - 6, valPx, 12);

            // Center line
            joyCtx.fillStyle = "#555";
            joyCtx.fillRect(center, y - 8, 1, 16);
        }
    }
}

window.updateVectorVis = function (joy, vel, local_calc) {
    const canvas = document.getElementById('vector-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    // Clear
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const scale = 80; // Visual scale (Matched to test)

    // Draw Crosshair
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.stroke();

    // Read Config
    const vecInvX = document.getElementById("vec-inv-x")?.checked ? -1 : 1;
    const vecInvY = document.getElementById("vec-inv-y")?.checked ? -1 : 1;
    const vecSwap = document.getElementById("vec-swap")?.checked;

    // 1. RAW JOYSTICK VECTOR (Yellow) - From Thrustmaster
    // Raw joystick values are -1 to 1, scale to fit in canvas (max radius ~90px)
    const maxRadius = 90; // Leave margin for arrow head
    if (joy && joy.length >= 2) {
        let rawX = joy[0] || 0;
        let rawY = joy[1] || 0;

        // Apply config
        let jx = (vecSwap ? rawY : rawX) * vecInvX;
        let jy = (vecSwap ? rawX : rawY) * vecInvY;

        // Scale: joystick is -1 to 1, map to maxRadius pixels
        drawArrow(ctx, cx, cy, cx + (jx * maxRadius), cy + (jy * maxRadius), "yellow");
    }

    // 2. CALCULATED VECTOR (Cyan) - From local_calc (matches test/app.js exactly)
    if (local_calc) {
        // Logic from test/app.js drawVectors:
        let fwd = (local_calc.rover_x || 0) + (local_calc.rover_z || 0);
        let turn = (local_calc.rover_x || 0) - (local_calc.rover_z || 0);

        let rawX = turn;
        let rawY = fwd;

        // Apply User Config
        let vx = (vecSwap ? rawY : rawX) * vecInvX;
        let vy = (vecSwap ? rawX : rawY) * vecInvY;

        // Normalize to max radius (rover values can be up to ~200, normalize to fit)
        let magnitude = Math.sqrt(vx * vx + vy * vy);
        let scaleFactor = maxRadius / 200; // rover max is ~200 (100+100)
        if (magnitude > 0) {
            vx = vx * scaleFactor;
            vy = vy * scaleFactor;
        }

        drawArrow(ctx, cx, cy, cx + vx, cy + vy, "cyan");

        // Update Text - show velx/velz for display
        let velx = local_calc.velx || local_calc.rover_x || 0;
        let velz = local_calc.velz || local_calc.rover_z || 0;
        if (document.getElementById('val-vx')) document.getElementById('val-vx').textContent = velx.toFixed(2);
        if (document.getElementById('val-vz')) document.getElementById('val-vz').textContent = velz.toFixed(2);

        // Speed = vector magnitude
        let spd = Math.sqrt(velx * velx + velz * velz);
        if (document.getElementById('val-spd')) document.getElementById('val-spd').textContent = spd.toFixed(2);
    }
}

// --- PS5 VISUALIZATION (DOM BASED) ---
// --- PS5 VISUALIZATION (PARITY WITH drive_gui) ---
window.updatePS5 = function (joyData) {
    // Handle empty or initial data
    let axes = [];
    let buttons = [];

    if (!joyData) {
        // Empty
    } else if (Array.isArray(joyData)) {
        axes = joyData;
    } else {
        axes = joyData.axes || [];
        buttons = joyData.buttons || [];
    }

    // --- CONFIG ---
    const chkInvX = document.getElementById("ps5-inv-x");
    const chkInvY = document.getElementById("ps5-inv-y");

    const invX = chkInvX?.checked ? -1 : 1;
    const invY = chkInvY?.checked ? -1 : 1;
    // const swap = chkSwap?.checked; // Not in PS5 section of web_gui

    // --- RAW AXES ---
    const rawLx = (axes.length > 0) ? axes[0] : 0;
    const rawLy = (axes.length > 1) ? axes[1] : 0;
    const l2_axis = (axes.length > 2) ? axes[2] : -1;
    const rawRx = (axes.length > 3) ? axes[3] : 0;
    const rawRy = (axes.length > 4) ? axes[4] : 0;
    const r2_axis = (axes.length > 5) ? axes[5] : -1;

    // Hats (D-pad) 
    const hatX = (axes.length > 6) ? axes[6] : 0;
    const hatY = (axes.length > 7) ? axes[7] : 0;

    // --- BUTTONS ---
    const bCross = buttons[0] || 0;
    const bCircle = buttons[1] || 0;
    const bTri = buttons[2] || 0;
    const bSquare = buttons[3] || 0;
    const bL1 = buttons[4] || 0;
    const bR1 = buttons[5] || 0;
    const bL2 = buttons[6] || 0;
    const bR2 = buttons[7] || 0;
    const bShare = buttons[8] || 0;
    const bOpt = buttons[9] || 0;
    const bPS = buttons[10] || 0;
    const bL3 = buttons[11] || 0;
    const bR3 = buttons[12] || 0;

    // --- APPLY INVERSION / SWAP (No swap for PS5 in drive_gui app.js logic shown for PS5?? Wait, poll calls drawPS5Input(j.joy_ps5). 
    // drawPS5Input (Lines 208-344) has swap logic commented out or distinct? 
    // Line 258: if (swap) ... It IS there.
    // But web_gui typically only has inv checkboxes for PS5. I'll stick to Inv.

    let lx = rawLx * invX;
    let ly = rawLy * invY;
    let rx = rawRx * invX;
    let ry = rawRy * invY;

    // Helper to set color
    const setBtn = (id, active, color = "cyan") => {
        const el = document.getElementById(id);
        if (el) el.style.backgroundColor = active ? color : "transparent"; // Changed from #333 to transparent for parity
        if (el) el.style.boxShadow = active ? `0 0 10px ${color}` : "none";
        if (el) el.style.borderColor = active ? color : "#555";
    };

    // 1. STICKS MOVEMENT
    const maxOff = 15;
    const elL = document.getElementById("stick-l");
    if (elL) {
        elL.style.transform = `translate(calc(-50% + ${lx * maxOff}px), calc(-50% + ${ly * maxOff}px))`;
        elL.style.backgroundColor = bL3 ? "blue" : "cyan";
    }
    const elR = document.getElementById("stick-r");
    if (elR) {
        elR.style.transform = `translate(calc(50% + ${rx * maxOff}px), calc(-50% + ${ry * maxOff}px))`;
        elR.style.backgroundColor = bR3 ? "orange" : "cyan";
    }

    // Update stick value display
    const spanLx = document.getElementById("val-lx");
    const spanLy = document.getElementById("val-ly");
    const spanRx = document.getElementById("val-rx");
    const spanRy = document.getElementById("val-ry");
    if (spanLx) spanLx.textContent = lx.toFixed(2);
    if (spanLy) spanLy.textContent = ly.toFixed(2);
    if (spanRx) spanRx.textContent = rx.toFixed(2);
    if (spanRy) spanRy.textContent = ry.toFixed(2);

    // 2. FACE BUTTONS
    setBtn("btn-cross", bCross, "#5555ff");
    setBtn("btn-circle", bCircle, "#ff5555");
    setBtn("btn-triangle", bTri, "#00aa00");
    setBtn("btn-square", bSquare, "#ff55ff");

    // 3. D-PAD
    setBtn("btn-up", hatY > 0);
    setBtn("btn-down", hatY < 0);
    setBtn("btn-left", hatX > 0);
    setBtn("btn-right", hatX < 0);

    // 4. BUMPERS
    setBtn("btn-l1", bL1);
    setBtn("btn-r1", bR1);

    // 5. TRIGGERS
    const elL2 = document.getElementById("fill-l2");
    const elR2 = document.getElementById("fill-r2");
    const l2_norm = (l2_axis + 1) / 2 * 100;
    const r2_norm = (r2_axis + 1) / 2 * 100;

    if (elL2) elL2.style.height = `${Math.max(0, Math.min(100, l2_norm))}%`;
    if (elR2) elR2.style.height = `${Math.max(0, Math.min(100, r2_norm))}%`;

    // 6. CENTER
    setBtn("btn-share", bShare, "white");
    setBtn("btn-opt", bOpt, "white");
    setBtn("btn-ps", bPS, "blue");
}


window.updateThrustmaster = function (msg) {
    // Thrustmaster logic...
    // For now, if user wants to see it on PS5 canvas or similar.
    // Given the request for Vector Vis which shows velocity, that is the primary feedback for driving.
}


function pollTelemetry() {
    // Poll for Ping Status (RASPI and Jetson)
    fetch('data/ping_status.json?t=' + Date.now())
        .then(r => r.json())
        .then(data => {
            raspiStatus = data.raspi || 'OFFLINE';
            // Update RASPI status
            const raspiRecon = document.getElementById('status-raspi-recon');
            const raspiMission = document.getElementById('status-raspi-mission');
            if (raspiRecon) {
                raspiRecon.textContent = data.raspi || 'OFFLINE';
                raspiRecon.style.color = data.raspi === 'ONLINE' ? 'lime' : 'red';
            }
            if (raspiMission) {
                raspiMission.textContent = data.raspi || 'OFFLINE';
                raspiMission.style.color = data.raspi === 'ONLINE' ? 'lime' : 'red';
            }

            // Update Jetson status
            const jetsonRecon = document.getElementById('status-jetson-recon');
            const jetsonMission = document.getElementById('status-jetson-mission');
            if (jetsonRecon) {
                jetsonRecon.textContent = data.jetson || 'OFFLINE';
                jetsonRecon.style.color = data.jetson === 'ONLINE' ? 'lime' : 'red';
            }
            if (jetsonMission) {
                jetsonMission.textContent = data.jetson || 'OFFLINE';
                jetsonMission.style.color = data.jetson === 'ONLINE' ? 'lime' : 'red';
            }

            // Update HEALTH tab
            const healthRaspi = document.getElementById('health-raspi');
            const healthJetson = document.getElementById('health-jetson');
            if (healthRaspi) {
                healthRaspi.textContent = data.raspi || 'OFFLINE';
                healthRaspi.style.color = data.raspi === 'ONLINE' ? 'lime' : 'red';
            }
            if (healthJetson) {
                healthJetson.textContent = data.jetson || 'OFFLINE';
                healthJetson.style.color = data.jetson === 'ONLINE' ? 'lime' : 'red';
            }
        })
        .catch(e => {
            // Silently fail - status will stay as default
        });
}

// Start Polling (Only for status, not visuals)
setInterval(pollTelemetry, 2000); // 2Hz is enough for status
pollTelemetry(); // Initial call

// --- CONTROLLER VISUALIZATION ---
// Visualization is handled by ROS subscriptions in ros_module.js
// via rosbridge websocket (/joy0 for Thrustmaster, /joy for PS5)

// Init Camera 2
const cam2 = document.getElementById('video-stream-ld');
if (cam2) cam2.src = CONFIG.VIDEO_URL;