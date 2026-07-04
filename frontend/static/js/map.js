/**
 * CERES GNC Map Manager
 * Multi-vessel fleet rendering, polygon draw mode (unlimited vertices),
 * AI path preview, satellite/street toggle, and click-to-waypoint routing.
 */

'use strict';

let map;
let baseLayers = {};
let currentLayerName = 'Street';

// Fleet markers (keyed by vessel_id)
let vesselMarkers = {};
let vesselPaths   = {};   // polylines per vessel
// Shared activeVesselId state is declared globally in main.js

// Shared layers
let boundaryPolygon    = null;
let quadrantGridGroup  = null;
let manualWaypointMarker = null;
let aiPathPreview      = null; // L.polyline preview when path modal opens
let segmentsGroup      = null; // Dynamic segments group

// Draw Mode state
let drawMode        = false;
let drawnPoints     = [];   // [{lat, lng}, ...]
let drawPolygon     = null; // live preview polygon
let drawMarkers     = [];   // vertex dot markers

// Charging Station state
let stationMarker = null;
let placeStationMode = false;

const DEFAULT_POND_BOUNDARY = [
    [14.2192, 121.2415],
    [14.2195, 121.2425],
    [14.2185, 121.2430],
    [14.2178, 121.2420],
    [14.2182, 121.2412]
];

// Current active boundary
let currentBoundary = JSON.parse(JSON.stringify(DEFAULT_POND_BOUNDARY));

const initialLatLng = [14.2185, 121.2420];

// Color palette for fleet vessels
const VESSEL_COLORS = {
    'CRSMD0001': '#10b981',
    'CRSMD001': '#10b981',
    'CRSMD0002': '#38bdf8',
    'CRSMD002': '#38bdf8',
    'CRSMD0003': '#f59e0b',
    'CRSMD003': '#f59e0b',
    'CRSMD0004': '#a78bfa',
    'CRSMD004': '#a78bfa',
};
const DEFAULT_COLOR = '#94a3b8';

let mapMode = 'navigation';

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initMap();
    });
} else {
    initMap();
}

// ─── MAP INIT ────────────────────────────────────────────────────────────
function initMap() {
    const container = document.getElementById('leaflet-map');
    if (!container) return;
    mapMode = container.getAttribute('data-mode') || 'navigation';

    map = L.map('leaflet-map', {
        zoomControl: false,
        attributionControl: false,
        minZoom: 2,
        maxBounds: [
            [-90, -180],
            [90, 180]
        ],
        maxBoundsViscosity: 1.0
    }).setView(initialLatLng, 17);

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    // Base tile layers
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 });
    const satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 });
    baseLayers = { 'Street': osmLayer, 'Satellite': satLayer };
    
    if (mapMode === 'heatmap') {
        satLayer.addTo(map);
        currentLayerName = 'Satellite';
    } else {
        osmLayer.addTo(map);
        currentLayerName = 'Street';
    }

    // Export map
    window.map = map;

    // Pond boundary polygon
    drawBoundaryPolygon(currentBoundary);

    // Segments overlay only for navigation mode
    if (mapMode !== 'heatmap') {
        segmentsGroup = L.layerGroup().addTo(map);
        drawSegmentsOverlay(currentBoundary);
    } else {
        // Setup heatmap parameter select listener
        const paramSelect = document.getElementById('heatmapParamSelect');
        if (paramSelect) {
            paramSelect.addEventListener('change', () => {
                window.updateHeatmap('consolidated', paramSelect.value);
            });
        }
        // Setup zoomend listener for resolution adjustment
        map.on('zoomend', () => {
            const paramSelect = document.getElementById('heatmapParamSelect');
            const param = paramSelect ? paramSelect.value : 'hs_nh3';
            window.updateHeatmap('consolidated', param);
        });
        // Setup heatmap opacity slider listener
        const opacitySlider = document.getElementById('heatmapOpacitySlider');
        const opacityValSpan = document.getElementById('heatmapOpacityVal');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', (e) => {
                const opacity = parseFloat(e.target.value);
                if (opacityValSpan) {
                    opacityValSpan.textContent = Math.round(opacity * 100) + '%';
                }
                window.updateHeatmapOpacity(opacity);
            });
        }
    }

    heatmapHoverTooltip = L.tooltip({ sticky: true, opacity: 0.9, className: 'heatmap-tooltip' });
    map.on('mousemove', (e) => {
        if (mapMode === 'heatmap' && lastHeatmapPoints.length > 0) {
            const paramSelect = document.getElementById('heatmapParamSelect');
            const param = paramSelect ? paramSelect.value : 'hs_nh3';
            let totalWeight = 0;
            let totalValue = 0;
            const thresholdDeg = 0.005; // ~500m search radius
            let minDist = Infinity;
            let closestVal = null;
            
            for (let pt of lastHeatmapPoints) {
                if (pt[param] == null) continue;
                const dLat = pt.lat - e.latlng.lat;
                const dLon = pt.lon - e.latlng.lng;
                const dist2 = dLat*dLat + dLon*dLon;
                if (dist2 < minDist) {
                    minDist = dist2;
                    closestVal = pt[param];
                }
                if (dist2 < thresholdDeg*thresholdDeg) {
                    const weight = 1.0 / (dist2 + 1e-10);
                    totalWeight += weight;
                    totalValue += pt[param] * weight;
                }
            }
            
            if (minDist > (0.002*0.002)) {
                map.closeTooltip(heatmapHoverTooltip);
            } else {
                let displayVal = (totalWeight > 0 ? (totalValue / totalWeight) : closestVal).toFixed(2);
                let unit = param === 'hs_nh3' ? 'ppm' : param === 'temp' ? '°C' : param === 'ph' ? 'pH' : 'mg/L';
                heatmapHoverTooltip.setContent(`<div style="font-weight:600;font-size:0.9rem;color:#111;">${displayVal} <span style="font-size:0.75rem;color:#555;">${unit}</span></div>`);
                if (!map.hasLayer(heatmapHoverTooltip)) {
                    heatmapHoverTooltip.setLatLng(e.latlng).addTo(map);
                } else {
                    heatmapHoverTooltip.setLatLng(e.latlng);
                }
            }
        } else {
            map.closeTooltip(heatmapHoverTooltip);
        }
    });

    // Map click handler (waypoint or draw vertex)
    map.on('click', onMapClick);

    // Toolbar button wiring
    setupMapButtons();
}

// ─── BOUNDARY DRAWING ────────────────────────────────────────────────────
function drawBoundaryPolygon(coords) {
    if (boundaryPolygon) map.removeLayer(boundaryPolygon);
    if (mapMode === 'heatmap') return;
    boundaryPolygon = L.polygon(coords, {
        color: '#10b981',
        fillColor: '#10b981',
        fillOpacity: 0.07,
        weight: 2,
        dashArray: '5, 5'
    }).addTo(map);
}

function drawSegmentsOverlay(coords) {
    if (!segmentsGroup) return;
    segmentsGroup.clearLayers();

    // Generate segments from the current boundary
    const segmentation = window.CeresSegmentation.generateSegments(coords);
    if (!segmentation || !segmentation.segments) return;

    segmentation.segments.forEach(seg => {
        // Draw the segment polygon
        const poly = L.polygon(seg.polygon, {
            color: '#38bdf8',
            weight: 2,
            fillColor: 'transparent',
            dashArray: '4, 4'
        }).addTo(segmentsGroup);

        // Bind a tooltip to the polygon
        poly.bindTooltip(`Segment ${seg.segment_id}<br>Area: ${seg.area_m2} m²`, {
            permanent: false,
            direction: 'center'
        });

        // Draw centroid marker
        const icon = L.divIcon({
            className: '',
            html: `<div style="width:12px;height:12px;background:#38bdf8;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.4);"></div>`,
            iconSize: [12, 12], iconAnchor: [6, 6]
        });
        L.marker([seg.centroid.lat, seg.centroid.lng], { icon: icon }).addTo(segmentsGroup)
         .bindTooltip(`Waypoint ${seg.segment_id}`);
    });
}

// ─── FLEET VESSEL MARKERS ────────────────────────────────────────────────
function getVesselIcon(vesselId, heading, isActive, isOnline) {
    const color = isOnline ? '#10b981' : '#64748b';
    const size  = isActive ? 36 : 28;
    const stroke = isActive ? 'white' : 'rgba(255,255,255,0.5)';
    const opacity = isActive ? 1.0 : 0.75;
    const pulseAnim = (isOnline && isActive) ? 'animation: pulse-green 2s infinite;' : '';
    return L.divIcon({
        className: 'custom-vessel-icon',
        html: `
          <div id="vessel-arrow-${vesselId}"
               style="transform:rotate(${heading}deg);transition:transform 0.4s ease;opacity:${opacity};${pulseAnim}">
            <svg width="${size}" height="${size}" viewBox="0 0 100 100" style="filter: drop-shadow(0 0 4px ${color});">
              <polygon points="50,8 92,82 50,66 8,82"
                fill="${color}" stroke="${stroke}" stroke-width="8"/>
            </svg>
          </div>`,
        iconSize:   [size, size],
        iconAnchor: [size/2, size/2]
    });
}

function getChargingStationIcon(vesselId, heading, isActive, isOnline) {
    const color = isOnline ? '#10b981' : '#64748b';
    const size  = isActive ? 38 : 30;
    const opacity = isActive ? 1.0 : 0.75;
    const pulseAnim = (isOnline && isActive) ? 'animation: pulse-green 2s infinite;' : '';
    return L.divIcon({
        className: 'custom-station-icon',
        html: `
          <div id="station-compass-${vesselId}"
               style="opacity:${opacity};width:${size}px;height:${size}px;${pulseAnim}">
            <svg width="${size}" height="${size}" viewBox="0 0 100 100" style="filter: drop-shadow(0 0 4px ${color});">
              <polygon points="50,5 93,30 93,80 50,95 7,80 7,30" fill="var(--bg-card)" stroke="${color}" stroke-width="8"/>
              <foreignObject x="20" y="20" width="60" height="60">
                <div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%; transform: rotate(${heading}deg); transition: transform 0.4s ease;">
                  <i class="fa-solid fa-charging-station" style="color: ${color}; font-size: ${size * 0.45}px;"></i>
                </div>
              </foreignObject>
            </svg>
          </div>`,
        iconSize:   [size, size],
        iconAnchor: [size/2, size/2]
    });
}

function ensureVesselMarker(vesselId, lat, lon, heading, isActive, device_type, isOnline) {
    const isStation = (device_type === 'charging_station');
    const icon = isStation ? getChargingStationIcon(vesselId, heading, isActive, isOnline) : getVesselIcon(vesselId, heading, isActive, isOnline);
    if (!vesselMarkers[vesselId]) {
        const marker = L.marker([lat, lon], { icon, zIndexOffset: isActive ? 1000 : 0 }).addTo(map);
        marker.bindPopup(`<b>${vesselId} (${isStation ? 'Station' : 'Vessel'})</b>`);
        vesselMarkers[vesselId] = marker;
    } else {
        vesselMarkers[vesselId].setLatLng([lat, lon]);
        vesselMarkers[vesselId].setIcon(icon);
        vesselMarkers[vesselId].setZIndexOffset(isActive ? 1000 : 0);
    }

    if (isStation) {
        if (vesselPaths[vesselId]) {
            map.removeLayer(vesselPaths[vesselId]);
            delete vesselPaths[vesselId];
        }
    } else {
        // Ensure path polyline exists
        if (!vesselPaths[vesselId]) {
            vesselPaths[vesselId] = L.polyline([], {
                color: VESSEL_COLORS[vesselId] || DEFAULT_COLOR,
                weight: isActive ? 3 : 2,
                opacity: isActive ? 0.85 : 0.4,
                dashArray: '4, 6'
            });
            if (mapMode !== 'heatmap') {
                vesselPaths[vesselId].addTo(map);
            }
        }
    }
}

// Called from main.js when fleet telemetry arrives
window.updateFleetMarkers = function(fleetData, activeVid) {
    if (!map) return;
    activeVesselId = activeVid;

    // Dynamically update map boundary from active vessel telemetry if different and not in draw mode
    if (!drawMode) {
        const activeVessel = fleetData[activeVid];
        if (activeVessel && activeVessel.boundary) {
            const telemetryBoundary = activeVessel.boundary;
            const boundaryStr = JSON.stringify(currentBoundary);
            const telemetryBoundaryStr = JSON.stringify(telemetryBoundary);
            if (boundaryStr !== telemetryBoundaryStr) {
                currentBoundary = telemetryBoundary;
                drawBoundaryPolygon(currentBoundary);
                drawSegmentsOverlay(currentBoundary);
            }
        }
    }

    // Toggle visibility of the Delete Area button
    const isCustom = JSON.stringify(currentBoundary) !== JSON.stringify(DEFAULT_POND_BOUNDARY);
    const deleteBtn = document.getElementById('btnDeleteArea');
    if (deleteBtn) {
        deleteBtn.style.display = isCustom ? 'inline-block' : 'none';
    }

    // Update target waypoint crosshair dynamically for the active vessel
    const activeVessel = fleetData[activeVid];
    if (activeVessel && activeVessel.target_lat != null && activeVessel.target_lon != null) {
        const targetLatLng = L.latLng(activeVessel.target_lat, activeVessel.target_lon);
        if (!manualWaypointMarker) {
            const icon = L.divIcon({
                className: 'target-crosshair',
                html: `<svg width="24" height="24" viewBox="0 0 24 24">
                         <circle cx="12" cy="12" r="8" fill="none" stroke="#f59e0b" stroke-width="2"/>
                         <line x1="12" y1="2" x2="12" y2="22" stroke="#f59e0b" stroke-width="2"/>
                         <line x1="2" y1="12" x2="22" y2="12" stroke="#f59e0b" stroke-width="2"/>
                       </svg>`,
                iconSize: [24, 24], iconAnchor: [12, 12]
            });
            manualWaypointMarker = L.marker(targetLatLng, { icon });
            if (mapMode !== 'heatmap') {
                manualWaypointMarker.addTo(map);
            }
            manualWaypointMarker.bindPopup(`<b>Target Waypoint</b><br>${targetLatLng.lat.toFixed(5)}, ${targetLatLng.lng.toFixed(5)}`);
        } else {
            manualWaypointMarker.setLatLng(targetLatLng);
            manualWaypointMarker.setPopupContent(`<b>Target Waypoint</b><br>${targetLatLng.lat.toFixed(5)}, ${targetLatLng.lng.toFixed(5)}`);
        }
    } else {
        if (manualWaypointMarker) {
            map.removeLayer(manualWaypointMarker);
            manualWaypointMarker = null;
        }
    }

    // Update charging station marker dynamically for the active vessel
    if (activeVessel && activeVessel.station_lat != null && activeVessel.station_lon != null) {
        const stationLatLng = L.latLng(activeVessel.station_lat, activeVessel.station_lon);
        if (!stationMarker) {
            const icon = L.divIcon({
                className: 'station-marker-icon',
                html: `
                  <div style="background: var(--bg-card); border: 2px solid var(--color-optimal); border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px rgba(16, 185, 129, 0.4); animation: pulse-green 2s infinite;">
                    <i class="fa-solid fa-charging-station" style="color: var(--color-optimal); font-size: 0.9rem;"></i>
                  </div>`,
                iconSize: [30, 30], iconAnchor: [15, 15]
            });
            stationMarker = L.marker(stationLatLng, { icon }).addTo(map);
            stationMarker.bindPopup(`<b>Charging Station</b><br>${stationLatLng.lat.toFixed(5)}, ${stationLatLng.lng.toFixed(5)}`);
        } else {
            stationMarker.setLatLng(stationLatLng);
            stationMarker.setPopupContent(`<b>Charging Station</b><br>${stationLatLng.lat.toFixed(5)}, ${stationLatLng.lng.toFixed(5)}`);
        }
    } else {
        if (stationMarker) {
            map.removeLayer(stationMarker);
            stationMarker = null;
        }
    }

    for (const [vid, vessel] of Object.entries(fleetData)) {
        const isActive = (vid === activeVid);
        ensureVesselMarker(vid, vessel.lat, vessel.lon, vessel.heading, isActive, vessel.device_type, vessel.online);

        // Update path polyline
        if (vesselPaths[vid]) {
            const pathCoords = (vessel.path || []).map(p => [p[0], p[1]]);
            vesselPaths[vid].setLatLngs(pathCoords);
            vesselPaths[vid].setStyle({
                weight: isActive ? 3 : 2,
                opacity: isActive ? 0.85 : 0.4
            });
            if (mapMode !== 'heatmap' && isActive) {
                if (!map.hasLayer(vesselPaths[vid])) {
                    vesselPaths[vid].addTo(map);
                }
            } else {
                if (map.hasLayer(vesselPaths[vid])) {
                    map.removeLayer(vesselPaths[vid]);
                }
            }
        }

        // Pan map to follow active vessel if moving
        if (isActive && vessel.mode !== 'standby') {
            map.panTo([vessel.lat, vessel.lon]);
        }
    }

    // Remove markers for vessels no longer in fleet
    for (const vid of Object.keys(vesselMarkers)) {
        if (!fleetData[vid]) {
            map.removeLayer(vesselMarkers[vid]);
            delete vesselMarkers[vid];
            if (vesselPaths[vid]) {
                map.removeLayer(vesselPaths[vid]);
                delete vesselPaths[vid];
            }
        }
    }

    // Update heatmap if in heatmap mode
    if (mapMode === 'heatmap') {
        const paramSelect = document.getElementById('heatmapParamSelect');
        const param = paramSelect ? paramSelect.value : 'hs_nh3';
        window.updateHeatmap('consolidated', param);
    }
};

// Legacy single-vessel update (fallback for main.js compatibility)
window.updateVesselMarker = function(data) {
    if (!data) return;
    ensureVesselMarker(activeVesselId, data.lat, data.lon, data.heading, true, data.device_type, data.online);
    if (vesselPaths[activeVesselId] && data.path) {
        vesselPaths[activeVesselId].setLatLngs((data.path || []).map(p => [p[0], p[1]]));
    }
};

// ─── MAP CLICK HANDLER ───────────────────────────────────────────────────
function onMapClick(e) {
    if (mapMode === 'heatmap') {
        return; // Disable clicking/waypoint placing on dashboard heatmap
    }
    if (placeStationMode) {
        const clickedPt = [e.latlng.lat, e.latlng.lng];
        // Snap to closest boundary point on currentBoundary
        const snappedPt = getClosestPointOnPolygon(clickedPt, currentBoundary);
        
        // Send to backend
        if (window.sendCommand) {
            window.sendCommand('set_charging_station', { lat: snappedPt[0], lon: snappedPt[1] });
        }
        
        // Turn off mode
        togglePlaceStationMode();
    } else if (drawMode) {
        addDrawVertex(e.latlng);
    } else {
        const pt = [e.latlng.lat, e.latlng.lng];
        if (isPointInPolygon(pt, currentBoundary)) {
            setManualWaypoint(e.latlng);
        }
    }
}

// ─── WAYPOINT ROUTING ────────────────────────────────────────────────────
function setManualWaypoint(latlng) {
    if (manualWaypointMarker) map.removeLayer(manualWaypointMarker);
    const icon = L.divIcon({
        className: 'target-crosshair',
        html: `<svg width="24" height="24" viewBox="0 0 24 24">
                 <circle cx="12" cy="12" r="8" fill="none" stroke="#f59e0b" stroke-width="2"/>
                 <line x1="12" y1="2" x2="12" y2="22" stroke="#f59e0b" stroke-width="2"/>
                 <line x1="2" y1="12" x2="22" y2="12" stroke="#f59e0b" stroke-width="2"/>
               </svg>`,
        iconSize: [24, 24], iconAnchor: [12, 12]
    });
    manualWaypointMarker = L.marker(latlng, { icon }).addTo(map);
    manualWaypointMarker.bindPopup(`<b>Target Waypoint</b><br>${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`).openPopup();
    if (window.sendCommand) {
        window.sendCommand('override_waypoint', { lat: latlng.lat, lon: latlng.lng });
    }
}

function clearManualWaypoints() {
    if (manualWaypointMarker) { map.removeLayer(manualWaypointMarker); manualWaypointMarker = null; }
    for (const pl of Object.values(vesselPaths)) pl.setLatLngs([]);
    if (window.sendCommand) window.sendCommand('clear_mission');
}

// ─── DRAW MODE ───────────────────────────────────────────────────────────
function toggleDrawMode() {
    drawMode = !drawMode;
    const btn = document.getElementById('btnDrawMode');

    if (drawMode) {
        // Enter draw mode
        map.getContainer().style.cursor = 'crosshair';
        if (btn) { btn.textContent = '✏ Drawing...'; btn.style.background = '#f59e0b'; btn.style.color = '#fff'; }
        showDrawControls(true);
    } else {
        // Exit draw mode without finishing
        map.getContainer().style.cursor = '';
        if (btn) { btn.textContent = '✏ Draw Area'; btn.style.background = ''; btn.style.color = ''; }
        showDrawControls(false);
    }
}

function addDrawVertex(latlng) {
    drawnPoints.push(latlng);

    // Vertex dot marker
    const dotIcon = L.divIcon({
        className: '',
        html: `<div style="width:10px;height:10px;background:#f59e0b;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.4);"></div>`,
        iconSize: [10, 10], iconAnchor: [5, 5]
    });
    const m = L.marker(latlng, { icon: dotIcon }).addTo(map);
    drawMarkers.push(m);

    // Update live polygon preview
    if (drawPolygon) map.removeLayer(drawPolygon);
    if (drawnPoints.length >= 2) {
        drawPolygon = L.polygon(drawnPoints, {
            color: '#f59e0b',
            fillColor: '#f59e0b',
            fillOpacity: 0.1,
            weight: 2,
            dashArray: '4, 4'
        }).addTo(map);
    }

    updateDrawVertexCount();
}

function undoLastVertex() {
    if (!drawnPoints.length) return;
    drawnPoints.pop();
    const m = drawMarkers.pop();
    if (m) map.removeLayer(m);
    if (drawPolygon) map.removeLayer(drawPolygon);
    if (drawnPoints.length >= 2) {
        drawPolygon = L.polygon(drawnPoints, {
            color: '#f59e0b',
            fillColor: '#f59e0b',
            fillOpacity: 0.1,
            weight: 2,
            dashArray: '4, 4'
        }).addTo(map);
    } else {
        drawPolygon = null;
    }
    updateDrawVertexCount();
}

function finishDrawing() {
    if (drawnPoints.length < 3) {
        alert('Please place at least 3 boundary points.');
        return;
    }

    // Commit new boundary
    currentBoundary = drawnPoints.map(p => [p.lat, p.lng]);

    // Clean up draw markers
    drawMarkers.forEach(m => map.removeLayer(m));
    drawMarkers = [];
    if (drawPolygon) { map.removeLayer(drawPolygon); drawPolygon = null; }
    drawnPoints = [];

    // Redraw committed boundary and segments
    drawBoundaryPolygon(currentBoundary);
    drawSegmentsOverlay(currentBoundary);

    // Send to backend with segments
    if (window.sendCommand) {
        const segmentation = window.CeresSegmentation.generateSegments(currentBoundary);
        window.sendCommand('update_boundary', { 
            boundary: currentBoundary,
            segments: segmentation.segments,
            total_area_m2: segmentation.area_m2
        });
    }

    // Exit draw mode
    drawMode = false;
    map.getContainer().style.cursor = '';
    const btn = document.getElementById('btnDrawMode');
    if (btn) { btn.textContent = '✏ Draw Area'; btn.style.background = ''; btn.style.color = ''; }
    showDrawControls(false);
}

function clearDrawing() {
    drawnPoints = [];
    drawMarkers.forEach(m => map.removeLayer(m));
    drawMarkers = [];
    if (drawPolygon) { map.removeLayer(drawPolygon); drawPolygon = null; }
    updateDrawVertexCount();
}

function updateDrawVertexCount() {
    const el = document.getElementById('drawVertexCount');
    if (el) el.textContent = `${drawnPoints.length} pts`;
}

function showDrawControls(show) {
    const el = document.getElementById('drawControls');
    if (el) el.style.display = show ? 'flex' : 'none';
    updateDrawVertexCount();
}

// ─── AI PATH PREVIEW ─────────────────────────────────────────────────────
window.showAiPathPreview = function(waypoints, color = '#a78bfa') {
    if (aiPathPreview) map.removeLayer(aiPathPreview);
    if (mapMode === 'heatmap') return;
    if (!waypoints || waypoints.length < 2) return;
    aiPathPreview = L.polyline(waypoints, {
        color,
        weight: 2.5,
        opacity: 0.8,
        dashArray: '6, 4'
    }).addTo(map);
    // Zoom to path
    map.fitBounds(aiPathPreview.getBounds(), { padding: [20, 20] });
};

window.clearAiPathPreview = function() {
    if (aiPathPreview) { map.removeLayer(aiPathPreview); aiPathPreview = null; }
};

// ─── BUTTON WIRING ───────────────────────────────────────────────────────
function setupMapButtons() {
    const toggleBtn = document.getElementById('toggleMapLayers');
    if (toggleBtn) toggleBtn.addEventListener('click', toggleMapLayerType);

    const clearBtn = document.getElementById('clearWaypoints');
    if (clearBtn) clearBtn.addEventListener('click', clearManualWaypoints);

    const drawBtn = document.getElementById('btnDrawMode');
    if (drawBtn) drawBtn.addEventListener('click', toggleDrawMode);

    const placeStationBtn = document.getElementById('btnPlaceStation');
    if (placeStationBtn) placeStationBtn.addEventListener('click', togglePlaceStationMode);

    const undoBtn = document.getElementById('btnUndoVertex');
    if (undoBtn) undoBtn.addEventListener('click', undoLastVertex);

    const finishBtn = document.getElementById('btnFinishDraw');
    if (finishBtn) finishBtn.addEventListener('click', finishDrawing);

    const clearDrawBtn = document.getElementById('btnClearDraw');
    if (clearDrawBtn) clearDrawBtn.addEventListener('click', clearDrawing);

    const saveAreaPathBtn = document.getElementById('btnSaveAreaPath');
    if (saveAreaPathBtn) saveAreaPathBtn.addEventListener('click', saveAreaAndPath);

    const deleteAreaBtn = document.getElementById('btnDeleteArea');
    if (deleteAreaBtn) deleteAreaBtn.addEventListener('click', deleteArea);

    const toggleUiBtn = document.getElementById('btnToggleUI');
    if (toggleUiBtn) {
        toggleUiBtn.addEventListener('click', () => {
            const container = document.getElementById('dashboardContainer');
            if (!container) return;
            const isHidden = container.classList.toggle('ui-minimized');
            
            if (isHidden) {
                toggleUiBtn.innerHTML = '<i class="fa-solid fa-eye"></i> <span>Show UI</span>';
                toggleUiBtn.classList.add('minimized');
            } else {
                toggleUiBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> <span>Minimize UI</span>';
                toggleUiBtn.classList.remove('minimized');
            }

            setTimeout(() => {
                if (map) map.invalidateSize();
            }, 310);
        });
    }
}

// ─── LAYER TOGGLE ─────────────────────────────────────────────────────────
function toggleMapLayerType() {
    if (!map) return;
    if (currentLayerName === 'Street') {
        map.removeLayer(baseLayers['Street']);
        baseLayers['Satellite'].addTo(map);
        currentLayerName = 'Satellite';
    } else {
        map.removeLayer(baseLayers['Satellite']);
        baseLayers['Street'].addTo(map);
        currentLayerName = 'Street';
    }
}

// ─── RAY-CASTING PIP ──────────────────────────────────────────────────────
function isPointInPolygon(point, polygon) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

// ─── SNAPPING MATH ────────────────────────────────────────────────────────
function getClosestPointOnSegment(p, a, b) {
    const atob = [b[0] - a[0], b[1] - a[1]];
    const atop = [p[0] - a[0], p[1] - a[1]];
    const len2 = atob[0] * atob[0] + atob[1] * atob[1];
    let t = len2 === 0 ? 0 : (atop[0] * atob[0] + atop[1] * atob[1]) / len2;
    t = Math.max(0, Math.min(1, t));
    return [a[0] + t * atob[0], a[1] + t * atob[1]];
}

function getClosestPointOnPolygon(p, poly) {
    if (!poly || poly.length === 0) return p;
    let closestPt = null;
    let minDistance = Infinity;
    
    for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const cp = getClosestPointOnSegment(p, a, b);
        
        const dx = p[0] - cp[0];
        const dy = p[1] - cp[1];
        const dist2 = dx * dx + dy * dy;
        
        if (dist2 < minDistance) {
            minDistance = dist2;
            closestPt = cp;
        }
    }
    return closestPt;
}

// ─── CHARGING STATION PLACEMENT MODE ──────────────────────────────────────
function togglePlaceStationMode() {
    placeStationMode = !placeStationMode;
    const btn = document.getElementById('btnPlaceStation');
    if (placeStationMode) {
        if (drawMode) toggleDrawMode();
        map.getContainer().style.cursor = 'cell';
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-charging-station"></i> Click Pond Edge...';
            btn.style.background = 'var(--color-warning)';
            btn.style.color = '#fff';
        }
    } else {
        map.getContainer().style.cursor = '';
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-charging-station"></i> Place Station';
            btn.style.background = '';
            btn.style.color = '';
        }
    }
}

function saveAreaAndPath() {
    if (!activeVesselId) return;
    fetch('/api/fleet/save_area_path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vessel_id: activeVesselId })
    })
    .then(r => r.json())
    .then(d => {
        if (d.error) {
            alert('Error: ' + d.error);
        } else {
            alert('Area and Path saved successfully for ' + activeVesselId + '!');
        }
    })
    .catch(e => alert('Failed to save area and path: ' + e.message));
}

function deleteArea() {
    if (!activeVesselId) return;
    if (!confirm('Are you sure you want to delete the custom area and reset to default? This will also clear the active path.')) return;
    fetch('/api/fleet/delete_area', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vessel_id: activeVesselId })
    })
    .then(r => r.json())
    .then(d => {
        if (d.error) {
            alert('Error: ' + d.error);
        } else {
            alert('Custom area deleted successfully.');
        }
    })
    .catch(e => alert('Failed to delete area: ' + e.message));
}

// ─── CANVAS GRADIENT HEATMAP ──────────────────────────────────────────────
let heatmapLayer = null;
let currentHeatmapOpacity = 0.65;
let heatmapFetchCount = 0;
let heatmapPending = false; // debounce flag
let lastHeatmapPoints = [];
let heatmapHoverTooltip = null;

/**
 * Compute biological score [0..1] from a raw parameter value.
 * 1.0 = optimal for fish, 0.0 = lethal.
 */
function bioScore(val, param) {
    if (val == null) return 0.5;
    if (param === 'do') {
        if (val >= 5.0) return 1.0;
        if (val >= 2.0) return 0.5 + 0.5 * (val - 2.0) / 3.0;
        return 0.5 * (val / 2.0);
    }
    if (param === 'ph') {
        if (val >= 6.5 && val <= 8.5) return 1.0;
        if (val >= 5.5 && val < 6.5)  return 0.5 + 0.5 * (val - 5.5);
        if (val > 8.5 && val <= 9.5)  return 0.5 + 0.5 * (9.5 - val);
        if (val < 5.5) return Math.max(0, 0.5 * (val - 5.0) / 0.5);
        return Math.max(0, 0.5 * (10.0 - val) / 0.5);
    }
    if (param === 'temp') {
        if (val >= 24.0 && val <= 32.0) return 1.0;
        if (val >= 20.0 && val < 24.0)  return 0.5 + 0.5 * (val - 20.0) / 4.0;
        if (val > 32.0 && val <= 36.0)  return 0.5 + 0.5 * (36.0 - val) / 4.0;
        if (val < 20.0) return Math.max(0, 0.5 * (val - 15.0) / 5.0);
        return Math.max(0, 0.5 * (39.0 - val) / 3.0);
    }
    return 0.5;
}

/**
 * Maps a raw parameter value directly to an RGB colour.
 * Each parameter has its own perceptual colormap:
 *
 * DO   – monotonic green→yellow→red (low O₂ = bad/red, high = good/green)
 * pH   – symmetric bell: green at pH 7, yellow→orange→red outward (too acid OR too basic = red)
 * Temp – inspired by the meteorological temperature palette adapted to
 *        Celsius for tilapia ponds:
 *          < 15°C icy blue-white | 15-20 navy | 20-24 teal | 24-28 lime
 *          28-32 yellow-gold (optimal) | 32-35 orange | >35 red/pink
 * NH3  – simple green (0, safe) → yellow (0.02, warning) → red (0.05+, toxic)
 */
function paramToRGB(val, param) {
    // Utility: lerp between two RGB stops
    function lerp(a, b, t) {
        t = Math.max(0, Math.min(1, t));
        return [
            Math.round(a[0] + t * (b[0] - a[0])),
            Math.round(a[1] + t * (b[1] - a[1])),
            Math.round(a[2] + t * (b[2] - a[2]))
        ];
    }
    // Utility: multi-stop palette lookup
    function palette(stops, t) {
        t = Math.max(0, Math.min(1, t));
        const seg = t * (stops.length - 1);
        const lo  = Math.floor(seg);
        const hi  = Math.min(lo + 1, stops.length - 1);
        return lerp(stops[lo], stops[hi], seg - lo);
    }

    if (param === 'hs_nh3') {
        const stops = [
            [ 16, 185, 129],  // 0 ppm - safe (green)
            [245, 195,  30],  // 15 ppm - warn (yellow)
            [220,  30,  30]   // 25+ ppm - toxic (red)
        ];
        const t = Math.max(0, Math.min(1, (val ?? 0) / 25));
        return palette(stops, t);
    }

    if (param === 'ph') {
        const neutral = 7.0;
        const dist = Math.abs((val ?? 7) - neutral);
        const stops = [
            [ 16, 185, 129],   // dist 0.0  - perfect (green)
            [245, 195,  30],   // dist 1.0  - yellow
            [220,  30,  30]    // dist 2.0+ - red
        ];
        const t = Math.min(1, dist / 2.0);
        return palette(stops, t);
    }

    if (param === 'temp') {
        const anchors = [
            { v: 10,  c: [ 42, 155, 196] },  // Sky blue
            { v: 15,  c: [113, 190, 181] },  // Light teal
            { v: 20,  c: [194, 213, 164] },  // Soft sage green
            { v: 24,  c: [244, 219, 134] },  // Soft cream/mellow yellow
            { v: 28,  c: [246, 200, 108] },  // Warm golden yellow
            { v: 32,  c: [240, 170,  98] },  // Warm amber
            { v: 35,  c: [226,  82,  76] },  // Light coral red
            { v: 38,  c: [208,  43,  55] }   // Scorching pinkish-red
        ];
        const v = val ?? 25;
        if (v <= anchors[0].v) return anchors[0].c;
        if (v >= anchors[anchors.length - 1].v) return anchors[anchors.length - 1].c;
        for (let i = 0; i < anchors.length - 1; i++) {
            if (v >= anchors[i].v && v <= anchors[i + 1].v) {
                const t = (v - anchors[i].v) / (anchors[i + 1].v - anchors[i].v);
                return lerp(anchors[i].c, anchors[i + 1].c, t);
            }
        }
    }

    if (param === 'nh3') {
        // NH3: 0 (safe/green) → 0.02 (warning/yellow) → 0.05+ (toxic/red)
        const stops = [
            [ 16, 185, 129],  // 0.00 mg/L – safe  (green)
            [245, 195,  30],  // 0.02 mg/L – warn  (yellow)
            [220,  30,  30]   // 0.05+ mg/L – toxic (red)
        ];
        const t = Math.min(1, (val ?? 0) / 0.05);
        return palette(stops, t);
    }

    // Fallback: neutral grey
    return [120, 140, 130];
}

/** Convert geographic [lat, lon] to canvas pixel [x, y] given bounds. */
function latLonToPixel(lat, lon, mapBounds, W, H) {
    const sw = mapBounds.getSouthWest();
    const ne = mapBounds.getNorthEast();
    const x = ((lon - sw.lng) / (ne.lng - sw.lng)) * W;
    const y = ((ne.lat - lat) / (ne.lat - sw.lat)) * H;
    return [x, y];
}

window.updateHeatmap = function(vesselId, param) {
    if (!map) return;
    if (heatmapPending) return;
    heatmapPending = true;

    if (!vesselId || !currentBoundary || currentBoundary.length < 3) {
        if (heatmapLayer) { map.removeLayer(heatmapLayer); heatmapLayer = null; }
        lastHeatmapPoints = [];
        heatmapPending = false;
        return;
    }

    const currentFetchId = ++heatmapFetchCount;

    fetch('/api/fleet/heatmap/consolidated')
        .then(r => r.json())
        .then(data => {
            if (currentFetchId !== heatmapFetchCount) { heatmapPending = false; return; }
            if (heatmapLayer) { map.removeLayer(heatmapLayer); heatmapLayer = null; }

            const points = data.points || [];
            if (points.length === 0) { heatmapPending = false; return; }
            lastHeatmapPoints = points;

            const container = map.getContainer();
            const W = container.clientWidth  || 800;
            const H = container.clientHeight || 600;
            const mapBounds = L.latLngBounds(
                map.containerPointToLatLng([0, 0]),
                map.containerPointToLatLng([W, H])
            );
            const sw = mapBounds.getSouthWest();
            const ne = mapBounds.getNorthEast();
            const latRange = ne.lat - sw.lat;
            const lonRange = ne.lng - sw.lng;

            const ptData = points
                .map(p => {
                    const pt = map.latLngToContainerPoint(L.latLng(p.lat, p.lon));
                    return {
                        val: p[param],
                        px: pt.x,
                        py: pt.y
                    };
                })
                .filter(p => p.val != null);

            if (ptData.length === 0) { heatmapPending = false; return; }

            const zoomLevel   = map.getZoom();
            const centerLat   = map.getCenter().lat;
            const metersPerPx = 40075016.686 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoomLevel + 8);
            // Scale radius accurately with zoom level to maintain consistent geographic footprint
            // Remove the hard minimum of 5px so it shrinks properly when zooming out to country level.
            const blobRadiusPx = Math.max(1, Math.min(500, 30 / metersPerPx));

            // ── PASS 1: Accumulate weighted values directly to avoid RGB clamping ──
            const valueSum = new Float32Array(W * H);
            const weightSum = new Float32Array(W * H);

            for (const pt of ptData) {
                const x0 = Math.max(0, Math.floor(pt.px - blobRadiusPx));
                const x1 = Math.min(W - 1, Math.ceil(pt.px + blobRadiusPx));
                const y0 = Math.max(0, Math.floor(pt.py - blobRadiusPx));
                const y1 = Math.min(H - 1, Math.ceil(pt.py + blobRadiusPx));
                const r2 = blobRadiusPx * blobRadiusPx;

                for (let y = y0; y <= y1; y++) {
                    const dy = y - pt.py;
                    const dy2 = dy * dy;
                    const rowOffset = y * W;
                    for (let x = x0; x <= x1; x++) {
                        const dx = x - pt.px;
                        const dist2 = dx * dx + dy2;
                        
                        if (dist2 <= r2) {
                            const dist = Math.sqrt(dist2);
                            let w = Math.max(0, 1 - (dist / blobRadiusPx));
                            w = w * w * (3 - 2 * w); // smoothstep
                            
                            const idx = rowOffset + x;
                            valueSum[idx] += pt.val * w;
                            weightSum[idx] += w;
                        }
                    }
                }
            }

            // ── PASS 2: Map averaged values to colormap and draw to canvas ──
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width  = W;
            finalCanvas.height = H;
            const fCtx = finalCanvas.getContext('2d');
            const fImg = fCtx.createImageData(W, H);

            for (let i = 0; i < W * H; i++) {
                const w = weightSum[i];
                if (w < 0.02) continue; // skip empty pixels

                // Average the value for this pixel
                const avgVal = valueSum[i] / w;
                const [r, g, b] = paramToRGB(avgVal, param);

                // Derive final alpha with an S-curve for cohesive edges
                const rawA  = Math.min(1, w * 0.88);
                const alpha = rawA * rawA * (3 - 2 * rawA); // smoothstep

                const pxIdx = i * 4;
                fImg.data[pxIdx]     = r;
                fImg.data[pxIdx + 1] = g;
                fImg.data[pxIdx + 2] = b;
                fImg.data[pxIdx + 3] = Math.round(alpha * 240); // cap at ~94% opacity
            }

            fCtx.putImageData(fImg, 0, 0);

            const dataUrl = finalCanvas.toDataURL('image/png');
            heatmapLayer = L.imageOverlay(dataUrl, mapBounds, {
                opacity: currentHeatmapOpacity,
                interactive: false
            }).addTo(map);

            // Update colormap legend
            updateColormapLegend(param);

            heatmapPending = false;
        })
        .catch(e => {
            console.error('[HEATMAP] Failed to load data:', e);
            heatmapPending = false;
        });
};

/**
 * Renders the colormap gradient bar + tick labels into #colormapLegend.
 * Each parameter uses its own perceptual colormap matching paramToRGB().
 */
function updateColormapLegend(param) {
    const el = document.getElementById('colormapLegend');
    if (!el) return;

    // Per-parameter configuration: gradient stops (CSS, bottom→top) + tick labels
    const configs = {
        hs_nh3: {
            title: 'HS NH₃',
            grad: 'linear-gradient(to top, rgb(16,185,129) 0%, rgb(245,195,30) 60%, rgb(220,30,30) 100%)',
            ticks: [
                { label: '25+ ppm', color: '#dc1e1e' },
                { label: '15 ppm',  color: '#f5c31e' },
                { label: '0 ppm',   color: '#10b981' },
                { label: '', color: 'transparent' },
                { label: '', color: 'transparent' }
            ]
        },
        ph: {
            title: 'pH',
            grad: 'linear-gradient(to top, rgb(220,30,30) 0%, rgb(245,195,30) 25%, rgb(16,185,129) 50%, rgb(245,195,30) 75%, rgb(220,30,30) 100%)',
            ticks: [
                { label: 'pH 9',  color: '#dc1e1e' },
                { label: 'pH 8',  color: '#f5c31e' },
                { label: 'pH 7 ✓', color: '#10b981' },
                { label: 'pH 6',  color: '#f5c31e' },
                { label: 'pH 5',  color: '#dc1e1e' }
            ]
        },
        temp: {
            title: 'Temp',
            grad: 'linear-gradient(to top, rgb(42,155,196) 0%, rgb(113,190,181) 18%, rgb(194,213,164) 36%, rgb(244,219,134) 50%, rgb(246,200,108) 64%, rgb(240,170,98) 78%, rgb(226,82,76) 90%, rgb(208,43,55) 100%)',
            ticks: [
                { label: '38°C+',  color: '#d02b37' },
                { label: '32°C',   color: '#f0aa62' },
                { label: '28°C ✓', color: '#f6c86c' },
                { label: '20°C',   color: '#c2d5a4' },
                { label: '10°C',   color: '#2a9bc4' }
            ]
        },
        nh3: {
            title: 'NH₃',
            grad: 'linear-gradient(to top, rgb(16,185,129) 0%, rgb(245,195,30) 40%, rgb(220,30,30) 100%)',
            ticks: [
                { label: '0.05+ mg/L', color: '#dc1e1e' },
                { label: '0.02 mg/L',  color: '#f5c31e' },
                { label: '0 mg/L',     color: '#10b981' },
                { label: '',           color: 'transparent' },
                { label: '',           color: 'transparent' }
            ]
        }
    };

    const cfg = configs[param] || configs['hs_nh3'];

    el.innerHTML = `
        <div style="font-size:0.46rem;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;color:var(--primary);margin-bottom:7px;text-align:right;white-space:nowrap;">${cfg.title} Scale</div>
        <div style="display:flex;flex-direction:row;align-items:stretch;gap:5px;">
            <div style="display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;height:115px;font-size:0.43rem;font-weight:700;font-family:var(--font-mono);color:var(--text-muted);padding:1px 0;line-height:1;">
                ${cfg.ticks.map(t => `<span style="color:${t.color};white-space:nowrap">${t.label}</span>`).join('')}
            </div>
            <div style="width:13px;height:115px;border-radius:6px;background:${cfg.grad};box-shadow:0 0 10px rgba(0,0,0,0.5),inset 0 0 0 1px rgba(255,255,255,0.08);flex-shrink:0;"></div>
        </div>`;
}

// currentHeatmapOpacity declared at line 761 — see top of heatmap section
window.updateHeatmapOpacity = function(opacity) {
    currentHeatmapOpacity = opacity;
    if (heatmapLayer) {
        if (opacity === 0) {
            if (map.hasLayer(heatmapLayer)) map.removeLayer(heatmapLayer);
        } else {
            if (!map.hasLayer(heatmapLayer)) heatmapLayer.addTo(map);
            heatmapLayer.setOpacity(opacity);
        }
    }
};

