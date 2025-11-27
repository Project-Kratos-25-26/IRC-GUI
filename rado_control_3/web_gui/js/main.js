// --- TAB SWITCHING ---
function openTab(id) {
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    
    // Highlight button based on ID
    // (Simple logic to find button by index for this specific HTML structure)
    const btnIndex = ['tab-setup','tab-health','tab-recon','tab-mission','tab-arm'].indexOf(id);
    if(btnIndex >= 0) document.querySelectorAll('.tab-btn')[btnIndex].classList.add('active');

    // Fix map rendering bug when unhiding div
    if(id === 'tab-mission' && typeof map !== 'undefined') {
        setTimeout(() => map.invalidateSize(), 200);
    }
}

// --- COMMAND SENDERS ---
function sendCmd(cmd) {
    cmdPub.publish(new ROSLIB.Message({data: cmd}));
    addMissionLog(`Sent command: ${cmd}`);
}

function sendSysCommand(cmd) {
    sysPub.publish(new ROSLIB.Message({data: cmd}));
    alert(`System Command: ${cmd}`);
}

// --- LOGGING LOGIC ---
let selectedColor = null;

function selColor(c) {
    selectedColor = c;
    document.getElementById('log-msg').innerText = `Selected: ${c}`;
}

function sendLog() {
    if(!selectedColor) { alert("Select Color First!"); return; }
    const obj = document.getElementById('obj-select').value;
    
    // Publish Log Request
    logPub.publish(new ROSLIB.Message({data: `${obj}|${selectedColor}`}));
    
    document.getElementById('log-msg').innerText = `Logged: ${obj} (${selectedColor})`;
    
    // Add visual marker to map
    const lat = parseFloat(document.getElementById('recon-lat').innerText);
    const lon = parseFloat(document.getElementById('recon-lon').innerText);
    if(typeof map !== 'undefined' && lat !== 0) {
        L.marker([lat, lon]).addTo(map).bindPopup(obj).openPopup();
    }
}

// --- ARM CONTROLS ---
function updateArm(jointIndex, value) {
    const labels = document.querySelectorAll('.arm-slider-group label span');
    labels[jointIndex].innerText = value + (jointIndex < 3 ? '°' : '%');
    armPub.publish(new ROSLIB.Message({data: `${jointIndex}:${value}`}));
}

function sendArmPreset(pose) {
    armPub.publish(new ROSLIB.Message({data: `PRESET:${pose}`}));
}

// --- HEALTH DISPLAY ---
window.renderHealth = function(data) {
    const list = document.getElementById('health-list');
    let html = "";
    
    for(const [k, v] of Object.entries(data.pings)) {
        html += `<div class="health-row"><span>${k}</span><span class="${v?'health-ok':'health-err'}">${v?'ONLINE':'OFFLINE'}</span></div>`;
    }
    for(const [k, v] of Object.entries(data.topics)) {
        html += `<div class="health-row"><span>${k}</span><span class="${v=='OK'?'health-ok':'health-err'}">${v}</span></div>`;
    }
    list.innerHTML = html;
}

function addMissionLog(text) {
    const ul = document.getElementById('mission-log');
    if(ul) {
        const li = document.createElement('li');
        li.innerText = `[${new Date().toLocaleTimeString()}] ${text}`;
        ul.prepend(li);
    }
}

// Set Video Source
document.getElementById('video-stream').src = CONFIG.VIDEO_URL;