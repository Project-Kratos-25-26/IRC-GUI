#!/usr/bin/env bash
# monitor_mission.sh
# Monitors remote processes on Jetson and writes status to JSON.

JETSON_USER="kratos"
JETSON_IP="192.168.1.10"
PASS="kratos123"
OUTFILE="$(dirname "$0")/../data/mission_status.json"

while true; do
    # Check all processes in one SSH connection for speed
    # We output a string like "rtabmap:1 nav2:0 ..."
    
    # DEBUG: Log the raw check to see if SSH connects
    # echo "Checking status..." >> /tmp/monitor_debug.log

    STATUS_STR=$(sshpass -p "$PASS" ssh -o ConnectTimeout=2 $JETSON_USER@$JETSON_IP "
        pgrep -f kratos_rtabmap >/dev/null && echo -n 'rtabmap:true ' || echo -n 'rtabmap:false '
        pgrep -f static_transform_publisher >/dev/null && echo -n 'tf:true ' || echo -n 'tf:false '
        pgrep -f kratos_nav2 >/dev/null && echo -n 'nav2:true ' || echo -n 'nav2:false '
        pgrep -f velclamp >/dev/null && echo -n 'velclamp:true ' || echo -n 'velclamp:false '
        pgrep -f mavros >/dev/null && echo -n 'mavros:true ' || echo -n 'mavros:false '
        pgrep -f cone_detector_node >/dev/null && echo -n 'cone:true ' || echo -n 'cone:false '
        pgrep -f rado_mission >/dev/null && echo -n 'rado:true ' || echo -n 'rado:false '
    " 2>>/tmp/monitor_ssh_errors.log)
    
    # FALLBACK: If SSH failed (Jetson offline), check LOCAL processes.
    # This handles the case where the user is running the simulation locally on the laptop.
    if [ -z "$STATUS_STR" ]; then
        # echo "SSH failed, checking local processes..." >> /tmp/monitor_debug.log
        pgrep -f kratos_rtabmap >/dev/null && STR_RTAB="rtabmap:true" || STR_RTAB="rtabmap:false"
        pgrep -f static_transform_publisher >/dev/null && STR_TF="tf:true" || STR_TF="tf:false"
        pgrep -f kratos_nav2 >/dev/null && STR_NAV2="nav2:true" || STR_NAV2="nav2:false"
        pgrep -f velclamp >/dev/null && STR_VEL="velclamp:true" || STR_VEL="velclamp:false"
        pgrep -f mavros >/dev/null && STR_MAV="mavros:true" || STR_MAV="mavros:false"
        pgrep -f cone_detector_node >/dev/null && STR_CONE="cone:true" || STR_CONE="cone:false"
        pgrep -f rado_mission >/dev/null && STR_RADO="rado:true" || STR_RADO="rado:false"
        
        STATUS_STR="$STR_RTAB $STR_TF $STR_NAV2 $STR_VEL $STR_MAV $STR_CONE $STR_RADO"
    fi

    # Convert space-separated key:value to JSON
    JSON_OUT="{"
    for pair in $STATUS_STR; do
        KEY=${pair%%:*}
        VAL=${pair##*:}
        JSON_OUT+="\"$KEY\":$VAL,"
    done
    JSON_OUT="${JSON_OUT%,}}" # Remove trailing comma
    JSON_OUT+="}"
    
    echo "$JSON_OUT" > "$OUTFILE"
    
    sleep 2
done
