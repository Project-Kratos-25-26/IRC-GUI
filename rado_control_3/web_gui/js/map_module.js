let map, roverMarker, pathPolyline;

function initMap() {
    // Default to BITS Goa
    map = L.map('map').setView([15.3911, 73.8782], 18);
    
    // Satellite Tiles
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri'
    }).addTo(map);
    
    pathPolyline = L.polyline([], {color: 'red', weight: 3}).addTo(map);
}

function updateMap(lat, lon) {
    if(!map || (lat===0 && lon===0)) return;
    
    const pos = [lat, lon];
    if(!roverMarker) {
        roverMarker = L.marker(pos).addTo(map);
        map.setView(pos);
    } else { 
        roverMarker.setLatLng(pos); 
    }
    pathPolyline.addLatLng(pos);
}

// Initialize map immediately
initMap();

// Subscribe to GPS here since it relates to mapping
const gpsSub = new ROSLIB.Topic({
    ros: ros, // 'ros' comes from ros_module.js
    name: CONFIG.TOPICS.GPS,
    messageType: 'sensor_msgs/NavSatFix'
});

gpsSub.subscribe((msg) => {
    // Update Text UI
    if(document.getElementById('recon-lat')) {
        document.getElementById('recon-lat').innerText = msg.latitude.toFixed(6);
        document.getElementById('recon-lon').innerText = msg.longitude.toFixed(6);
    }
    // Update Map
    updateMap(msg.latitude, msg.longitude);
});