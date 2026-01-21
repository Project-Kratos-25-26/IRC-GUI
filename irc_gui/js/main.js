// Tab Switching
let currentActiveTab = 'tab-recon'; // Default in index.html

function openTab(id) {
    currentActiveTab = id;
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.add('active');

    const btnIndex = ['tab-setup', 'tab-health', 'tab-recon', 'tab-mission', 'tab-arm'].indexOf(id);
    if (btnIndex >= 0) document.querySelectorAll('.tab-btn')[btnIndex].classList.add('active');

    if (id === 'tab-mission' && typeof map !== 'undefined') {
        setTimeout(() => map.invalidateSize(), 200);
    }

    // Manage Video Connections (Lazy Load + Active Only)
    manageVideoStreams();
}

// --- VIDEO CONNECTION MANAGEMENT ---
// --- RECONNECT LOGIC ---
function retryStream(img) {
    if (!img.dataset.streamPath) return;
    // Avoid rapid-fire retries if already disconnected
    if (img.dataset.isRetrying === 'true') return;

    img.dataset.isRetrying = 'true';
    console.warn(`[Stream] Connection lost for ${img.dataset.cameraName}, retrying...`);

    // Clear simply to visual indicate issue? Or keep last frame?
    // img.style.opacity = '0.5'; 

    setTimeout(() => {
        cameraStatus.forEach(cam => {
            statusMap[cam.name] = cam;
            // Also support "Cam1", "Cam2" format
            const camNumMatch = cam.name.match(/\d+/);
            if (camNumMatch) {
                statusMap[`Camera ${camNumMatch[0]}`] = cam;
                statusMap[`Cam${camNumMatch[0]}`] = cam;
            }
        });
    })
}
function manageVideoStreams() {
    // Find all camera images
    const cams = document.querySelectorAll('img.camera-feed');
    cams.forEach(img => {
        const parentTab = img.closest('.tab-pane');

        // 1. Check if Tab is Active
        if (parentTab && parentTab.id === currentActiveTab) {

            // 2. Check if Camera is Globally Active (and we have a configured source)
            const camName = img.dataset.cameraName;
            if (img.dataset.streamPath && camName) {

                // If backend says this camera is active, ENABLE stream
                if (activeCameras.includes(camName)) {
                    // Reset or Initialize Stream
                    // We use 'includes' instead of 'endsWith' to allow for '?t=' timestamps
                    if (!img.src || !img.src.includes(img.dataset.streamPath)) {
                        img.src = img.dataset.streamPath;
                        img.style.opacity = '1'; // Ensure visible
                    }

                    // Attach Robust Error Handler
                    img.onerror = function () { retryStream(this); };

                } else {
                    // Backend says inactive: DISABLE stream
                    img.removeAttribute('src');
                    img.style.opacity = '0.5';
                    img.onerror = null; // Clear handler
                }
            }
        } else {
            // Tab is hidden: DISABLE stream
            img.removeAttribute('src');
        }
    });
}

// --- COMMAND SENDERS ---
let raspiStatus = "OFFLINE";
let jetsonStatus = "OFFLINE";
let activeCameras = []; // List of active cameras from Go server (Global)

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

// --- SYSTEM COMMAND HANDLER ---
// Handles buttons like "Initialize Drive", "Start Mission", "Manual Mode", etc.
function sendSysCommand(cmd) {
    // -------------------------------------------------------------------------
    // 1. OFFLINE GUARD
    // -------------------------------------------------------------------------
    // Define a list of commands that require the Raspberry Pi to be connected.
    // These commands involve starting hardware or changing drive modes.
    const blockedCmds = ['init_drive', 'init_ld', 'init_arm'];

    // Check if the command is in the blocked list AND if the global 'raspiStatus'
    // (updated by the polling loop) is NOT 'ONLINE'.
    if (blockedCmds.includes(cmd) && raspiStatus !== 'ONLINE') {
        // If offline, block the command and alert the user.
        alert("Cannot Execute: Raspberry Pi is OFFLINE! Please check connection.");
        return;
    }

    // -------------------------------------------------------------------------
    // 2. MISSION INITIALIZATION (Local API)
    // -------------------------------------------------------------------------
    // 'init_mission' is the primary entry point for starting the autonomy stack.
    // It triggers `start_mission.sh` with the 'all' argument.
    //
    // Workflow:
    // 1. User clicks "Initialize Mission" (or similar button).
    // 2. Javascript POSTs to /api/run_script -> start_mission.sh.
    // 3. Script checks for existing 'mission_ui' tmux session.
    // 4. If new, it creates the session and launches 'terminator'.
    // 5. It then recursively calls itself for each component (rtabmap, nav2, etc.).
    // 6. Each recursive call adds a new pane ("Lego block") to the tmux window.
    // 7. Result: A single window tiled with 7+ terminals, each running one node.
    if (cmd === 'init_mission') {
        console.log(`[DEBUG] init_mission called - running via local API`);

        fetch('/api/run_script', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                script: 'start_mission.sh',
                args: ['all'] // Explicitly launch ALL components for the main init button
            })
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    console.log('Mission init started:', data.message);
                } else {
                    alert('Failed to start mission: ' + data.error);
                }
            })
            .catch(err => {
                console.error('Error starting mission:', err);
                alert('Error starting mission: ' + err);
            });

        return;
    }

    // -------------------------------------------------------------------------
    // 3. DRIVE INITIALIZATION (Local API)
    // -------------------------------------------------------------------------
    // 'init_drive' is also special: it starts the ROS2 drive stack.
    // This triggers `start_drive.sh` on the laptop, which SSHs into the Pi.
    if (cmd === 'init_drive') {
        console.log(`[DEBUG] init_drive called - running via local API`);

        // Call the backend API endpoint '/api/run_script'
        fetch('/api/run_script', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ script: 'start_drive.sh' }) // Specify the script to run
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // The script started successfully.
                    console.log('Drive init started successfully:', data.message);

                    // Optimistic UI Update:
                    // We assume the drive will start up, so we switch the UI badge
                    // to 'MANUAL' immediately to give the user visual feedback.
                    updateMode('MANUAL');
                } else {
                    // The server blocked the script or it failed to launch.
                    console.error('Drive init failed:', data.error);
                    alert('Failed to start drive: ' + data.error);
                }
            })
            .catch(err => {
                // Handle connection errors to the local Flask server.
                console.error('Network/Server Error starting drive:', err);
                alert('Error starting drive: ' + err);
            });

        // Return early to prevent double-sending (API call vs ROS message).
        return;
    }

    // -------------------------------------------------------------------------
    // 4. MODE SWITCHING (via ROS -> gui_backend_node.py -> switch_mode.sh)
    // -------------------------------------------------------------------------
    // Mode commands are handled by gui_backend_node.py which listens on /sys/command
    // and executes switch_mode.sh with the appropriate argument
    if (cmd === 'manual_mode' || cmd === 'auto_mode') {
        console.log(`[DEBUG] ${cmd} called - sending to gui_backend via ROS`);
        sysPub.publish(new ROSLIB.Message({ data: cmd }));

        // Optimistic UI update
        if (cmd === 'manual_mode') updateMode('MANUAL');
        if (cmd === 'auto_mode') updateMode('AUTO');

        console.log(`Mode command sent to ROS: ${cmd}`);
        return;
    }

    // -------------------------------------------------------------------------
    // 5. OTHER ROS COMMANDS
    // -------------------------------------------------------------------------
    // For other commands, publish them to the '/sys/command' ROS topic.
    sysPub.publish(new ROSLIB.Message({ data: cmd }));
    console.log(`System Command sent to ROS: ${cmd}`);
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
    const objType = document.getElementById('obj-select').value; // 'pickup' or 'dropoff'

    // Get current position from odometry display
    const xStr = document.getElementById('odom-x').textContent;
    const yStr = document.getElementById('odom-y').textContent;

    // Send to server API (writes directly to Orin via SSH)
    fetch('/api/mission_plan/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: objType,
            color: selectedColor,
            lat: xStr,
            lon: yStr
        })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                console.log('Logged to mission plan via SSH');
            } else {
                console.error('Failed to log:', data.error);
                alert('Failed to log: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(e => {
            console.error('Log request failed:', e);
            alert('Log request failed: ' + e);
        });

    const logText = `Logged: ${objType} | Color: ${selectedColor} | Loc: [${xStr}, ${yStr}]`;
    document.getElementById('log-msg').textContent = logText;
    console.log(logText);

    // Add visual marker to map
    const x = parseFloat(xStr);
    const y = parseFloat(yStr);
    if (typeof map !== 'undefined' && x !== 0) {
        L.marker([x, y]).addTo(map).bindPopup(`${objType}: ${selectedColor}`).openPopup();
    }

    // Refresh mission plan display if on mission tab
    setTimeout(refreshMissionPlan, 500);
}

// --- MISSION PLAN MANAGEMENT ---
let missionPlanData = {};
let selectedGoal = null;
let missionQueue = [];
let currentMissionIndex = -1;
let missionActive = false;
let dropoffCountdown = null;
let editingCoord = null;

function refreshMissionPlan() {
    fetch('/api/mission_plan?t=' + Date.now())
        .then(r => r.json())
        .then(data => {
            missionPlanData = data;
            renderMissionPlanGrid(data);
        })
        .catch(e => {
            console.error("Failed to load mission plan:", e);
            document.getElementById('mission-plan-grid').innerHTML =
                '<div style="color:red; text-align:center; padding:20px;">Failed to load mission plan</div>';
        });
}

function renderMissionPlanGrid(data) {
    const colors = ['red', 'yellow', 'orange', 'blue', 'green'];
    const colorLabels = { red: 'RED', yellow: 'YELLOW', orange: 'ORANGE', blue: 'BLUE', green: 'GREEN' };

    let html = '';

    colors.forEach(color => {
        const pickups = data.pickup?.[color] || [];
        const dropoffs = data.dropoff?.[color] || [];

        html += `<div class="mission-row">`;
        html += `<div class="mission-row-color ${color}">${colorLabels[color]}</div>`;

        // Pickup column
        html += `<div class="mission-cell ${pickups.length === 0 ? 'empty' : ''}">`;
        if (pickups.length === 0) {
            html += 'No data';
        } else {
            pickups.forEach((coord, idx) => {
                const goalId = `pickup_${color}_${idx}`;
                const isInQueue = missionQueue.some(q => q.id === goalId);
                html += `
                    <div class="mission-coord-item ${isInQueue ? 'selected' : ''}" 
                         onclick="addToQueue('${goalId}', 'pickup', '${color}', ${coord.lat}, ${coord.lon})">
                        <span class="mission-coord-text">${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)}</span>
                        <div class="mission-coord-actions">
                            <button class="coord-action-btn btn-blue" onclick="event.stopPropagation(); openEditModal('pickup', '${color}', ${coord.lat}, ${coord.lon})" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                        </div>
                    </div>`;
            });
        }
        html += `</div>`;

        // Dropoff column
        html += `<div class="mission-cell ${dropoffs.length === 0 ? 'empty' : ''}">`;
        if (dropoffs.length === 0) {
            html += 'No data';
        } else {
            dropoffs.forEach((coord, idx) => {
                const goalId = `dropoff_${color}_${idx}`;
                const isInQueue = missionQueue.some(q => q.id === goalId);
                html += `
                    <div class="mission-coord-item ${isInQueue ? 'selected' : ''}" 
                         onclick="addToQueue('${goalId}', 'dropoff', '${color}', ${coord.lat}, ${coord.lon})">
                        <span class="mission-coord-text">${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)}</span>
                        <div class="mission-coord-actions">
                            <button class="coord-action-btn btn-blue" onclick="event.stopPropagation(); openEditModal('dropoff', '${color}', ${coord.lat}, ${coord.lon})" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                        </div>
                    </div>`;
            });
        }
        html += `</div>`;

        html += `</div>`;
    });

    document.getElementById('mission-plan-grid').innerHTML = html;
}

// --- MISSION QUEUE MANAGEMENT ---
function addToQueue(id, type, color, lat, lon) {
    // Check if already in queue
    const existingIndex = missionQueue.findIndex(q => q.id === id);
    if (existingIndex !== -1) {
        // Remove from queue if already present
        missionQueue.splice(existingIndex, 1);
        addMissionLog(`Removed from queue: ${type} ${color}`);
    } else {
        // Add to queue
        missionQueue.push({ id, type, color, lat, lon, status: 'pending' });
        addMissionLog(`Added to queue: ${type} ${color} (#${missionQueue.length})`);
    }

    renderMissionQueue();
    renderMissionPlanGrid(missionPlanData);
}

function renderMissionQueue() {
    const container = document.getElementById('mission-queue');

    if (missionQueue.length === 0) {
        container.innerHTML = '<div class="queue-empty">No waypoints in queue. Click coordinates above to add.</div>';
        return;
    }

    let html = '';
    missionQueue.forEach((item, idx) => {
        const isActive = idx === currentMissionIndex && missionActive;
        const isCompleted = item.status === 'completed';
        const colorStyle = item.color === 'yellow' ? '#f1c40f' : item.color;

        html += `
            <div class="queue-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}">
                <div class="queue-item-order">${idx + 1}</div>
                <div class="queue-item-info">
                    <div class="queue-item-type" style="color:${colorStyle}">
                        ${item.type.toUpperCase()} - ${item.color.toUpperCase()}
                    </div>
                    <div class="queue-item-coords">${item.lat.toFixed(6)}, ${item.lon.toFixed(6)}</div>
                </div>
                <div class="queue-item-actions">
                    ${idx > 0 ? `<button class="queue-btn" onclick="moveQueueItem(${idx}, -1)" title="Move Up"><i class="fas fa-arrow-up"></i></button>` : ''}
                    ${idx < missionQueue.length - 1 ? `<button class="queue-btn" onclick="moveQueueItem(${idx}, 1)" title="Move Down"><i class="fas fa-arrow-down"></i></button>` : ''}
                    <button class="queue-btn btn-red" onclick="removeFromQueue(${idx})" title="Remove"><i class="fas fa-times"></i></button>
                </div>
            </div>`;
    });

    container.innerHTML = html;
}

function moveQueueItem(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= missionQueue.length) return;

    const item = missionQueue.splice(index, 1)[0];
    missionQueue.splice(newIndex, 0, item);

    renderMissionQueue();
    addMissionLog(`Reordered queue: ${item.type} ${item.color} now #${newIndex + 1}`);
}

function removeFromQueue(index) {
    const item = missionQueue.splice(index, 1)[0];
    renderMissionQueue();
    renderMissionPlanGrid(missionPlanData);
    addMissionLog(`Removed from queue: ${item.type} ${item.color}`);
}

function clearMissionQueue() {
    missionQueue = [];
    currentMissionIndex = -1;
    missionActive = false;
    renderMissionQueue();
    renderMissionPlanGrid(missionPlanData);
    addMissionLog('Mission queue cleared');
}

// --- COORDINATE EDITING ---
function openEditModal(type, color, lat, lon) {
    editingCoord = { type, color, lat, lon };

    document.getElementById('edit-type').value = type.toUpperCase();
    document.getElementById('edit-color').value = color.toUpperCase();
    document.getElementById('edit-lat').value = lat;
    document.getElementById('edit-lon').value = lon;

    document.getElementById('edit-coord-modal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('edit-coord-modal').style.display = 'none';
    editingCoord = null;
}

function saveCoordEdit() {
    if (!editingCoord) return;

    const newLat = parseFloat(document.getElementById('edit-lat').value);
    const newLon = parseFloat(document.getElementById('edit-lon').value);

    if (isNaN(newLat) || isNaN(newLon)) {
        alert('Invalid coordinates');
        return;
    }

    fetch('/api/mission_plan/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: editingCoord.type,
            color: editingCoord.color,
            old_lat: editingCoord.lat,
            old_lon: editingCoord.lon,
            new_lat: newLat,
            new_lon: newLon
        })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                addMissionLog(`Updated ${editingCoord.type} ${editingCoord.color} coordinates`);
                closeEditModal();
                refreshMissionPlan();
            } else {
                alert('Failed to update coordinates');
            }
        })
        .catch(e => {
            console.error('Error updating coordinates:', e);
            alert('Failed to update coordinates');
        });
}

function deleteCoord() {
    if (!editingCoord) return;

    if (!confirm(`Delete ${editingCoord.type} ${editingCoord.color} at (${editingCoord.lat.toFixed(6)}, ${editingCoord.lon.toFixed(6)})?`)) {
        return;
    }

    fetch('/api/mission_plan/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            type: editingCoord.type,
            color: editingCoord.color,
            lat: editingCoord.lat,
            lon: editingCoord.lon
        })
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                addMissionLog(`Deleted ${editingCoord.type} ${editingCoord.color}`);
                closeEditModal();
                refreshMissionPlan();
                // Also remove from queue if present
                missionQueue = missionQueue.filter(q =>
                    !(q.type === editingCoord.type && q.color === editingCoord.color &&
                        Math.abs(q.lat - editingCoord.lat) < 0.000001 && Math.abs(q.lon - editingCoord.lon) < 0.000001)
                );
                renderMissionQueue();
            } else {
                alert('Failed to delete coordinate');
            }
        })
        .catch(e => {
            console.error('Error deleting coordinate:', e);
            alert('Failed to delete coordinate');
        });
}

// --- MULTI-WAYPOINT MISSION EXECUTION ---
function proceedWithQueue() {
    if (missionQueue.length === 0) {
        alert("Please add waypoints to the queue first!");
        return;
    }

    if (raspiStatus !== 'ONLINE') {
        alert("Cannot Proceed: Raspberry Pi is OFFLINE!");
        return;
    }

    // Start mission from beginning if not active
    if (!missionActive) {
        currentMissionIndex = 0;
        missionActive = true;
        missionQueue.forEach(q => q.status = 'pending');
    }

    // Send current goal to mission manager
    sendCurrentGoal();
}

function sendCurrentGoal() {
    if (currentMissionIndex < 0 || currentMissionIndex >= missionQueue.length) {
        // Mission complete
        missionActive = false;
        document.getElementById('mission-status-panel').style.display = 'none';
        addMissionLog('Mission queue complete!');
        return;
    }

    const goal = missionQueue[currentMissionIndex];
    goal.status = 'active';

    // Show mission status
    showMissionStatus(`Navigating to #${currentMissionIndex + 1}: ${goal.type} ${goal.color}`);

    // Publish goal to ROS
    const goalData = `QUEUE|${currentMissionIndex}|${goal.type}|${goal.color}|${goal.lat}|${goal.lon}`;

    const goalPub = new ROSLIB.Topic({
        ros: ros,
        name: '/mission/set_goal',
        messageType: 'std_msgs/String'
    });
    goalPub.publish(new ROSLIB.Message({ data: goalData }));

    // Send PROCEED command
    setTimeout(() => {
        sysPub.publish(new ROSLIB.Message({ data: 'PROCEED' }));
    }, 100);

    addMissionLog(`Proceeding to #${currentMissionIndex + 1}: ${goal.type} ${goal.color}`);
    updateMode('AUTO');
    renderMissionQueue();
}

function showMissionStatus(text) {
    const panel = document.getElementById('mission-status-panel');
    const display = document.getElementById('mission-progress-display');
    panel.style.display = 'block';
    display.innerHTML = `<div class="mission-action-text">${text}</div>`;
}

function showDropoffCountdown(seconds) {
    const panel = document.getElementById('mission-status-panel');
    const display = document.getElementById('mission-progress-display');
    panel.style.display = 'block';

    let remaining = seconds;
    display.innerHTML = `
        <div class="mission-action-text">Opening cache box</div>
        <div class="mission-countdown">${remaining}</div>
    `;

    if (dropoffCountdown) clearInterval(dropoffCountdown);

    dropoffCountdown = setInterval(() => {
        remaining--;
        const countdownEl = display.querySelector('.mission-countdown');
        if (countdownEl) countdownEl.textContent = remaining;

        if (remaining <= 0) {
            clearInterval(dropoffCountdown);
            dropoffCountdown = null;
            onDropoffComplete();
        }
    }, 1000);
}

function onDropoffComplete() {
    const goal = missionQueue[currentMissionIndex];
    if (goal) {
        goal.status = 'completed';
        addMissionLog(`Completed dropoff at ${goal.color}`);
    }

    // Move to next waypoint
    currentMissionIndex++;
    renderMissionQueue();

    if (currentMissionIndex < missionQueue.length) {
        // Proceed to next goal automatically
        setTimeout(() => {
            sendCurrentGoal();
        }, 1000);
    } else {
        // Mission complete
        missionActive = false;
        document.getElementById('mission-status-panel').style.display = 'none';
        addMissionLog('All waypoints completed!');
    }
}

function onWaypointReached(goalIndex, goalType) {
    if (goalIndex !== currentMissionIndex) return;

    const goal = missionQueue[currentMissionIndex];

    if (goalType === 'dropoff') {
        // Show countdown for dropoff
        showDropoffCountdown(10);
    } else {
        // Pickup complete, move to next
        if (goal) {
            goal.status = 'completed';
            addMissionLog(`Completed pickup at ${goal.color}`);
        }

        currentMissionIndex++;
        renderMissionQueue();

        if (currentMissionIndex < missionQueue.length) {
            setTimeout(() => {
                sendCurrentGoal();
            }, 1000);
        } else {
            missionActive = false;
            document.getElementById('mission-status-panel').style.display = 'none';
            addMissionLog('All waypoints completed!');
        }
    }
}

function stopMission() {
    missionActive = false;
    if (dropoffCountdown) {
        clearInterval(dropoffCountdown);
        dropoffCountdown = null;
    }

    // Send stop command
    sysPub.publish(new ROSLIB.Message({ data: 'MANUAL' }));

    document.getElementById('mission-status-panel').style.display = 'none';
    addMissionLog('Mission stopped');
    updateMode('MANUAL');
}

// Expose onWaypointReached globally for ros_module.js to call
window.onWaypointReached = onWaypointReached;

// Legacy function for backwards compatibility
function selectGoal(id, type, color, lat, lon) {
    addToQueue(id, type, color, lat, lon);
}

function proceedWithGoal() {
    proceedWithQueue();
}

function clearMissionPlan() {
    if (!confirm("Are you sure you want to clear all mission data?")) return;

    fetch('/api/mission_plan/clear', { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                // Also clear the mission queue
                missionQueue = [];
                currentMissionIndex = -1;
                missionActive = false;
                renderMissionQueue();
                refreshMissionPlan();
                addMissionLog("Mission plan cleared");
            } else {
                alert("Failed to clear mission plan");
            }
        })
        .catch(e => {
            console.error("Failed to clear mission plan:", e);
            alert("Failed to clear mission plan");
        });
}

// Load mission plan when switching to mission tab
const originalOpenTab = openTab;
window.openTab = function (id) {
    originalOpenTab(id);
    if (id === 'tab-mission') {
        refreshMissionPlan();
    }
};

// --- ARM CONTROLS ---
function updateArm(jointIndex, value) {
    const labels = document.querySelectorAll('.arm-slider-group label span');
    labels[jointIndex].textContent = value + (jointIndex < 3 ? '°' : '%');
    armPub.publish(new ROSLIB.Message({ data: `${jointIndex}:${value}` }));
}

function sendArmPreset(pose) {
    armPub.publish(new ROSLIB.Message({ data: `PRESET:${pose}` }));
}

// --- CAMERA POPUP WINDOW ---
let cameraPopupWindow = null;

function openCameraPopup() {
    // Check if popup exists and is still open
    if (cameraPopupWindow && !cameraPopupWindow.closed) {
        // Focus existing window
        cameraPopupWindow.focus();
        return;
    }

    // Calculate window size (80% of screen)
    const width = Math.round(window.screen.width * 0.8);
    const height = Math.round(window.screen.height * 0.8);
    const left = Math.round((window.screen.width - width) / 2);
    const top = Math.round((window.screen.height - height) / 2);

    // Open new popup window
    cameraPopupWindow = window.open(
        'camera_popup.html',
        'CameraFeeds',
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no,menubar=no,toolbar=no,status=no`
    );

    if (cameraPopupWindow) {
        console.log('[Camera Popup] Opened camera popup window');
        addMissionLog('Opened camera popup window');
    } else {
        alert('Popup blocked! Please allow popups for this site.');
    }
}

// Expose globally
window.openCameraPopup = openCameraPopup;

// --- CAMERA LOGIC ---
function initCameraSystem() {
    const selects = document.querySelectorAll('.cam-select');
    const sources = Object.keys(CONFIG.CAMERA_SOURCES);

    selects.forEach(sel => {
        sel.innerHTML = "";
        sources.forEach(src => {
            const opt = document.createElement('option');
            opt.value = src;
            opt.textContent = src;
            sel.appendChild(opt);
        });
    });

    // Set specific defaults
    setSelectDefault('cam-recon-1', 'Camera 1');
    setSelectDefault('cam-recon-1', 'GIMBAL');
    setSelectDefault('cam-recon-2', 'Camera 1');
    setSelectDefault('cam-recon-3', 'Camera 2');
    setSelectDefault('cam-recon-4', 'Camera 3');
    setSelectDefault('cam-recon-zed', 'ZED');
    setSelectDefault('cam-arm-1', 'GIMBAL');
    setSelectDefault('cam-arm-2', 'Camera 4');
    setSelectDefault('cam-arm-3', 'Camera 5');
}

function setSelectDefault(imgId, sourceName) {
    // Find select sibling to imgId
    const img = document.getElementById(imgId);
    if (!img) return;
    const sel = img.parentElement.querySelector('select');
    if (sel) {
        sel.value = sourceName;
        // Trigger update to set data attribute
        updateCamera(imgId, sourceName);
    }
}

window.updateCamera = function (imgId, sourceKey) {
    const img = document.getElementById(imgId);
    if (!img) return;

    const source = CONFIG.CAMERA_SOURCES[sourceKey];
    if (!source) return;

    // Save configuration
    const streamPath = `/video_feed/${source.id}`;
    img.dataset.streamPath = streamPath;
    img.dataset.cameraName = sourceKey; // Save "Camera 1" etc.

    // Trigger explicit update
    manageVideoStreams();
}

// Initialize camera system on load
setTimeout(() => {
    initCameraSystem();
    pollCameraStatus(); // Initial poll to get active status immediately
}, 500);

const ALL_CAMS = ["Camera 1", "Camera 2", "Camera 3", "Camera 4", "Camera 5", "Camera 6", "Camera 7", "Camera 8"];

function pollCameraStatus() {
    Promise.all([
        fetch('/health').then(r => r.json()).catch(() => null),
        fetch('/active_cameras').then(r => r.json()).catch(() => [])
    ]).then(([health, activeCams]) => {
        // UPDATE GLOBAL STATE
        activeCameras = activeCams || [];

        // Refresh Video Streams (Dynamic Active/Inactive toggling)
        manageVideoStreams();

        // --- FETCH CAMERA STATUS FROM JETSON ---
        fetch('http://192.168.1.10:51000/camera/status')
            .then(res => res.json())
            .then(cameraStatus => {
                // --- HEALTH UI UPDATE ---
                try {
                    const camHealth = document.getElementById('health-cameras');
                    if (!camHealth) return; // If not on same page or element missing

                    // Create a map of devices for quick lookup by various name formats
                    const statusMap = {};
                    cameraStatus.forEach(cam => {
                        statusMap[cam.name] = cam;
                        // Also support "Cam1", "Cam2" format
                        const camNumMatch = cam.name.match(/\d+/);
                        if (camNumMatch) {
                            statusMap[`Camera ${camNumMatch[0]}`] = cam;
                            statusMap[`Cam${camNumMatch[0]}`] = cam;
                        }
                    });

                    let html = "<h4 style='margin-bottom:15px; color:#ddd; border-bottom:1px solid #444; padding-bottom:10px;'>Camera System Health</h4>";

                    // Count running cameras
                    const runningCount = cameraStatus.filter(c => c.running).length;
                    const availableCount = cameraStatus.length;

                    html += `
                    <div style="display:flex; gap:20px; margin-bottom:20px;">
                        <div class="card card-compact" style="flex:1; background:#222; border:1px solid #444; padding:15px; text-align:center;">
                            <div style="font-size:12px; color:#aaa; margin-bottom:5px;">AVAILABLE CAMERAS</div>
                            <div style="font-size:18px; font-weight:bold; color:cyan">${availableCount} / 8</div>
                        </div>
                        <div class="card card-compact" style="flex:1; background:#222; border:1px solid #444; padding:15px; text-align:center;">
                            <div style="font-size:12px; color:#aaa; margin-bottom:5px;">RUNNING STREAMS</div>
                            <div style="font-size:18px; font-weight:bold; color:#2ecc71">${runningCount} / ${availableCount}</div>
                        </div>
                    </div>`;

                    // Camera Grid with 8 cameras
                    html += "<div style='display:grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap:12px; margin-top:15px;'>";

                    for (let i = 1; i <= 8; i++) {
                        const isSpecial = (i === 7 || i === 8);
                        const displayName = (i === 7) ? 'GIMBAL' : (i === 8) ? 'ZED' : `Camera ${i}`;
                        const camData = statusMap[displayName] || statusMap[`Camera ${i}`] || statusMap[`Cam${i}`];

                        let bgColor, borderColor, statusText, statusColor, cursor;

                        if (!camData) {
                            // Not available
                            bgColor = 'rgba(100, 100, 100, 0.2)';
                            borderColor = '#555';
                            statusText = 'UNAVAILABLE';
                            statusColor = '#888';
                            cursor = isSpecial ? 'pointer' : 'not-allowed';
                        } else if (camData.running) {
                            // Running (green)
                            bgColor = 'rgba(46, 204, 113, 0.2)';
                            borderColor = '#27ae60';
                            statusText = 'RUNNING';
                            statusColor = '#2ecc71';
                            cursor = 'pointer';
                        } else {
                            // Available but not running (white)
                            bgColor = 'rgba(200, 200, 200, 0.1)';
                            borderColor = '#999';
                            statusText = 'AVAILABLE';
                            statusColor = '#ccc';
                            cursor = 'pointer';
                        }

                        const isDisabled = (!camData && !isSpecial) ? 'disabled' : '';
                        const requestedName = camData ? camData.name : displayName; // send 'GIMBAL'/'ZED' for 7/8
                        const runningFlag = camData ? camData.running : false;
                        const onClickHandler = `onclick="toggleCamera('${requestedName}', ${runningFlag})"`;

                        html += `
                        <button ${isDisabled} ${onClickHandler} style="background:${bgColor}; border:2px solid ${borderColor}; border-radius:8px; padding:12px; display:flex; flex-direction:column; align-items:center; cursor:${cursor}; transition:all 0.3s; color:#fff; font-family:monospace; font-size:12px;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                            <div style="margin-bottom:6px; font-size:24px; height:24px;"><i class="fas fa-video"></i></div>
                            <div style="font-weight:bold; font-size:13px; margin-bottom:3px;">${displayName}</div>
                            <div style="font-size:11px; letter-spacing:0.5px; color:${statusColor}; font-weight:bold;">${statusText}</div>
                        </button>`;
                    }

                    html += "</div>";
                    html += `<div style="font-size:10px; color:#555; margin-top:15px; text-align:right;">Updated: ${new Date().toLocaleTimeString()}</div>`;

                    camHealth.innerHTML = html;
                } catch (e) {
                    console.error("Health UI Crash:", e);
                }
            })
            .catch(err => {
                console.error('Failed to fetch camera status:', err);
                // Fallback UI if endpoint fails
                const camHealth = document.getElementById('health-cameras');
                if (camHealth) {
                    camHealth.innerHTML = '<div style="color:#e74c3c; padding:20px; text-align:center;">Unable to fetch camera status from Jetson</div>';
                }
            });
    })
}; // End Promise.all


// Toggle camera stream on/off
function toggleCamera(cameraName, isCurrentlyRunning) {
    const action = isCurrentlyRunning ? 'stop' : 'start';

    console.log(`${action.toUpperCase()} camera: ${cameraName}`);

    fetch('http://192.168.1.10:51000/camera/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `name=${encodeURIComponent(cameraName)}`
    })
        .then(res => res.json())
        .then(data => {
            if (data.ok) {
                console.log(`Camera ${action} successful:`, data.message);
                addMissionLog(`Camera ${cameraName} ${action}ed`);
                // Refresh camera status immediately
                setTimeout(pollCameraStatus, 500);
            } else {
                alert(`Failed to ${action} camera: ${data.message}`);
                console.error(`Camera ${action} failed:`, data.message);
            }
        })
        .catch(err => {
            alert(`Error ${action}ing camera: ${err}`);
            console.error(`Camera ${action} error:`, err);
        });
}

// Poll cameras
setInterval(pollCameraStatus, 2000);

function addMissionLog(text) {
    const ul = document.getElementById('mission-log');
    if (ul) {
        const li = document.createElement('li');
        li.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
        ul.prepend(li);
    }
}

// Set Video Source (Legacy - element may not exist)
const videoStream = document.getElementById('video-stream');
if (videoStream) videoStream.src = CONFIG.VIDEO_URL;

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
    // Raw joystick values are -1 to 1, scale to fit in canvas
    const maxRadius = 60; // Fits in 150x150 canvas (center=75, margin for arrow)
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
            jetsonStatus = data.jetson || 'OFFLINE';

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
            raspiStatus = 'OFFLINE';
            jetsonStatus = 'OFFLINE';

            const els = [
                'status-raspi-recon', 'status-raspi-mission', 'health-raspi',
                'status-jetson-recon', 'status-jetson-mission', 'health-jetson'
            ];

            els.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.textContent = 'OFFLINE';
                    el.style.color = 'red';
                }
            });
        });
}

// Start Polling (Only for status, not visuals)
setInterval(pollTelemetry, 2000); // 2Hz is enough for status
pollTelemetry(); // Initial call


// --- CONTROLLER VISUALIZATION ---
// --- MISSION PROCESS CONTROL (The "Lego" System) ---
//
// Overview:
// Instead of launching one giant script that does everything, we now have granular control.
// The user can launch individual components (e.g., just 'nav2') which adds a specific pane 
// to the shared tmux session.
//
// Key Functions:
// - launchComponent(target): Starts a specific node/launch file.
// - stopComponent(target): Kills a specific pane/process.
// - killAllMission(): The "Big Red Button". Kills everything.
// - pollMissionStatus(): Checks what is actually running on the Jetson.

/**
 * launches a specific component by name (e.g., 'rtabmap', 'nav2').
 * Calls start_mission.sh <target> on the backend.
 * @param {string} target - The logical name of the component.
 */
function launchComponent(target) {
    console.log(`Launching component: ${target}`);
    fetch('/api/run_script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            script: 'start_mission.sh',
            args: [target]
        })
    }).catch(err => console.error("Launch error:", err));
}

/**
 * Stops a specific component.
 * Calls stop_mission.sh <target> on the backend.
 * @param {string} target - The logical name of the component.
 */
function stopComponent(target) {
    if (!confirm(`Stop ${target.toUpperCase()}?`)) return;

    console.log(`Stopping component: ${target}`);
    fetch('/api/run_script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            script: 'stop_mission.sh',
            args: [target]
        })
    }).catch(err => console.error("Stop error:", err));
}

/**
 * EMERGENCY STOP / KILL SWITCH
 * Kills the entire tmux session locally AND executes pkill on the remote Jetson
 * to ensure no zombie processes remain.
 */
function killAllMission() {
    if (!confirm("⚠️ KILL ALL MISSION PROCESSES?\nThis will stop everything immediately.")) return;

    console.log("KILLING ALL MISSION PROCESSES");
    fetch('/api/run_script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            script: 'stop_mission.sh',
            args: ['all']
        })
    }).then(() => alert("All processes kill signal sent."))
        .catch(err => alert("Kill failed: " + err));
}

/**
 * Polls the mission_status.json file generated by the backend monitor script.
 * Updates the UI dots (Green/Grey) based on the presence of processes.
 * This runs every 2 seconds.
 * 
 * Note: If the file is missing (monitor script not running/Jetson offline), 
 * it mostly ignores errors to prevent console spam, but UI will remain grey.
 */
function pollMissionStatus() {
    // Poll the status JSON generated by monitor_mission.sh
    fetch('data/mission_status.json?nocache=' + new Date().getTime())
        .then(res => res.json())
        .then(status => {
            const map = {
                'rtabmap': 'dot-rtabmap',
                'tf': 'dot-tf',
                'nav2': 'dot-nav2',
                'velclamp': 'dot-velclamp',
                'mavros': 'dot-mavros',
                'cone': 'dot-cone',
                'rado': 'dot-rado'
            };

            for (const [key, id] of Object.entries(map)) {
                const el = document.getElementById(id);
                if (el) {
                    if (status[key] === true) {
                        el.classList.add('active'); // Turn Green
                    } else {
                        el.classList.remove('active'); // Turn Grey
                    }
                }
            }
        })
        .catch(err => {
            // Ignore errors (file might be busy or not created yet)
        });
}

// Start polling immediately
setInterval(pollMissionStatus, 2000);

// --- UI SOUND EFFECTS ---
const fahAudio = new Audio('data/ui_click.mp3');
let soundEnabled = localStorage.getItem('soundEnabled') !== 'false'; // Default true (strings 'true' or null -> true)

function toggleSound(enabled) {
    soundEnabled = enabled;
    localStorage.setItem('soundEnabled', enabled);
    if (enabled) playSound(); // Preview
}

function playSound() {
    if (soundEnabled && fahAudio) {
        fahAudio.currentTime = 0;
        // Low volume to not be annoying? Or full blast? User asked for effect.
        fahAudio.volume = 0.5;
        fahAudio.play().catch(e => {
            // Browsers block audio until user interaction. 
            // Since we trigger this *on* user interaction, it should be fine.
            console.log('Audio play blocked:', e);
        });
    }
}

// Global Interaction Listener
document.addEventListener('click', (e) => {
    // Check if element is interactive.
    // We target: buttons, links, inputs, selects, and specific class containers that act as buttons.
    const target = e.target.closest('button, a, input, select, .cam-slot, .mission-grid-cell, .tab-btn');
    if (target) {
        playSound();
    }
});

// Initialize Checkbox on Load
document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('sound-toggle');
    if (toggle) {
        toggle.checked = soundEnabled;
    }
});

// Expose globally
window.toggleSound = toggleSound;
window.playSound = playSound;