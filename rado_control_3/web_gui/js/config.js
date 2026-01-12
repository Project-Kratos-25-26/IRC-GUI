// Configuration Constants
const CONFIG = {
    // ROSBridge WebSocket URL
    ROSBRIDGE_URL: `ws://${window.location.hostname}:9090`,

    // Camera Sources Map (6 USB cameras via GStreamer)
    CAMERA_SOURCES: {
        "Camera 1": { type: "receiver", id: "Camera 1" },
        "Camera 2": { type: "receiver", id: "Camera 2" },
        "Camera 3": { type: "receiver", id: "Camera 3" },
        "Camera 4": { type: "receiver", id: "Camera 4" },
        "Camera 5": { type: "receiver", id: "Camera 5" },
        "Camera 6": { type: "receiver", id: "Camera 6" }
    },

    // Topic Names
    TOPICS: {
        GPS: '/mavros/global_position/global',
        STATE: '/rover_state',
        HEALTH: '/gui/system_health',
        CMD: '/gcs/command',
        SYS: '/sys/command',
        ARM: '/arm/joint_commands',
        LOG: '/gui/log_request'
    }
};