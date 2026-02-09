/**
 * Grid Map Module - Canvas-based dynamic grid visualization
 * Displays robot position, goals, and waypoints using odometry coordinates
 */

const GridMap = (function () {
    let canvas, ctx;
    let transform = { x: 0, y: 0, scale: 20 }; // 20 pixels per meter
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let followRobot = true;

    // Data storage
    let robotPos = { x: 0, y: 0 };
    let goals = []; // { type, color, lat, lon }
    let waypoints = []; // { name, lat, lon }

    // Tooltip state
    let tooltip = null;
    let hoveredItem = null;

    // Colors for markers
    const colorMap = {
        red: '#e74c3c',
        green: '#2ecc71',
        blue: '#3498db',
        yellow: '#f1c40f',
        orange: '#f39c12'
    };

    function init(canvasId) {
        canvas = document.getElementById(canvasId);
        if (!canvas) {
            console.error('Grid map canvas not found:', canvasId);
            return;
        }
        ctx = canvas.getContext('2d');

        // Create tooltip element
        tooltip = document.createElement('div');
        tooltip.className = 'grid-tooltip';
        tooltip.style.display = 'none';
        canvas.parentElement.appendChild(tooltip);

        // Resize canvas to fit container
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        // Mouse events for pan/zoom
        canvas.addEventListener('wheel', onWheel);
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('mouseleave', onMouseLeave);

        // Start render loop
        requestAnimationFrame(render);

        // Start data refresh loop
        setInterval(refreshData, 2000);
        refreshData(); // Initial load

        console.log('[GridMap] Initialized');
    }

    function resizeCanvas() {
        if (!canvas) return;
        const rect = canvas.parentElement.getBoundingClientRect();
        canvas.width = rect.width - 20; // Account for padding
        canvas.height = rect.height - 60; // Account for controls
        render();
    }

    function render() {
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Update robot position from global odometry
        if (window.currentPosition) {
            robotPos.x = window.currentPosition.x;
            robotPos.y = window.currentPosition.y;
        }

        // Center on robot if following
        if (followRobot) {
            transform.x = canvas.width / 2 - robotPos.x * transform.scale;
            transform.y = canvas.height / 2 + robotPos.y * transform.scale; // Y inverted
        }

        // Draw grid
        drawGrid();

        // Draw waypoints (diamonds)
        waypoints.forEach((wp, idx) => {
            const screenPos = worldToScreen(wp.lat, wp.lon);
            drawDiamond(screenPos.x, screenPos.y, 10, '#9b59b6');
        });

        // Draw goals (triangles for pickup, squares for dropoff)
        goals.forEach((goal, idx) => {
            const screenPos = worldToScreen(goal.lat, goal.lon);
            const color = colorMap[goal.color] || '#888';
            if (goal.type === 'pickup') {
                drawTriangle(screenPos.x, screenPos.y, 12, color);
            } else {
                drawSquare(screenPos.x, screenPos.y, 10, color);
            }
        });

        // Draw robot (blue circle with heading indicator)
        const robotScreen = worldToScreen(robotPos.x, robotPos.y);
        ctx.beginPath();
        ctx.arc(robotScreen.x, robotScreen.y, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#00bcd4';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Robot direction indicator
        ctx.beginPath();
        ctx.moveTo(robotScreen.x, robotScreen.y);
        ctx.lineTo(robotScreen.x + 15, robotScreen.y);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Draw scale indicator
        drawScaleBar();

        requestAnimationFrame(render);
    }

    function drawGrid() {
        const gridSpacing = 1; // 1 meter
        const screenSpacing = gridSpacing * transform.scale;

        // Don't draw if too zoomed out
        if (screenSpacing < 10) return;

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;

        // Calculate visible range
        const startX = Math.floor(-transform.x / screenSpacing) * screenSpacing;
        const startY = Math.floor(-transform.y / screenSpacing) * screenSpacing;

        // Vertical lines
        for (let x = startX; x < canvas.width - transform.x; x += screenSpacing) {
            const screenX = x + transform.x;
            if (screenX >= 0 && screenX <= canvas.width) {
                ctx.beginPath();
                ctx.moveTo(screenX, 0);
                ctx.lineTo(screenX, canvas.height);
                ctx.stroke();
            }
        }

        // Horizontal lines
        for (let y = startY; y < canvas.height - transform.y; y += screenSpacing) {
            const screenY = y + transform.y;
            if (screenY >= 0 && screenY <= canvas.height) {
                ctx.beginPath();
                ctx.moveTo(0, screenY);
                ctx.lineTo(canvas.width, screenY);
                ctx.stroke();
            }
        }

        // Draw origin axes
        const origin = worldToScreen(0, 0);
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2;

        // X axis
        ctx.beginPath();
        ctx.moveTo(0, origin.y);
        ctx.lineTo(canvas.width, origin.y);
        ctx.stroke();

        // Y axis
        ctx.beginPath();
        ctx.moveTo(origin.x, 0);
        ctx.lineTo(origin.x, canvas.height);
        ctx.stroke();
    }

    function drawTriangle(x, y, size, color) {
        ctx.beginPath();
        ctx.moveTo(x, y - size);
        ctx.lineTo(x - size * 0.866, y + size * 0.5);
        ctx.lineTo(x + size * 0.866, y + size * 0.5);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    function drawSquare(x, y, size, color) {
        ctx.fillStyle = color;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    }

    function drawDiamond(x, y, size, color) {
        ctx.beginPath();
        ctx.moveTo(x, y - size);
        ctx.lineTo(x + size, y);
        ctx.lineTo(x, y + size);
        ctx.lineTo(x - size, y);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    function drawScaleBar() {
        const barLength = 50;
        const meters = barLength / transform.scale;
        const label = meters >= 1 ? `${meters.toFixed(1)}m` : `${(meters * 100).toFixed(0)}cm`;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(10, canvas.height - 30, barLength + 20, 22);

        ctx.fillStyle = '#fff';
        ctx.fillRect(15, canvas.height - 20, barLength, 4);

        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#fff';
        ctx.fillText(label, 20 + barLength / 2 - ctx.measureText(label).width / 2, canvas.height - 12);
    }

    function worldToScreen(worldX, worldY) {
        return {
            x: worldX * transform.scale + transform.x,
            y: -worldY * transform.scale + transform.y // Y inverted for screen coords
        };
    }

    function screenToWorld(screenX, screenY) {
        return {
            x: (screenX - transform.x) / transform.scale,
            y: -(screenY - transform.y) / transform.scale
        };
    }

    function onWheel(e) {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
        const mouseX = e.offsetX;
        const mouseY = e.offsetY;

        // Zoom toward mouse position
        const worldPos = screenToWorld(mouseX, mouseY);
        transform.scale *= zoomFactor;
        transform.scale = Math.max(5, Math.min(200, transform.scale));

        // Adjust offset to zoom toward cursor
        if (!followRobot) {
            transform.x = mouseX - worldPos.x * transform.scale;
            transform.y = mouseY + worldPos.y * transform.scale;
        }
    }

    function onMouseDown(e) {
        if (e.button === 0) {
            isDragging = true;
            dragStart = { x: e.offsetX - transform.x, y: e.offsetY - transform.y };
            followRobot = false;
            updateFollowButton();
        }
    }

    function onMouseMove(e) {
        if (isDragging) {
            transform.x = e.offsetX - dragStart.x;
            transform.y = e.offsetY - dragStart.y;
        }

        // Check hover
        checkHover(e.offsetX, e.offsetY);
    }

    function onMouseUp() {
        isDragging = false;
    }

    function onMouseLeave() {
        isDragging = false;
        hideTooltip();
    }

    function checkHover(mouseX, mouseY) {
        const hitRadius = 15;
        hoveredItem = null;

        // Check robot
        const robotScreen = worldToScreen(robotPos.x, robotPos.y);
        if (distance(mouseX, mouseY, robotScreen.x, robotScreen.y) < hitRadius) {
            hoveredItem = {
                type: 'robot',
                label: `Robot Position`,
                detail: `X: ${robotPos.x.toFixed(3)}, Y: ${robotPos.y.toFixed(3)}`
            };
        }

        // Check goals
        goals.forEach(goal => {
            const screenPos = worldToScreen(goal.lat, goal.lon);
            if (distance(mouseX, mouseY, screenPos.x, screenPos.y) < hitRadius) {
                hoveredItem = {
                    type: goal.type,
                    label: `${goal.type.toUpperCase()} - ${goal.color.toUpperCase()}`,
                    detail: `X: ${goal.lat.toFixed(3)}, Y: ${goal.lon.toFixed(3)}`
                };
            }
        });

        // Check waypoints
        waypoints.forEach(wp => {
            const screenPos = worldToScreen(wp.lat, wp.lon);
            if (distance(mouseX, mouseY, screenPos.x, screenPos.y) < hitRadius) {
                hoveredItem = {
                    type: 'waypoint',
                    label: `Waypoint: ${wp.name}`,
                    detail: `X: ${wp.lat.toFixed(3)}, Y: ${wp.lon.toFixed(3)}`
                };
            }
        });

        if (hoveredItem) {
            showTooltip(mouseX, mouseY, hoveredItem);
        } else {
            hideTooltip();
        }
    }

    function distance(x1, y1, x2, y2) {
        return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }

    function showTooltip(x, y, item) {
        if (!tooltip) return;
        tooltip.innerHTML = `<strong>${item.label}</strong><br><span style="color:#aaa">${item.detail}</span>`;
        tooltip.style.display = 'block';
        tooltip.style.left = (x + 15) + 'px';
        tooltip.style.top = (y - 10) + 'px';
    }

    function hideTooltip() {
        if (tooltip) tooltip.style.display = 'none';
    }

    function refreshData() {
        // Fetch mission plan (goals)
        fetch('/api/mission_plan?t=' + Date.now())
            .then(r => r.json())
            .then(data => {
                goals = [];
                const types = ['pickup', 'dropoff'];
                const colors = ['red', 'green', 'blue', 'yellow', 'orange'];

                types.forEach(type => {
                    colors.forEach(color => {
                        const coords = data[type]?.[color] || [];
                        coords.forEach(coord => {
                            goals.push({
                                type,
                                color,
                                lat: coord.lat,
                                lon: coord.lon
                            });
                        });
                    });
                });
            })
            .catch(e => console.warn('[GridMap] Failed to fetch mission plan:', e));

        // Fetch waypoints
        fetch('/api/waypoints?t=' + Date.now())
            .then(r => r.json())
            .then(data => {
                waypoints = data.map(wp => ({
                    name: wp.name,
                    lat: parseFloat(wp.lat),
                    lon: parseFloat(wp.lon)
                }));
            })
            .catch(e => console.warn('[GridMap] Failed to fetch waypoints:', e));
    }

    function zoomIn() {
        transform.scale *= 1.3;
        transform.scale = Math.min(200, transform.scale);
    }

    function zoomOut() {
        transform.scale *= 0.7;
        transform.scale = Math.max(5, transform.scale);
    }

    function resetView() {
        transform = { x: canvas.width / 2, y: canvas.height / 2, scale: 20 };
        followRobot = true;
        updateFollowButton();
    }

    function toggleFollow() {
        followRobot = !followRobot;
        updateFollowButton();
    }

    function updateFollowButton() {
        const btn = document.getElementById('grid-follow-btn');
        if (btn) {
            btn.classList.toggle('active', followRobot);
            btn.title = followRobot ? 'Following Robot' : 'Click to Follow Robot';
        }
    }

    // Force refresh (called externally when mission plan changes)
    function forceRefresh() {
        refreshData();
    }

    return {
        init,
        zoomIn,
        zoomOut,
        resetView,
        toggleFollow,
        forceRefresh
    };
})();

// Expose globally
window.GridMap = GridMap;
