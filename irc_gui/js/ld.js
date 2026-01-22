import './vendor/chart.umd.min.js'
import './config.js'
import './vendor/roslib.min.js'

const labels = [
    "A, 410 nm", "B, 435 nm", "C, 460 nm", "D, 485 nm",
    "E, 510 nm", "F, 535 nm", "G, 560 nm", "H, 585 nm",
    "R, 610 nm", "S, 645 nm", "I, 680 nm", "J, 705 nm",
    "T, 730 nm", "U, 760 nm", "V, 810 nm", "W, 860 nm",
    "K, 900 nm", "L, 940 nm"
];

let spectralData = new Array(18).fill(0);

// ROS Connection with debugging
const ros = new ROSLIB.Ros({ url: "ws://0.0.0.0:9090" });

ros.on('connection', () => {
    console.log('✅ Connected to rosbridge at', CONFIG.ROSBRIDGE_URL);
});

ros.on('error', (error) => {
    console.error('❌ ROS Error:', error);
});

ros.on('close', () => {
    console.warn('⚠️ Connection to rosbridge closed');
});

// Create chart
const ctx = document.getElementById("spectral").getContext("2d");
const chart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: labels,
        datasets: [{
            label: 'Absorbance',
            data: spectralData,
            borderColor: '#B13BFF',
            backgroundColor: '#471396',
            fill: true,
            tension: 0.4
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                beginAtZero: true
            }
        }
    }
});

// Subscribe to topic (ONLY ONCE!)
const spectral_topic = new ROSLIB.Topic({
    ros: ros,
    name: CONFIG.TOPICS.SPECTRAL,
    messageType: 'std_msgs/msg/Float32MultiArray'
});

const multi_topic = new ROSLIB.Topic({
    ros: ros,
    name: CONFIG.TOPICS.MULTI,
    messageType: 'std_msgs/msg/Float32MultiArray'
});

const dht_topic = new ROSLIB.Topic({
    ros: ros,
    name: CONFIG.TOPICS.DHT,
    messageType: 'std_msgs/msg/Float32MultiArray'
});

const npk_topic = new ROSLIB.Topic({
    ros: ros,
    name: CONFIG.TOPICS.NPK,
    messageType: 'std_msgs/msg/Float32MultiArray'
});

const eco2_topic = new ROSLIB.Topic({
    ros: ros,
    name: CONFIG.TOPICS.ECO2,
    messageType: 'std_msgs/msg/Float32MultiArray'
});

const gps_topic = new ROSLIB.Topic({
    ros: ros,
    name: '/mavros/global_position/global',
    messageType: 'sensor_msgs/NavSatFix'
});



spectral_topic.subscribe((message) => {
    console.log('📊 Data received:', message.data);
    
    if (message.data && message.data.length === 18) {
        chart.data.datasets[0].data = message.data;
        chart.update('none');
    } else {
        console.warn('⚠️ Unexpected data format:', message);
    }
    // console.log(message);
});

gps_topic.subscribe((message) => {
    const gps_lat = document.getElementById("gps-lat-value");
    const gps_long = document.getElementById("gps-long-value");
    const gps_alt = document.getElementById("gps-alt-value");
    if(gps_lat) gps_lat.textContent = message.latitude.toFixed(6);
    if(gps_long) gps_long.textContent = message.longitude.toFixed(6);
    if(gps_alt) gps_alt.textContent = message.altitude.toFixed(6);
    
})

multi_topic.subscribe((message) => {
    const co_value = document.getElementById('co-value');
    const no_value = document.getElementById('no-value');
    const eth_value = document.getElementById('eth-value');
    const voc_value = document.getElementById('voc-value');

    if(co_value) co_value.textContent = message.data[0];
    if(no_value) no_value.textContent = message.data[1];
    if(eth_value) eth_value.textContent = message.data[2];
    if(voc_value) voc_value.textContent = message.data[3];
  
})

npk_topic.subscribe((message) => {
    const n_value = document.getElementById('npk-n-value');
    const p_value = document.getElementById('npk-p-value');
    const k_value = document.getElementById('npk-k-value');

    if(n_value) n_value.textContent = message.data[0];
    if(p_value) p_value.textContent = message.data[1];
    if(k_value) k_value.textContent = message.data[2];
})

dht_topic.subscribe((message) => {
    const hum_value = document.getElementById('dht-hum-value');
    const temp_value = document.getElementById('dht-temp-value');

    if(hum_value) hum_value.textContent = message.data[0];
    if(temp_value) temp_value.textContent = message.data[1];
})


