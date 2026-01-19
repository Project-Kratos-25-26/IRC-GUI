let map, roverMarker, pathPolyline;

function initMap() {
    // Default to BITS Goa
    map = L.map('map').setView([15.3911, 73.8782], 18);

    // Satellite Tiles
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri'
    }).addTo(map);

    pathPolyline = L.polyline([], { color: 'red', weight: 3 }).addTo(map);
}

function updateMap(lat, lon) {
    if (!map || (lat === 0 && lon === 0)) return;

    const pos = [lat, lon];
    if (!roverMarker) {
        roverMarker = L.marker(pos).addTo(map);
        map.setView(pos);
    } else {
        roverMarker.setLatLng(pos);
    }
    pathPolyline.addLatLng(pos);
}

// Expose updateRoverMarker globally so ros_module.js can call it
window.updateRoverMarker = function (lat, lon) {
    updateMap(lat, lon);
};

// Initialize map immediately
initMap();