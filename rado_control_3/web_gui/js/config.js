// Configuration Constants
const CONFIG = {
    // ROSBridge WebSocket URL
    ROSBRIDGE_URL: `ws://${window.location.hostname}:9090`,
    
    // Video Stream URL (WebVideoServer)
    VIDEO_URL: `http://${window.location.hostname}:8080/stream?topic=/zed/zed_node/rgb/image_rect_color&type=mjpeg&quality=50`,

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