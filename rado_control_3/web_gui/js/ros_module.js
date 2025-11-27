// Initialize ROS connection
const ros = new ROSLIB.Ros({ url : CONFIG.ROSBRIDGE_URL });

ros.on('connection', () => {
    document.getElementById('connection-dot').innerHTML = '<span style="color:lime">●</span> CONNECTED';
    console.log("ROS Connected");
});

ros.on('close', () => {
    document.getElementById('connection-dot').innerHTML = '<span style="color:red">●</span> DISCONNECTED';
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

// --- SUBSCRIBE TO STATE ---
const stateSub = createTopic(CONFIG.TOPICS.STATE, 'std_msgs/String');
stateSub.subscribe((msg) => {
    const el = document.getElementById('state-badge');
    el.className = `status-badge ${msg.data}`;
    el.innerText = msg.data;
});

// --- SUBSCRIBE TO HEALTH ---
const healthSub = createTopic(CONFIG.TOPICS.HEALTH, 'std_msgs/String');
healthSub.subscribe((msg) => {
    // We call a function in main.js to update the UI
    if (window.renderHealth) window.renderHealth(JSON.parse(msg.data));
});