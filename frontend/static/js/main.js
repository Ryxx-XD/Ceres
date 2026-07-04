/**
 * CERES — Core UI JavaScript
 * Fleet telemetry routing, multi-vessel switching, AI path modal,
 * real-time charts, theme switching, and WebSocket management.
 */

'use strict';

// ─── STATE ──────────────────────────────────────────────────────────────
let socket = null;
let realtimeChart = null;
const MAX_POINTS = 20;
let rtLabels = [], rtHS = [], rtNH3 = [], rtTemp = [], rtPH = [], rtDO = [];

let activeVesselId = 'CRSMD0001';
let lastFleetData   = {};
let lastParamUpdateTime = 0;


function runInit() {
    initMobileSidebar();
    initThemeSelector();
    initWebSocket();
    initTelemetryChart();
    initHistoricalChart();
    initParamBarChart();
    initStatusDoughnutChart();
    initVesselSelector();
    initDeviceDropdown();
    initAiPathModal();
    initFleetDevicesPage();
    initReports();
    initPageTransitions();
    initHeaderClock();
    initToggleUiBtn();
    initControlButtons();

    if (document.getElementById('sysAvgTemp')) {
        updateSystemAiDiagnostics();
        setInterval(updateSystemAiDiagnostics, 10000);
    }
}

// ─── TOGGLE HUD OVERLAYS ─────────────────────────────────────────────────
function initToggleUiBtn() {
    const btn = document.getElementById('btnToggleUI');
    if (!btn) return;
    let hidden = false;
    btn.addEventListener('click', () => {
        hidden = !hidden;
        const container = document.getElementById('dashboardContainer');
        const huds = ['hudStatus', 'hudGauges', 'hudDiag', 'hudMetrics'];
        huds.forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.style.opacity = hidden ? '0' : '1'; el.style.pointerEvents = hidden ? 'none' : 'all'; }
        });
        btn.innerHTML = hidden
            ? '<i class="fa-solid fa-eye"></i> <span>Show HUD</span>'
            : '<i class="fa-solid fa-eye-slash"></i> <span>Hide HUD</span>';
    });
}



if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runInit);
} else {
    runInit();
}

// ─── MOBILE SIDEBAR ──────────────────────────────────────────────────────
function initMobileSidebar() {
    const btn = document.getElementById('menuBtn');
    const sb  = document.getElementById('sidebar');
    const ov  = document.getElementById('sidebarOverlay');
    if (!btn || !sb) return;
    const open  = () => {
        sb.classList.add('open');
        btn.classList.add('open');
        ov?.classList.add('active');
        document.body.classList.add('sidebar-open');
    };
    const close = () => {
        sb.classList.remove('open');
        btn.classList.remove('open');
        ov?.classList.remove('active');
        document.body.classList.remove('sidebar-open');
    };
    btn.addEventListener('click', () => sb.classList.contains('open') ? close() : open());
    ov?.addEventListener('click', close);
}

// ─── PAGE TRANSITIONS ───────────────────────────────────────────────────
function initPageTransitions() {
    const mainWrapper = document.querySelector('.main-wrapper');
    if (!mainWrapper) return;

    // Remove exit class if restored from back-forward cache
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            mainWrapper.classList.remove('page-exit-active');
        }
    });

    // Intercept navigation link clicks
    const links = document.querySelectorAll('a');
    links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        if (href === '#' || href.startsWith('javascript:') || href === '/logout') return;
        if (href.startsWith('http://') || href.startsWith('https://')) {
            try {
                const url = new URL(href);
                if (url.host !== window.location.host) return;
            } catch (_) {
                return;
            }
        }

        link.addEventListener('click', e => {
            // Ignore modifier keys for opening in new tab/window
            if (e.metaKey || e.ctrlKey || e.shiftKey || (e.button && e.button === 1)) {
                return;
            }

            const targetUrl = link.getAttribute('href');
            // If already on the same page, do not trigger exit transition
            if (targetUrl === window.location.pathname || targetUrl === window.location.href) {
                return;
            }

            e.preventDefault();
            mainWrapper.classList.add('page-exit-active');
            
            // Navigate after transition completes
            setTimeout(() => {
                window.location.href = targetUrl;
            }, 250);
        });
    });
}

// ─── LIVE HEADER CLOCK ──────────────────────────────────────────────────
function initHeaderClock() {
    const clockEl = document.getElementById('headerLiveTime');
    if (!clockEl) return;

    function updateClock() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        clockEl.textContent = `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
    }

    updateClock();
    setInterval(updateClock, 1000);
}

// ─── THEME ───────────────────────────────────────────────────────────────
function initThemeSelector() {
    const sel = document.getElementById('themeSelector');
    const cur = localStorage.getItem('ceres-theme') || 'light';
    document.body.className = 'theme-' + cur;
    if (sel) {
        sel.value = cur;
        sel.addEventListener('change', e => {
            const t = e.target.value;
            document.body.className = 'theme-' + t;
            localStorage.setItem('ceres-theme', t);
        });
    }
}

// ─── WEBSOCKET ────────────────────────────────────────────────────────────
function initWebSocket() {
    function setConnected(ok) {
        const badge = document.getElementById('telemetryStatusBadge');
        const dot   = document.getElementById('sidebarStatusDot');
        const txt   = document.getElementById('sidebarStatusText');
        if (badge) { badge.innerHTML = ok ? '<i class="fa-solid fa-wifi"></i>&nbsp;WI-FI LINK' : '<i class="fa-solid fa-triangle-exclamation"></i>&nbsp;LINK DOWN'; badge.className = 'status-badge ' + (ok ? 'optimal' : 'deadly'); }
        if (dot)   dot.style.background = ok ? 'var(--primary)' : 'var(--color-deadly)';
        if (txt)   txt.textContent = ok ? 'System Online' : 'Link Down';
    }

    function connect() {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        socket = new WebSocket(`${proto}://${location.host}/ws/client`);
        socket.onopen    = () => { setConnected(true); console.info('[WS] Connected'); };
        socket.onmessage = e => { try { handleMessage(JSON.parse(e.data)); } catch(_) {} };
        socket.onclose   = () => { setConnected(false); setTimeout(connect, 3000); };
        socket.onerror   = () => socket.close();
    }
    connect();
}

window.sendCommand = function(action, extra = {}) {
    const payload = { action, vessel_id: activeVesselId, ...extra };
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
};

// ─── MESSAGE ROUTING ──────────────────────────────────────────────────────
function handleMessage(msg) {
    if (msg.type === 'fleet_telemetry') {
        lastFleetData = msg.vessels || {};
        
        // Prioritize local selection over server's in-flight/broadcast active_vessel_id
        const sel = document.getElementById('activeVesselSelect');
        if (sel && sel.value) {
            activeVesselId = sel.value;
        } else {
            activeVesselId = msg.active_vessel_id || activeVesselId;
        }

        // Update active vessel dropdown options dynamically if changed
        if (sel) {
            const currentKeys = Array.from(sel.options).map(o => o.value + ':' + o.text).sort().join(',');
            const newKeys = Object.entries(lastFleetData).map(([vid, v]) => {
                const label = v.device_type === 'charging_station' ? '⚡ Station' : 'Vessel';
                return vid + ':' + vid + ' (' + (v.name || 'Unnamed') + ') [' + label + ']';
            }).sort().join(',');
            if (currentKeys !== newKeys) {
                const oldVal = sel.value;
                sel.innerHTML = Object.entries(lastFleetData).map(([vid, v]) => {
                    const label = v.device_type === 'charging_station' ? '⚡ Station' : 'Vessel';
                    return `<option value="${vid}">${vid} (${v.name || 'Unnamed'}) [${label}]</option>`;
                }).join('');
                if (lastFleetData[oldVal]) {
                    sel.value = oldVal;
                    activeVesselId = oldVal;
                } else {
                    sel.value = activeVesselId;
                }
            }
        }

        // Update map with all vessels
        if (window.updateFleetMarkers) {
            window.updateFleetMarkers(lastFleetData, activeVesselId);
        }

        // Update dashboard with active vessel
        const active = lastFleetData[activeVesselId];
        if (active) handleActiveTelemetry(active);

        // Update device dropdown on dashboard
        if (typeof updateDeviceDropdown === 'function') {
            updateDeviceDropdown(lastFleetData, activeVesselId);
        }

        // Update fleet cards on devices page
        updateFleetCards(lastFleetData, activeVesselId);
    }
}

// ─── ACTIVE VESSEL DASHBOARD UPDATE ──────────────────────────────────────
function handleActiveTelemetry(d) {
    const isStation = (d.device_type === 'charging_station');

    // Disable or style autonav buttons if the active device is a station
    const navButtons = ['btnAutoStart', 'btnExplore', 'btnGenerateAI', 'btnEmergencyStop', 'btnRTH', 'btnDock'];
    navButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            if (isStation) { btn.disabled = true; btn.style.opacity = '0.35'; btn.style.cursor = 'not-allowed'; }
            else { btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer'; }
        }
    });

    // ── Arc Gauges (always live) ──────────────────────────────────────────
    if (d.hs_nh3 != null && window.updateArcGauge) {
        window.updateArcGauge('gaugeArcHS', 'gaugeValHS', 'gaugeStatHS', 'gaugeCardHS', d.hs_nh3, 0, 50, 'ppm',
            { warn_high: 10.0, deadly_high: 25.0 });
    }
    if (d.ph != null && window.updateArcGauge) {
        window.updateArcGauge('gaugeArcPH', 'gaugeValPH', 'gaugeStatPH', 'gaugeCardPH', d.ph, 0, 14, 'pH',
            { warn_low: 6.0, deadly_low: 4.0, warn_high: 8.5, deadly_high: 9.5 });
    }
    if (d.temp != null && window.updateArcGauge) {
        window.updateArcGauge('gaugeArcTemp', 'gaugeValTemp', 'gaugeStatTemp', 'gaugeCardTemp', d.temp, 15, 40, '°C',
            { warn_low: 20, deadly_low: 15, warn_high: 32, deadly_high: 35 });
    }
    if (d.nh3 != null && window.updateArcGauge) {
        // NH3 is inverted: higher value = more dangerous; gauge fills more = worse
        // Map 0–0.1 mg/L, threshold at warn=0.02, deadly=0.05
        window.updateArcGauge('gaugeArcNH3', 'gaugeValNH3', 'gaugeStatNH3', 'gaugeCardNH3', d.nh3, 0, 0.1, 'mg/L',
            { warn_high: 0.02, deadly_high: 0.05 });
    }

    // ── System averages row (bottom center HUD) ────────────────────────────
    const phAvg = d.hourly_averages?.ph ?? d.ph;
    const tempAvg = d.hourly_averages?.temp ?? d.temp;
    const hsAvg = d.hourly_averages?.hs_nh3 ?? d.hs_nh3;
    const nh3Avg = d.hourly_averages?.nh3 ?? d.nh3;
    const battAvg = d.hourly_averages?.battery ?? d.battery;

    setText('sysAvgPh',   phAvg   != null ? phAvg.toFixed(2)   : '--');
    setText('sysAvgTemp', tempAvg != null ? tempAvg.toFixed(1)  : '--');
    setText('sysAvgHs',   hsAvg   != null ? hsAvg.toFixed(2)    : '--');
    setText('sysAvgNh3',  nh3Avg  != null ? nh3Avg.toFixed(4)   : '--');
    setText('sysAvgPhi',  battAvg != null ? battAvg.toFixed(1)  : '--');  // battery in Batt pill

    if (d.phi != null) setText('valPhi', d.phi.toFixed(1));
    if (d.wellness?.survival_rate != null) setText('valSurvival', d.wellness.survival_rate.toFixed(1));

    // Status badge
    const sb = document.getElementById('overallStatusBadge');
    if (sb && d.status) {
        sb.textContent = d.status.toUpperCase();
        sb.className = `status-badge ${d.status === 'Optimal' ? 'optimal' : d.status === 'Harmful' ? 'harmful' : 'deadly'}`;
    }

    // PHI health banner (dashboard only — safe to call even if elements absent)
    if (d.phi != null && window.updatePhiBanner) {
        window.updatePhiBanner(d.phi, d.status);
    }

    // ── Extended diagnostics (new fields from enriched simulation) ─────────
    if (d.hs_nh3_trend) {
        const trendEl = document.getElementById('diagHsNh3Trend');
        if (trendEl) {
            const arrows = { rising: '↑ Rising', falling: '↓ Falling', stable: '→ Stable' };
            const colors = { rising: 'var(--color-warning)', falling: 'var(--color-optimal)', stable: 'var(--text-primary)' };
            trendEl.textContent = arrows[d.hs_nh3_trend] || d.hs_nh3_trend;
            trendEl.style.color = colors[d.hs_nh3_trend] || 'var(--text-primary)';
        }
    }

    if (d.temp_trend) {
        const trendEl = document.getElementById('diagTempTrend');
        if (trendEl) {
            const arrows = { rising: '↑ Rising', falling: '↓ Falling', stable: '→ Stable' };
            const colors = { rising: '#f59e0b', falling: '#38bdf8', stable: 'var(--text-primary)' };
            trendEl.textContent = arrows[d.temp_trend] || d.temp_trend;
            trendEl.style.color = colors[d.temp_trend] || 'var(--text-primary)';
        }
    }

    if (d.ph_trend) {
        const phTrendEl = document.getElementById('diagPhTrend');
        if (phTrendEl) {
            const arrows = { rising: '↑ Rising', falling: '↓ Falling', stable: '→ Stable' };
            // pH rising during day = photosynthesis = usually good; falling at night is normal
            const colors = { rising: 'var(--color-optimal)', falling: '#38bdf8', stable: 'var(--text-primary)' };
            phTrendEl.textContent = arrows[d.ph_trend] || d.ph_trend;
            phTrendEl.style.color = colors[d.ph_trend] || 'var(--text-primary)';
        }
    }

    if (d.nh3 != null) {
        const freeEl = document.getElementById('diagFreeNH3');
        if (freeEl) {
            const freeNH3 = d.nh3;
            freeEl.textContent = freeNH3.toFixed(4) + ' mg/L';
            freeEl.style.color = freeNH3 < 0.02 ? 'var(--color-optimal)' : freeNH3 < 0.05 ? 'var(--color-warning)' : 'var(--color-deadly)';
        }
    }

    if (d.hs_nh3_rate != null) {
        const hsRateEl = document.getElementById('diagHsNh3Rate');
        if (hsRateEl) {
            const sign = d.hs_nh3_rate >= 0 ? '+' : '';
            hsRateEl.textContent = sign + d.hs_nh3_rate.toFixed(2) + ' ppm/h';
            hsRateEl.style.color = d.hs_nh3_rate > 2.0 ? 'var(--color-deadly)' : d.hs_nh3_rate > 0.5 ? 'var(--color-warning)' : 'var(--color-optimal)';
        }
    }

    if (d.turbidity_est != null) {
        const turbEl = document.getElementById('diagTurbidity');
        if (turbEl) {
            turbEl.textContent = d.turbidity_est.toFixed(1) + ' NTU';
            turbEl.style.color = d.turbidity_est < 15 ? 'var(--color-optimal)' : d.turbidity_est < 35 ? 'var(--color-warning)' : 'var(--color-deadly)';
        }
    }

    if (d.clarity_idx != null) {
        const clarityEl = document.getElementById('diagClarity');
        if (clarityEl) {
            clarityEl.textContent = d.clarity_idx.toFixed(1) + '%';
            clarityEl.style.color = d.clarity_idx >= 70 ? 'var(--color-optimal)' : d.clarity_idx >= 45 ? 'var(--color-warning)' : 'var(--color-deadly)';
        }
    }

    if (d.bod_est != null) {
        const bodEl = document.getElementById('diagBod');
        if (bodEl) {
            bodEl.textContent = d.bod_est.toFixed(2) + ' mg/L';
            bodEl.style.color = d.bod_est < 1.0 ? 'var(--color-optimal)' : d.bod_est < 3.0 ? 'var(--color-warning)' : 'var(--color-deadly)';
        }
    }

    if (d.feeding_status) {
        setText('diagFeeding', d.feeding_status);
    }

    // ── Alert log ──────────────────────────────────────────────────────────
    const alertLog = d.alert_log || [];
    const alertContainer = document.getElementById('hudAlertLog');
    if (alertContainer) {
        if (alertLog.length > 0) {
            alertContainer.style.display = 'flex';
            alertContainer.innerHTML = alertLog.map(a => `
                <div class="hud-alert-item ${a.zone === 'Deadly' ? 'deadly' : 'warn'}">
                    <i class="fa-solid ${a.zone === 'Deadly' ? 'fa-radiation' : 'fa-triangle-exclamation'}" style="font-size:0.65rem;flex-shrink:0;"></i>
                    <span style="font-size:0.6rem;opacity:0.7;">[${a.ts}]</span>
                    <span>${a.msg}</span>
                </div>`).join('');
        } else {
            alertContainer.style.display = 'none';
        }
    }

    // Toxicity text
    const toxEl = document.getElementById('toxicityAnalysis');
    if (toxEl && d.nh3 != null) {
        toxEl.textContent = d.nh3 < 0.02 ? 'Safe range ammonia levels.' : d.nh3 < 0.05 ? '⚠ Stress-level ammonia detected.' : '⛔ Toxic ammonia threshold exceeded!';
    }

    // Dynamic warning visuals
    updateWarningVisuals(d);

    // ── Motor / Nav (Always update live) ──────────────────────────────────
    const pwmP = d.pwm_port ?? 1500;
    const pwmS = d.pwm_stbd ?? 1500;
    setText('pwmPort',       pwmP + ' µs');
    setText('pwmStbd',       pwmS + ' µs');
    setText('navDist',       (d.distance_to_wp ?? 0).toFixed(1) + ' m');
    setText('navHeadingDev', (d.heading_error   ?? 0).toFixed(1) + '°');
    setText('vesselMode',    (isStation ? 'STATION' : (d.mode ?? 'STANDBY').toUpperCase()));
    if (d.target_lat && d.target_lon) setText('navTarget', `${d.target_lat.toFixed(4)}, ${d.target_lon.toFixed(4)}`);
    else setText('navTarget', isStation ? 'STATIC' : 'No target');

    // ── GPS & Compass ──────────────────────────────────────────────────────
    if (d.lat != null) setText('navLat',  d.lat.toFixed(6));
    if (d.lon != null) setText('navLon',  d.lon.toFixed(6));
    if (d.heading != null) {
        setText('navHeading', d.heading.toFixed(1) + '°');
        const needle = document.getElementById('compassNeedle');
        if (needle) needle.style.transform = `rotate(${d.heading}deg)`;
    }

    // ── Estimated speed ────────────────────────────────────────────────────
    const pwmAvg  = (pwmP + pwmS) / 2;
    const pwmDev  = Math.abs(pwmAvg - 1500);
    const estSpeed = (pwmDev / 500 * 1.2).toFixed(2);
    setText('navSpeed', estSpeed + ' m/s');

    // ── PWM visual bars ────────────────────────────────────────────────────
    function setPwmBar(id, pwm) {
        const bar = document.getElementById(id);
        if (!bar) return;
        const pct = Math.min(Math.abs(pwm - 1500) / 500 * 50, 50);
        if (pwm > 1500) { bar.style.left = '50%'; bar.style.width = pct + '%'; bar.style.background = 'var(--primary)'; }
        else if (pwm < 1500) { bar.style.left = (50 - pct) + '%'; bar.style.width = pct + '%'; bar.style.background = 'var(--accent-blue)'; }
        else { bar.style.width = '0%'; }
    }
    setPwmBar('pwmPortBar', pwmP);
    setPwmBar('pwmStbdBar', pwmS);

    // ── Battery ───────────────────────────────────────────────────────────
    if (d.battery != null) {
        const batt = d.battery;
        setText('gncBattVal', batt.toFixed(1) + '%');
        const battBar = document.getElementById('gncBattBar');
        if (battBar) battBar.style.width = Math.max(0, Math.min(100, batt)) + '%';
        const battIcon = document.getElementById('gncBattIcon');
        if (battIcon) {
            battIcon.className = `fa-solid fa-battery-${batt < 20 ? 'empty' : batt < 40 ? 'quarter' : batt < 70 ? 'half' : 'three-quarters'}`;
            battIcon.style.color = batt < 20 ? 'var(--color-deadly)' : batt < 40 ? 'var(--color-warning)' : 'var(--primary)';
        }
    }

    // ── Mini water quality chips ──────────────────────────────────────────
    function updateGncChip(chipId, valId, value, unit, lowWarn, lowDead, highWarn, highDead) {
        const chip = document.getElementById(chipId);
        const valEl = document.getElementById(valId);
        if (!chip || !valEl || value == null) return;
        valEl.textContent = value.toFixed(value < 1 ? 4 : 2) + (unit ? ' ' + unit : '');
        chip.className = 'gnc-sensor-chip';
        if ((highDead != null && value > highDead) || (lowDead != null && value < lowDead)) chip.classList.add('deadly');
        else if ((highWarn != null && value > highWarn) || (lowWarn != null && value < lowWarn)) chip.classList.add('warn');
    }
    updateGncChip('gnc-chip-ph',   'gnc-ph',   d.ph,   '',     6.0, 4.0, 8.5, 9.5);
    updateGncChip('gnc-chip-temp', 'gnc-temp', d.temp, '°C',  20, 15, 32, 35);
    updateGncChip('gnc-chip-hs',   'gnc-hs',   d.hs_nh3,   'ppm', null, null, 10.0, 25.0);
    updateGncChip('gnc-chip-nh3',  'gnc-nh3',  d.nh3,  'mg/L', null, null, 0.02, 0.05);

    // Call dynamic GNC arc gauges updater on devices page if available
    if (window.updateGncArcGauges) {
        window.updateGncArcGauges(d);
    }

    // ── Mission coverage ──────────────────────────────────────────────────
    const coverage = d.coverage_pct ?? d.wellness?.coverage_pct ?? null;
    if (coverage != null) {
        setText('navCoverage', coverage.toFixed(1) + '%');
        const bar = document.getElementById('coverageBar');
        if (bar) bar.style.width = Math.min(100, coverage) + '%';
    }

    // ── Online status dot ─────────────────────────────────────────────────
    const dot = document.getElementById('vesselOnlineDot');
    if (dot) {
        dot.style.background = d.online !== false ? 'var(--primary)' : 'var(--color-deadly)';
        dot.style.boxShadow  = d.online !== false ? '0 0 5px var(--primary)' : '0 0 5px var(--color-deadly)';
    }

    // Real-time chart
    pushRealtimeChart(d);
}


function updateWarningVisuals(d) {
    if (!d.wellness || !d.wellness.parameters) return;
    const params = d.wellness.parameters;
    
    // Mapping of telemetry keys to element prefixes/IDs
    const mappings = [
        { key: 'hs_nh3', card: 'cardHS', icon: 'iconHS', val: 'statHS', row: 'rowHs' },
        { key: 'ph', card: 'cardPH', icon: 'iconPH', val: 'statPH', row: 'rowPh' },
        { key: 'temp', card: 'cardTemp', icon: 'iconTemp', val: 'statTemp', row: 'rowTemp' },
        { key: 'nh3', card: null, icon: null, val: null, row: 'rowNh3' }
    ];

    mappings.forEach(m => {
        const zone = params[m.key]?.zone || 'Optimal';
        
        // Update top Stat Cards
        if (m.card) {
            const cardEl = document.getElementById(m.card);
            const iconEl = document.getElementById(m.icon);
            const valEl = document.getElementById(m.val);
            if (cardEl) {
                cardEl.className = 'stat-card';
                if (iconEl) iconEl.className = 'stat-icon';
                if (valEl) valEl.className = 'stat-value';

                if (zone === 'Optimal') {
                    cardEl.classList.add('green');
                    if (iconEl) iconEl.classList.add('green');
                    if (valEl) valEl.classList.add('green');
                } else if (zone === 'Harmful') {
                    cardEl.classList.add('amber', 'warning-flash');
                    if (iconEl) iconEl.classList.add('amber');
                    if (valEl) valEl.classList.add('amber');
                } else if (zone === 'Deadly') {
                    cardEl.classList.add('red', 'deadly-flash');
                    if (iconEl) iconEl.classList.add('red');
                    if (valEl) valEl.classList.add('red');
                }
            }
        }

        // Update sensor grid metric rows
        if (m.row) {
            const rowEl = document.getElementById(m.row);
            if (rowEl) {
                rowEl.classList.remove('warning', 'deadly');
                const prevWarn = rowEl.querySelector('.row-warning-icon');
                if (prevWarn) prevWarn.remove();

                if (zone === 'Harmful') {
                    rowEl.classList.add('warning');
                    const label = rowEl.querySelector('.metric-label');
                    if (label) {
                        label.insertAdjacentHTML('afterbegin', '<span class="row-warning-icon" style="color:var(--color-warning);margin-right:4px;">⚠️ </span>');
                    }
                } else if (zone === 'Deadly') {
                    rowEl.classList.add('deadly');
                    const label = rowEl.querySelector('.metric-label');
                    if (label) {
                        label.insertAdjacentHTML('afterbegin', '<span class="row-warning-icon" style="color:var(--color-deadly);margin-right:4px;animation: flash-red 1s infinite;">⛔ </span>');
                    }
                }
            }
        }
    });
}

// ─── VESSEL SELECTOR ─────────────────────────────────────────────────────
function initVesselSelector() {
    const sel = document.getElementById('activeVesselSelect');
    if (sel) {
        sel.addEventListener('change', async e => {
            if (window.selectDeviceDropdown) {
                await window.selectDeviceDropdown(e.target.value);
            }
        });
    }
    const drop = document.getElementById('vesselSelectDropdown');
    if (drop) {
        drop.addEventListener('change', async e => {
            if (window.selectDeviceDropdown) {
                await window.selectDeviceDropdown(e.target.value);
            }
        });
    }
}

// ─── FLEET CARDS (Devices page) ──────────────────────────────────────────
function updateFleetCards(fleetData, activeVid) {
    const container = document.getElementById('fleetCards');
    if (!container) return;

    // Convert dict or list to array
    const vessels = Array.isArray(fleetData) ? fleetData : Object.values(fleetData);
    const probes   = vessels.filter(v => v.device_type !== 'charging_station');
    const countEl  = document.getElementById('fleetCountLabel');
    if (countEl) countEl.textContent = `${vessels.length} device${vessels.length !== 1 ? 's' : ''} online`;

    // ── System Health Summary ─────────────────────────────────────────────
    const summaryEl = document.getElementById('systemHealthSummary');
    if (summaryEl && probes.length) {
        const avgPhi  = probes.reduce((s, v) => s + (v.phi ?? 75), 0) / probes.length;
        const avgHs   = probes.reduce((s, v) => s + (v.hs_nh3 ?? 0), 0)   / probes.length;
        const avgTemp = probes.reduce((s, v) => s + (v.temp ?? 0), 0)  / probes.length;
        const avgTurb = probes.reduce((s, v) => s + (v.turbidity_est ?? 8), 0) / probes.length;
        const avgClar = probes.reduce((s, v) => s + (v.clarity_idx ?? 75), 0)  / probes.length;
        const alarmCount = probes.filter(v => v.status && v.status !== 'Optimal').length;
        const sysStatus  = alarmCount === 0 ? 'Optimal' : probes.some(v => v.status === 'Deadly') ? 'Deadly' : 'Harmful';
        const stsColor   = sysStatus === 'Optimal' ? 'var(--color-optimal)' : sysStatus === 'Harmful' ? 'var(--color-warning)' : 'var(--color-deadly)';
        const phiColor   = avgPhi >= 70 ? 'var(--color-optimal)' : avgPhi >= 45 ? 'var(--color-warning)' : 'var(--color-deadly)';

        summaryEl.innerHTML = `
        <div style="display:flex;gap:0;flex-wrap:wrap;">
            <div style="flex:1;min-width:110px;padding:10px 14px;border-right:1px solid var(--border-color);">
                <div style="font-size:0.48rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px;">Pond Status</div>
                <div style="font-size:1rem;font-weight:800;color:${stsColor};">${sysStatus.toUpperCase()}</div>
                <div style="font-size:0.62rem;color:var(--text-muted);margin-top:2px;">${alarmCount === 0 ? 'All parameters nominal' : `${alarmCount} vessel${alarmCount > 1 ? 's' : ''} in alarm`}</div>
            </div>
            <div style="flex:1;min-width:100px;padding:10px 14px;border-right:1px solid var(--border-color);">
                <div style="font-size:0.48rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px;">Avg PHI</div>
                <div style="font-size:1.1rem;font-weight:800;color:${phiColor};">${avgPhi.toFixed(1)}<span style="font-size:0.55rem;font-weight:500;color:var(--text-muted);"> / 100</span></div>
                <div style="height:3px;background:var(--border-color);border-radius:2px;margin-top:5px;overflow:hidden;"><div style="height:100%;width:${avgPhi}%;background:${phiColor};border-radius:2px;transition:width 0.5s;"></div></div>
            </div>
            <div style="flex:1;min-width:90px;padding:10px 14px;border-right:1px solid var(--border-color);">
                <div style="font-size:0.48rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px;">Avg HS NH₃</div>
                <div style="font-size:1rem;font-weight:700;color:${avgHs < 10 ? 'var(--color-optimal)' : avgHs < 25 ? 'var(--color-warning)' : 'var(--color-deadly)'};">${avgHs.toFixed(2)} <span style="font-size:0.55rem;color:var(--text-muted);">ppm</span></div>
            </div>
            <div style="flex:1;min-width:90px;padding:10px 14px;border-right:1px solid var(--border-color);">
                <div style="font-size:0.48rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px;">Avg Temp</div>
                <div style="font-size:1rem;font-weight:700;color:${avgTemp >= 24 && avgTemp <= 32 ? 'var(--color-optimal)' : 'var(--color-warning)'};">${avgTemp.toFixed(1)} <span style="font-size:0.55rem;color:var(--text-muted);">°C</span></div>
            </div>
            <div style="flex:1;min-width:90px;padding:10px 14px;border-right:1px solid var(--border-color);">
                <div style="font-size:0.48rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px;">Turbidity</div>
                <div style="font-size:1rem;font-weight:700;color:${avgTurb < 15 ? 'var(--color-optimal)' : avgTurb < 35 ? 'var(--color-warning)' : 'var(--color-deadly)'};">${avgTurb.toFixed(1)} <span style="font-size:0.55rem;color:var(--text-muted);">NTU</span></div>
            </div>
            <div style="flex:1;min-width:90px;padding:10px 14px;">
                <div style="font-size:0.48rem;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:4px;">Clarity Idx</div>
                <div style="font-size:1rem;font-weight:700;color:${avgClar >= 70 ? 'var(--color-optimal)' : avgClar >= 45 ? 'var(--color-warning)' : 'var(--color-deadly)'};">${avgClar.toFixed(1)}<span style="font-size:0.55rem;color:var(--text-muted);"> %</span></div>
            </div>
        </div>`;
    }

    if (!vessels.length) return;

    container.innerHTML = vessels.map(v => {
        const isActive  = (v.vessel_id === activeVid);
        const isStation = (v.device_type === 'charging_station');
        const statusColor = v.online ? '#10b981' : '#64748b';
        const modeColor   = (!v.online) ? 'var(--text-muted)' : (v.mode === 'standby' ? 'var(--text-muted)' : 'var(--primary)');
        const modeBg      = (!v.online) ? 'var(--bg-surface)' : (v.mode === 'standby' ? 'var(--bg-surface)' : 'rgba(16,185,129,0.12)');
        const modeText    = (!v.online) ? 'OFFLINE' : (isStation ? 'STATION' : v.mode.toUpperCase());

        const statusBadgeColor = !v.status || v.status === 'Optimal' ? 'var(--color-optimal)' : v.status === 'Harmful' ? 'var(--color-warning)' : 'var(--color-deadly)';
        const statusBadgeBg    = !v.status || v.status === 'Optimal' ? 'rgba(16,185,129,0.12)' : v.status === 'Harmful' ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)';
        const phi      = v.phi  ?? 75;
        const phiColor = phi >= 70 ? 'var(--color-optimal)' : phi >= 45 ? 'var(--color-warning)' : 'var(--color-deadly)';
        const phiBar   = Math.min(100, phi);

        const iconHtml = isStation
            ? `<i class="fa-solid fa-charging-station" style="color:${statusColor};margin-right:6px;font-size:0.95rem;"></i>`
            : `<i class="fa-solid fa-ship" style="color:${statusColor};margin-right:6px;font-size:0.95rem;"></i>`;

        let metricsHtml = '';
        if (isStation) {
            metricsHtml = `
            <div style="grid-column: span 2; display: flex; flex-direction: column; gap: 4px; font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">
                <div>STATUS: <span style="color:${statusColor}; font-weight:700;">${v.online ? 'ACTIVE' : 'INACTIVE'}</span></div>
                <div>LAT: <span style="color:var(--text-primary);">${v.lat?.toFixed(5) ?? '--'}</span></div>
                <div>LON: <span style="color:var(--text-primary);">${v.lon?.toFixed(5) ?? '--'}</span></div>
                <div>COMPASS: <span style="color:var(--text-primary);">${v.heading?.toFixed(1) ?? '0.0'}°</span></div>
            </div>`;
        } else {
            const hsTrend  = v.hs_nh3_trend ?? 'stable';
            const hsTrendStr = { rising: '↑', falling: '↓', stable: '→' }[hsTrend] || hsTrend;
            const hsTrendCol = hsTrend === 'rising' ? 'var(--color-warning)' : hsTrend === 'falling' ? 'var(--color-optimal)' : 'var(--text-muted)';
            const turbStr  = v.turbidity_est != null ? v.turbidity_est.toFixed(1) + ' NTU' : '--';
            const turbCol  = v.turbidity_est != null ? (v.turbidity_est < 15 ? 'var(--color-optimal)' : v.turbidity_est < 35 ? 'var(--color-warning)' : 'var(--color-deadly)') : 'var(--text-muted)';

            metricsHtml = `
            <div>HS NH₃ <span style="color:${v.hs_nh3 != null && v.hs_nh3 < 10 ? 'var(--color-optimal)' : 'var(--color-warning)'};">${v.hs_nh3?.toFixed(1) ?? '--'} ppm</span></div>
            <div>pH <span>${v.ph?.toFixed(2) ?? '--'}</span></div>
            <div>Temp <span>${v.temp?.toFixed(1) ?? '--'} °C</span></div>
            <div>NH₃ <span style="color:${v.nh3 != null && v.nh3 >= 0.05 ? 'var(--color-deadly)' : v.nh3 >= 0.02 ? 'var(--color-warning)' : 'inherit'};">${v.nh3?.toFixed(3) ?? '--'} mg/L</span></div>
            <div>HS Trend <span style="color:${hsTrendCol};">${hsTrendStr}</span></div>
            <div>Turb. <span style="color:${turbCol};">${turbStr}</span></div>
            <div style="grid-column: span 2;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                    <span style="font-size:0.58rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);">PHI Score</span>
                    <span style="font-size:0.72rem;font-weight:700;color:${phiColor};">${phi.toFixed(1)}</span>
                </div>
                <div style="height:4px;background:var(--border-color);border-radius:2px;overflow:hidden;">
                    <div style="height:100%;width:${phiBar}%;background:${phiColor};border-radius:2px;transition:width 0.5s;"></div>
                </div>
            </div>
            <div style="grid-column: span 2; display: flex; justify-content: space-between; align-items: center;">
                <span style="color:var(--text-muted);">Battery</span>
                <span style="color: ${v.battery < 30 ? 'var(--color-deadly)' : 'var(--primary)'};">
                    <i class="fa-solid fa-battery-${v.battery < 20 ? 'empty' : v.battery < 50 ? 'quarter' : v.battery < 80 ? 'half' : 'full'}"></i>
                    ${v.battery != null ? v.battery.toFixed(1) : '100.0'}%
                </span>
            </div>`;
        }

        const nameSafe    = (v.name || '').replace(/'/g, "\\'");
        const wifiSafe    = (v.wifi_ssid || '').replace(/'/g, "\\'");
        const phoneSafe   = (v.phone_number || '').replace(/'/g, "\\'");
        const typeSafe    = v.device_type || 'vessel';

        return `
        <div class="fleet-card ${isActive ? 'active-vessel' : ''}" style="border-left-color:${v.color};">
            <div class="fleet-card-header">
                ${iconHtml}
                <span class="fleet-card-id" style="font-size:0.9rem;">${v.vessel_id}</span>
                <span class="fleet-card-mode" style="color:${modeColor};background:${modeBg};">${modeText}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
                <div style="font-size:0.85rem;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${v.name || ''}">
                    ${v.name || (isStation ? 'Unnamed Station' : 'Unnamed Vessel')}
                </div>
                ${!isStation ? `<span style="font-size:0.58rem;font-weight:800;padding:2px 6px;border-radius:4px;background:${statusBadgeBg};color:${statusBadgeColor};white-space:nowrap;">${(v.status || 'OPTIMAL').toUpperCase()}</span>` : ''}
            </div>
            <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:8px;display:flex;flex-direction:column;gap:2px;line-height:1.2;">
                <div><i class="fa-solid fa-wifi" style="width:12px;text-align:center;"></i> SSID: <span style="color:var(--text-primary);">${v.wifi_ssid || '--'}</span></div>
                <div><i class="fa-solid fa-phone" style="width:12px;text-align:center;"></i> GSM: <span style="color:var(--text-primary);font-family:var(--font-mono);">${v.phone_number || '--'}</span></div>
            </div>
            <div class="fleet-card-metrics">
                ${metricsHtml}
            </div>
            <div style="display:flex;gap:6px;margin-top:10px;">
                <button class="cyber-btn" onclick="selectFleetVessel('${v.vessel_id}')"
                        style="font-size:0.73rem;padding:4px;flex:1;justify-content:center;
                               ${isActive ? 'background:var(--primary);color:#fff;border-color:var(--primary);' : ''}">
                    ${isActive ? '✓ Selected' : 'Select Active'}
                </button>
                <button class="cyber-btn" onclick="openEditVesselModal('${v.vessel_id}', '${nameSafe}', '${wifiSafe}', '${phoneSafe}', '${typeSafe}', ${v.online})"
                        style="font-size:0.73rem;padding:4px 8px;justify-content:center;">
                    <i class="fa-solid fa-pen"></i>
                </button>
            </div>
        </div>`;
    }).join('');
}

window.selectFleetVessel = async function(vid) {
    activeVesselId = vid;
    lastParamUpdateTime = 0;
    const sel = document.getElementById('activeVesselSelect');
    if (sel) sel.value = vid;
    setText('activeVesselIdBadge', vid);

    // Immediately update map markers, boundary, and path for the new active vessel
    if (window.updateFleetMarkers && lastFleetData) {
        window.updateFleetMarkers(lastFleetData, vid);
    }

    window.sendCommand('select_vessel', { vessel_id: vid });
    try { await fetch(`/api/fleet/select/${vid}`); } catch(_) {}
};

window.openEditVesselModal = function(vid, name, wifi, phone, type, online) {
    const modal = document.getElementById('editVesselModal');
    if (!modal) return;
    document.getElementById('editVesselIdTitle').textContent = vid;
    document.getElementById('editVesselId').value = vid;
    document.getElementById('editVesselName').value = name;
    document.getElementById('editVesselWifi').value = wifi;
    document.getElementById('editVesselPhone').value = phone;

    const typeSelect = document.getElementById('editDeviceType');
    if (typeSelect) {
        typeSelect.value = type || 'vessel';
    }

    const statusSelect = document.getElementById('editDeviceStatus');
    if (statusSelect) {
        statusSelect.value = (online === true || online === 'true') ? 'active' : 'inactive';
    }

    modal.style.display = 'flex';
};

function initFleetDevicesPage() {
    // MODALS
    const addModal = document.getElementById('addVesselModal');
    const editModal = document.getElementById('editVesselModal');
    const addBtn = document.getElementById('btnAddVessel');

    if (!addBtn) return; // Only run on devices & comms page

    // Setup type listeners
    const addTypeSelect = document.getElementById('addDeviceType');
    const addVesselIdInput = document.getElementById('addVesselId');
    if (addTypeSelect && addVesselIdInput) {
        addTypeSelect.addEventListener('change', (e) => {
            const isStation = e.target.value === 'charging_station';
            // Dynamically change ID prefix if it is still a default generated one
            let currVal = addVesselIdInput.value.trim();
            if (currVal.startsWith('CRSMD') || currVal.startsWith('CRSCS')) {
                const digits = currVal.replace('CRSMD', '').replace('CRSCS', '');
                addVesselIdInput.value = isStation ? `CRSCS${digits}` : `CRSMD${digits}`;
            }
        });
    }

    // Open add modal
    addBtn.addEventListener('click', () => {
        // Clear inputs first
        const randomNum = Math.floor(1000 + Math.random() * 9000);
        document.getElementById('addVesselId').value = `CRSMD${randomNum}`;
        document.getElementById('addDeviceType').value = 'vessel';
        document.getElementById('addDeviceStatus').value = 'active';
        document.getElementById('addVesselName').value = '';
        document.getElementById('addVesselWifi').value = '';
        document.getElementById('addVesselPhone').value = '';
        addModal.style.display = 'flex';
    });

    // Close modals
    document.getElementById('closeAddModal')?.addEventListener('click', () => addModal.style.display = 'none');
    document.getElementById('btnCancelAdd')?.addEventListener('click', () => addModal.style.display = 'none');
    document.getElementById('closeEditModal')?.addEventListener('click', () => editModal.style.display = 'none');
    document.getElementById('btnCancelEdit')?.addEventListener('click', () => editModal.style.display = 'none');

    // Submit add vessel
    document.getElementById('btnSubmitAdd')?.addEventListener('click', async () => {
        const vesselId = document.getElementById('addVesselId').value.trim();
        const name = document.getElementById('addVesselName').value.trim();
        const wifi = document.getElementById('addVesselWifi').value.trim();
        const phone = document.getElementById('addVesselPhone').value.trim();
        const type = document.getElementById('addDeviceType').value;
        const online = document.getElementById('addDeviceStatus').value === 'active';

        if (!vesselId) {
            alert("Device ID is required");
            return;
        }

        try {
            const r = await fetch('/api/fleet/add', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    vessel_id: vesselId, 
                    name, 
                    wifi_ssid: wifi, 
                    phone_number: phone,
                    device_type: type,
                    online: online
                })
            });
            const d = await r.json();
            if (d.error) {
                alert(d.error);
            } else {
                addModal.style.display = 'none';
                refreshFleetData();
            }
        } catch(e) { console.error(e); }
    });

    // Submit edit vessel
    document.getElementById('btnSubmitEdit')?.addEventListener('click', async () => {
        const vesselId = document.getElementById('editVesselId').value;
        const name = document.getElementById('editVesselName').value.trim();
        const wifi = document.getElementById('editVesselWifi').value.trim();
        const phone = document.getElementById('editVesselPhone').value.trim();
        const type = document.getElementById('editDeviceType').value;
        const online = document.getElementById('editDeviceStatus').value === 'active';

        try {
            const r = await fetch('/api/fleet/edit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    vessel_id: vesselId, 
                    name, 
                    wifi_ssid: wifi, 
                    phone_number: phone,
                    device_type: type,
                    online: online
                })
            });
            const d = await r.json();
            if (d.error) {
                alert(d.error);
            } else {
                editModal.style.display = 'none';
                refreshFleetData();
            }
        } catch(e) { console.error(e); }
    });

    // Delete vessel
    document.getElementById('btnDeleteVessel')?.addEventListener('click', async () => {
        const vesselId = document.getElementById('editVesselId').value;
        if (!confirm(`Are you sure you want to delete ${vesselId}? This cannot be undone.`)) return;

        try {
            const r = await fetch('/api/fleet/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ vessel_id: vesselId })
            });
            const d = await r.json();
            if (d.error) {
                alert(d.error);
            } else {
                editModal.style.display = 'none';
                if (d.new_active) {
                    activeVesselId = d.new_active;
                }
                refreshFleetData();
            }
        } catch(e) { console.error(e); }
    });

    // Helper to refresh fleet data immediately
    async function refreshFleetData() {
        try {
            const r = await fetch('/api/fleet');
            const d = await r.json();
            updateFleetCards(d.vessels || {}, d.active_vessel_id || activeVesselId);
        } catch(e) { console.error(e); }
    }

    // Load initial fleet data for devices page
    refreshFleetData();
}

// ─── AI PATH MODAL ────────────────────────────────────────────────────────
function initAiPathModal() {
    const openBtn  = document.getElementById('btnGenerateAI');
    const modal    = document.getElementById('aiPathModal');
    const closeBtn = document.getElementById('closeAiModal');
    if (!openBtn || !modal) return;

    openBtn.addEventListener('click', async () => {
        modal.style.display = 'flex';
        await loadAiPaths();
    });

    closeBtn?.addEventListener('click', () => {
        modal.style.display = 'none';
        window.clearAiPathPreview?.();
    });

    // Close on backdrop click
    modal.addEventListener('click', e => {
        if (e.target === modal) { modal.style.display = 'none'; window.clearAiPathPreview?.(); }
    });
}

async function loadAiPaths() {
    const cards = document.getElementById('aiPathCards');
    const label = document.getElementById('modalVesselLabel');
    if (!cards) return;
    if (label) label.textContent = activeVesselId;

    cards.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:span 2;">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size:1.5rem;margin-bottom:10px;"></i><br>Generating path strategies…</div>`;

    try {
        const r = await fetch(`/api/ai/paths?vessel_id=${activeVesselId}`);
        const d = await r.json();
        renderPathCards(d.paths || []);
    } catch(e) {
        cards.innerHTML = `<div style="color:var(--color-deadly);padding:20px;grid-column:span 2;">Failed to load AI paths: ${e.message}</div>`;
    }
}

function renderPathCards(paths) {
    const container = document.getElementById('aiPathCards');
    if (!container || !paths.length) return;

    container.innerHTML = paths.map((p, i) => {
        const previewSvg = buildPathSvg(p.waypoints, p.color);
        return `
        <div class="path-option-card" id="pathCard_${i}" onclick="previewPath(${i})"
             style="border-color: transparent;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                <div class="path-icon-badge" style="background:${p.color}22;color:${p.color};">
                    <i class="fa-solid ${p.icon}"></i>
                </div>
                <div>
                    <div class="path-card-name">${p.name}</div>
                    <div style="font-size:0.68rem;color:var(--text-muted);">${p.waypoint_count} waypoints</div>
                </div>
            </div>
            <div class="path-waypoint-preview">${previewSvg}</div>
            <div class="path-card-desc">${p.description}</div>
            <div class="path-card-meta">
                <div>Waypoints: <strong>${p.waypoint_count}</strong></div>
                <div>Coverage: <strong style="color:${p.color};">${p.coverage_pct}%</strong></div>
            </div>
            <button class="cyber-btn btn-primary path-execute-btn"
                    style="background:${p.color};border-color:${p.color};margin-top:10px;"
                    onclick="event.stopPropagation();executeAiPath(${JSON.stringify(p).replace(/"/g,'&quot;')})">
                <i class="fa-solid fa-play"></i> Execute on ${activeVesselId}
            </button>
        </div>`;
    }).join('');

    // Store path data globally for preview
    window._aiPathData = paths;
}

window.previewPath = function(idx) {
    const paths = window._aiPathData;
    if (!paths || !paths[idx]) return;
    const p = paths[idx];
    // Highlight selected card
    document.querySelectorAll('.path-option-card').forEach((c, i) => {
        c.style.borderColor = i === idx ? p.color : 'transparent';
    });
    window.showAiPathPreview?.(p.waypoints, p.color);
};

window.executeAiPath = function(pathObj) {
    window.sendCommand('execute_path', {
        path_id: pathObj.id,
        waypoints: pathObj.waypoints
    });
    // Close modal
    const modal = document.getElementById('aiPathModal');
    if (modal) modal.style.display = 'none';
    window.clearAiPathPreview?.();
};

// Mini SVG path preview
function buildPathSvg(waypoints, color) {
    if (!waypoints || waypoints.length < 2) return '<span style="color:var(--text-muted);font-size:0.75rem;">No preview</span>';

    const lats = waypoints.map(w => w[0]);
    const lons = waypoints.map(w => w[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const W = 180, H = 52;
    const padX = 8, padY = 6;

    const toX = lon => padX + ((lon - minLon) / (maxLon - minLon || 1)) * (W - padX*2);
    const toY = lat => H - padY - ((lat - minLat) / (maxLat - minLat || 1)) * (H - padY*2);

    const pts = waypoints.map(w => `${toX(w[1]).toFixed(1)},${toY(w[0]).toFixed(1)}`).join(' ');
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-opacity="0.8" stroke-linejoin="round"/>
        <circle cx="${toX(waypoints[0][1]).toFixed(1)}" cy="${toY(waypoints[0][0]).toFixed(1)}" r="3" fill="${color}"/>
    </svg>`;
}

// ─── CONTROL BUTTONS ─────────────────────────────────────────────────────
function initControlButtons() {
    const binds = {
        btnAutoStart:     'start_auto',
        btnExplore:       'start_explore',
        btnEmergencyStop: 'emergency_stop',
        btnRTH:           'rth',
        btnDock:          'dock'
    };
    for (const [id, action] of Object.entries(binds)) {
        document.getElementById(id)?.addEventListener('click', () => window.sendCommand(action));
    }
}

// ─── GAUGE ───────────────────────────────────────────────────────────────
function updateGauge(circleId, valId, value, min, max) {
    const circle = document.getElementById(circleId);
    const valEl  = document.getElementById(valId);
    if (!circle) return;
    const r = parseFloat(circle.getAttribute('r'));
    const circ = 2 * Math.PI * r;
    const pct  = Math.max(0, Math.min(1, (value - min) / (max - min)));
    circle.style.strokeDasharray  = circ.toFixed(1);
    circle.style.strokeDashoffset = (circ * (1 - pct)).toFixed(1);
    circle.style.stroke = pct > 0.6 ? 'var(--color-optimal)' : pct > 0.3 ? 'var(--color-warning)' : 'var(--color-deadly)';
    if (valEl) valEl.textContent = value.toFixed(1);
}

// ─── REALTIME CHART ───────────────────────────────────────────────────────
function initTelemetryChart() {
    const canvas = document.getElementById('telemetryChart');
    if (!canvas) return;
    const urlParams = new URLSearchParams(window.location.search);
    const paramFilter = urlParams.get('param') || 'all';

    const datasets = [
        { label: 'HS NH₃ (ppm)',  data: rtHS,  borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', borderWidth: 2, tension: 0.4, pointRadius: 0, yAxisID: 'yHS' },
        { label: 'NH₃ (mg/L)', data: rtNH3, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)',  borderWidth: 2, tension: 0.4, pointRadius: 0, yAxisID: 'yNH3' },
        { label: 'Temp (°C)', data: rtTemp, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)',  borderWidth: 2, tension: 0.4, pointRadius: 0, yAxisID: 'yTemp' },
        { label: 'pH', data: rtPH, borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)',  borderWidth: 2, tension: 0.4, pointRadius: 0, yAxisID: 'yPH' }
    ];

    datasets.forEach(ds => {
        if (paramFilter !== 'all' && paramFilter !== 'phi' && paramFilter !== 'survival') {
            const lbl = ds.label.toLowerCase();
            let keep = false;
            if (paramFilter === 'hs_nh3' || paramFilter === 'nh3') {
                if (lbl.includes('nh₃') || lbl.includes('nh3')) keep = true;
            } else if (paramFilter === 'ph') {
                if (lbl.includes('ph')) keep = true;
            } else if (paramFilter === 'temp') {
                if (lbl.includes('temp')) keep = true;
            } else if (paramFilter === 'do') {
                if (lbl.includes('do') || lbl.includes('dissolved')) keep = true;
            }
            if (!keep) ds.hidden = true;
        }
    });

    realtimeChart = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: rtLabels,
            datasets: datasets
        },
        options: chartBase({
            scales: { 
                x: axisX(), 
                yHS: axisY({ position: 'left', min: 0, max: 50, display: paramFilter==='all' || paramFilter==='hs_nh3' }), 
                yNH3: axisY({ position: 'right', min: 0, max: 0.1, grid: false, display: paramFilter==='all' || paramFilter==='nh3' }),
                yTemp: axisY({ position: 'left', min: 15, max: 40, grid: false, display: paramFilter==='temp' }),
                yPH: axisY({ position: 'right', min: 0, max: 14, grid: false, display: paramFilter==='ph' })
            }
        })
    });
}

function pushRealtimeChart(d) {
    if (!realtimeChart) return;
    rtLabels.push(new Date().toLocaleTimeString());
    rtHS.push(d.hs_nh3 ?? 0);
    rtNH3.push(d.nh3 ?? 0);
    rtTemp.push(d.temp_c ?? 0);
    rtPH.push(d.ph ?? 0);
    rtDO.push(d.do_mgl ?? 0);
    if (rtLabels.length > MAX_POINTS) { rtLabels.shift(); rtHS.shift(); rtNH3.shift(); rtTemp.shift(); rtPH.shift(); rtDO.shift(); }
    realtimeChart.update('none');
}

// ─── HISTORICAL CHART ─────────────────────────────────────────────────────
function initHistoricalChart() {
    const canvas = document.getElementById('historicalTelemetryChart');
    if (!canvas) return;
    const table = document.getElementById('historicalLogTable');
    const labels = [], temps = [], phs = [], hss = [];
    if (table) {
        Array.from(table.querySelectorAll('tbody tr')).reverse().forEach(row => {
            const c = row.querySelectorAll('td');
            if (c.length >= 4) {
                labels.push(c[0].innerText.split(' ')[1] || c[0].innerText);
                temps.push(parseFloat(c[1].innerText));
                phs.push(parseFloat(c[2].innerText));
                hss.push(parseFloat(c[3].innerText));
            }
        });
    }
    new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: { labels, datasets: [
            { label: 'Temp (°C)',  data: temps, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)',  borderWidth: 2, tension: 0.3, pointRadius: 3 },
            { label: 'pH',        data: phs,   borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)',  borderWidth: 2, tension: 0.3, pointRadius: 3 },
            { label: 'HS NH₃ (ppm)', data: hss,   borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.08)',  borderWidth: 2, tension: 0.3, pointRadius: 3 }
        ]},
        options: chartBase({ scales: { x: axisX(), y: axisY({ min: 0 }) } })
    });
}

// ─── PARAM BAR CHART ─────────────────────────────────────────────────────
function initParamBarChart() {
    const canvas = document.getElementById('paramBarChart');
    if (!canvas) return;
    new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['pH', 'DO (mg/L)', 'Temp (°C/10)', 'PHI (/10)'],
            datasets: [{ label: 'Latest Reading', data: [7.41, 5.8, 2.83, 7.75],
                backgroundColor: ['rgba(16,185,129,0.7)', 'rgba(56,189,248,0.7)', 'rgba(245,158,11,0.7)', 'rgba(99,102,241,0.7)'],
                borderColor:     ['rgb(16,185,129)',       'rgb(56,189,248)',       'rgb(245,158,11)',       'rgb(99,102,241)'],
                borderWidth: 1.5, borderRadius: 4 }]
        },
        options: chartBase({ indexAxis: 'y', scales: { x: axisY({ min: 0, max: 12 }), y: axisX() } })
    });
}

// ─── DOUGHNUT CHART ───────────────────────────────────────────────────────
function initStatusDoughnutChart() {
    const canvas = document.getElementById('statusDoughnutChart');
    if (!canvas) return;
    new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: { labels: ['Optimal', 'Harmful', 'Deadly'],
            datasets: [{ data: [5, 1, 0], backgroundColor: ['rgba(16,185,129,0.75)', 'rgba(245,158,11,0.75)', 'rgba(239,68,68,0.75)'], borderWidth: 0, hoverOffset: 6 }]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '68%',
            plugins: { legend: { position: 'bottom', labels: { font: { family: 'Inter', size: 10 }, padding: 12, color: '#94a3b8', usePointStyle: true } } }
        }
    });
}

// ─── CHART HELPERS ────────────────────────────────────────────────────────
function chartBase(extra = {}) {
    return {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        plugins: { legend: { position: 'top', labels: { font: { family: 'Inter', size: 10 }, color: '#94a3b8', usePointStyle: true, boxWidth: 8, padding: 12 } } },
        ...extra
    };
}
function axisX(extra = {}) {
    return { grid: { display: false }, ticks: { font: { family: 'Inter', size: 9 }, color: '#94a3b8', maxTicksLimit: 6 }, border: { color: 'rgba(148,163,184,0.2)' }, ...extra };
}
function axisY({ grid = true, min, max, position = 'left' } = {}) {
    return { position, min, max,
        grid: grid ? { color: 'rgba(148,163,184,0.1)', drawBorder: false } : { display: false },
        ticks: { font: { family: 'Inter', size: 9 }, color: '#94a3b8' },
        border: { dash: [3, 3], color: 'rgba(148,163,184,0.2)' }
    };
}

// ─── UTILITIES ────────────────────────────────────────────────────────────
function setText(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.textContent = val;
}

// ─── REPORTS ──────────────────────────────────────────────────────────────
async function initReports() {
    const weeklyContainer = document.querySelector('.weekly-report');
    const monthlyContainer = document.querySelector('.monthly-report');
    
    if (weeklyContainer) {
        try {
            const res = await fetch(`/api/reports/data?range_type=weekly`);
            const data = await res.json();
            
            setText('weeklyDeviceName', data.device_name);
            setText('weeklyDeviceId', data.device_id);
            setText('weeklyReportTime', `${data.timestamp} UTC`);
            
            renderAiAssessment('weeklyAiAssessmentBlock', data.assessment);
            
            const canvas24h = document.getElementById('weekly24hChart');
            if (canvas24h) {
                new Chart(canvas24h.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels: data.hours_labels,
                        datasets: [
                            { label: 'Temp (°C)', data: data.temp_24h, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.05)', borderWidth: 2, tension: 0.3, pointRadius: 2 },
                            { label: 'pH', data: data.ph_24h, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.05)', borderWidth: 2, tension: 0.3, pointRadius: 2 },
                            { label: 'DO (mg/L)', data: data.do_24h, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.05)', borderWidth: 2, tension: 0.3, pointRadius: 2 }
                        ]
                    },
                    options: chartBase({ scales: { x: axisX(), y: axisY({ min: 0 }) } })
                });
            }
            
            const canvas7d = document.getElementById('weekly7dChart');
            if (canvas7d) {
                new Chart(canvas7d.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels: data.days_labels,
                        datasets: [
                            { label: 'Temp (°C)', data: data.temp_7d, borderColor: '#d97706', backgroundColor: 'rgba(217,119,6,0.05)', borderWidth: 2, tension: 0.2, pointRadius: 3 },
                            { label: 'pH', data: data.ph_7d, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,0.05)', borderWidth: 2, tension: 0.2, pointRadius: 3 },
                            { label: 'DO (mg/L)', data: data.do_7d, borderColor: '#0284c7', backgroundColor: 'rgba(2,132,199,0.05)', borderWidth: 2, tension: 0.2, pointRadius: 3 }
                        ]
                    },
                    options: chartBase({ scales: { x: axisX(), y: axisY({ min: 0 }) } })
                });
            }
            
            const canvasDoughnut = document.getElementById('weeklyStatusDoughnutChart');
            if (canvasDoughnut) {
                new Chart(canvasDoughnut.getContext('2d'), {
                    type: 'doughnut',
                    data: {
                        labels: ['Optimal Hours', 'Harmful Hours', 'Deadly Hours'],
                        datasets: [{
                            data: [data.status_distribution.optimal, data.status_distribution.harmful, data.status_distribution.deadly],
                            backgroundColor: ['rgba(16,185,129,0.75)', 'rgba(245,158,11,0.75)', 'rgba(239,68,68,0.75)'],
                            borderWidth: 0,
                            hoverOffset: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '68%',
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: { font: { family: 'Inter', size: 10 }, padding: 12, color: '#94a3b8', usePointStyle: true }
                            }
                        }
                    }
                });
            }
            
            updateReportPhiGauge('weekly', data.averages.hs_nh3, data.averages.ph, data.averages.temp);
            
        } catch (err) {
            console.error('Error fetching weekly report data:', err);
        }
    }
    
    if (monthlyContainer) {
        try {
            const res = await fetch(`/api/reports/data?range_type=monthly`);
            const data = await res.json();
            
            setText('monthlyDeviceName', data.device_name);
            setText('monthlyDeviceId', data.device_id);
            setText('monthlyReportTime', `${data.timestamp} UTC`);
            
            renderAiAssessment('monthlyAiAssessmentBlock', data.assessment);
            
            const canvas30d = document.getElementById('monthly30dChart');
            if (canvas30d) {
                new Chart(canvas30d.getContext('2d'), {
                    type: 'line',
                    data: {
                        labels: data.days_labels,
                        datasets: [
                            { label: 'Temp (°C)', data: data.temp_30d, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.05)', borderWidth: 2, tension: 0.2, pointRadius: 1 },
                            { label: 'pH', data: data.ph_30d, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.05)', borderWidth: 2, tension: 0.2, pointRadius: 1 },
                            { label: 'DO (mg/L)', data: data.do_30d, borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.05)', borderWidth: 2, tension: 0.2, pointRadius: 1 }
                        ]
                    },
                    options: chartBase({ scales: { x: axisX(), y: axisY({ min: 0 }) } })
                });
            }
            
            const canvasDoughnut = document.getElementById('monthlyStatusDoughnutChart');
            if (canvasDoughnut) {
                new Chart(canvasDoughnut.getContext('2d'), {
                    type: 'doughnut',
                    data: {
                        labels: ['Optimal Days', 'Harmful Days', 'Deadly Days'],
                        datasets: [{
                            data: [data.status_distribution.optimal, data.status_distribution.harmful, data.status_distribution.deadly],
                            backgroundColor: ['rgba(16,185,129,0.75)', 'rgba(245,158,11,0.75)', 'rgba(239,68,68,0.75)'],
                            borderWidth: 0,
                            hoverOffset: 6
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '68%',
                        plugins: {
                            legend: {
                                position: 'bottom',
                                labels: { font: { family: 'Inter', size: 10 }, padding: 12, color: '#94a3b8', usePointStyle: true }
                            }
                        }
                    }
                });
            }
            
            updateReportPhiGauge('monthly', data.averages.hs_nh3, data.averages.ph, data.averages.temp);
            
        } catch (err) {
            console.error('Error fetching monthly report data:', err);
        }
    }
}

function renderAiAssessment(containerId, assessment) {
    const block = document.getElementById(containerId);
    if (!block) return;
    
    let verdictIcon = '<i class="fa-solid fa-circle-check" style="color:var(--primary)"></i>';
    let verdictColor = 'var(--primary)';
    if (assessment.verdict.includes('CRITICAL')) {
        verdictIcon = '<i class="fa-solid fa-triangle-exclamation" style="color:var(--color-deadly)"></i>';
        verdictColor = 'var(--color-deadly)';
    } else if (assessment.verdict.includes('ATTENTION')) {
        verdictIcon = '<i class="fa-solid fa-circle-exclamation" style="color:var(--color-warning)"></i>';
        verdictColor = 'var(--color-warning)';
    }
    
    let recsHtml = '';
    assessment.recommendations.forEach(r => {
        recsHtml += `<li>${r}</li>`;
    });
    
    block.innerHTML = `
        <div class="ai-assessment-verdict" style="color: ${verdictColor}">
            ${verdictIcon} <span>${assessment.verdict}</span>
        </div>
        <div class="ai-assessment-analysis">
            ${assessment.analysis}
        </div>
        <div class="ai-assessment-recs-title">Biological Recommendations</div>
        <ul class="ai-assessment-recs-list">
            ${recsHtml}
        </ul>
    `;
}

function updateReportPhiGauge(prefix, doVal, phVal, tempVal) {
    function scoreDO(v) { return v >= 5.0 ? 1.0 : (v <= 2.0 ? 0.0 : (v - 2.0) / 3.0); }
    function scorePH(v) { return (6.5 <= v && v <= 8.5) ? 1.0 : (v < 5.0 || v > 10.0 ? 0.0 : 0.5); }
    function scoreTemp(v) { return (24.0 <= v && v <= 32.0) ? 1.0 : (v < 15.0 || v > 39.0 ? 0.0 : 0.5); }
    
    const sDO = scoreDO(doVal);
    const sPH = scorePH(phVal);
    const sT = scoreTemp(tempVal);
    const phi = Math.pow(sDO * sPH * sT * 1.0, 0.25) * 100;
    
    const scoreVal = isNaN(phi) ? 0 : Math.round(phi);
    const phiText = document.getElementById(`${prefix}PhiVal`);
    const phiCircle = document.getElementById(`${prefix}PhiCircle`);
    const phiVerdict = document.getElementById(`${prefix}PhiVerdict`);
    
    if (phiText) phiText.textContent = scoreVal;
    
    if (phiCircle) {
        const offset = 282.7 - (scoreVal / 100) * 282.7;
        phiCircle.style.strokeDashoffset = offset;
        
        let color = 'var(--primary)';
        if (scoreVal < 50) color = 'var(--color-deadly)';
        else if (scoreVal < 75) color = 'var(--color-warning)';
        phiCircle.style.stroke = color;
    }
    
    if (phiVerdict) {
        let text = 'EXCELLENT';
        let color = 'var(--primary)';
        if (scoreVal < 50) { text = 'UNHABITABLE'; color = 'var(--color-deadly)'; }
        else if (scoreVal < 75) { text = 'STRESSED ENVIRONMENT'; color = 'var(--color-warning)'; }
        phiVerdict.textContent = text;
        phiVerdict.style.color = color;
    }
}

function downloadPdfReport(range) {
    const deviceName = document.getElementById(`${range}DeviceName`)?.textContent || 'Ceres Vessel';
    const deviceId = document.getElementById(`${range}DeviceId`)?.textContent || 'N/A';
    const reportTime = document.getElementById(`${range}ReportTime`)?.textContent || new Date().toLocaleString();
    const aiAssessmentHtml = document.getElementById(`${range}AiAssessmentBlock`)?.innerHTML || '';
    
    let chartImagesHtml = '';
    
    if (range === 'weekly') {
        const c24h = document.getElementById('weekly24hChart');
        const c7d = document.getElementById('weekly7dChart');
        const cDoughnut = document.getElementById('weeklyStatusDoughnutChart');
        
        const img24h = c24h ? c24h.toDataURL('image/png') : '';
        const img7d = c7d ? c7d.toDataURL('image/png') : '';
        const imgDoughnut = cDoughnut ? cDoughnut.toDataURL('image/png') : '';
        
        chartImagesHtml = `
            <div class="print-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px;">
                <div class="print-card" style="border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px;">
                    <h3 style="margin-top:0; font-size: 0.9rem; text-transform: uppercase; color: #475569;">24-Hour Diurnal Trends</h3>
                    <img src="${img24h}" style="width: 100%; height: auto;" />
                </div>
                <div class="print-card" style="border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px;">
                    <h3 style="margin-top:0; font-size: 0.9rem; text-transform: uppercase; color: #475569;">7-Day Historical Trends</h3>
                    <img src="${img7d}" style="width: 100%; height: auto;" />
                </div>
            </div>
            <div class="print-grid" style="display: grid; grid-template-columns: 1.5fr 1fr; gap: 20px; margin-top: 20px;">
                <div class="print-card" style="border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px;">
                    <h3 style="margin-top:0; font-size: 0.9rem; text-transform: uppercase; color: #475569;">Status Distribution (Past 24 Hours)</h3>
                    <img src="${imgDoughnut}" style="width: 100%; max-width: 300px; height: auto; margin: 0 auto; display: block;" />
                </div>
                <div class="print-card" style="border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
                    <h3 style="margin-top:0; font-size: 0.9rem; text-transform: uppercase; color: #475569;">Pond Habitability Score</h3>
                    <div style="font-size: 3rem; font-weight: 700; color: #10b981; font-family: monospace;">
                        ${document.getElementById('weeklyPhiVal')?.textContent || '--'}
                    </div>
                    <div style="font-size: 0.9rem; font-weight: 700; color: #475569; text-transform: uppercase;">
                        ${document.getElementById('weeklyPhiVerdict')?.textContent || '--'}
                    </div>
                </div>
            </div>
        `;
    } else if (range === 'monthly') {
        const c30d = document.getElementById('monthly30dChart');
        const cDoughnut = document.getElementById('monthlyStatusDoughnutChart');
        
        const img30d = c30d ? c30d.toDataURL('image/png') : '';
        const imgDoughnut = cDoughnut ? cDoughnut.toDataURL('image/png') : '';
        
        chartImagesHtml = `
            <div class="print-grid" style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-top: 20px;">
                <div class="print-card" style="border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px;">
                    <h3 style="margin-top:0; font-size: 0.9rem; text-transform: uppercase; color: #475569;">30-Day Water Quality Trends</h3>
                    <img src="${img30d}" style="width: 100%; height: auto;" />
                </div>
                <div class="print-card" style="border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;">
                    <h3 style="margin-top:0; font-size: 0.9rem; text-transform: uppercase; color: #475569;">Monthly Habitability Score</h3>
                    <div style="font-size: 3rem; font-weight: 700; color: #10b981; font-family: monospace;">
                        ${document.getElementById('monthlyPhiVal')?.textContent || '--'}
                    </div>
                    <div style="font-size: 0.9rem; font-weight: 700; color: #475569; text-transform: uppercase;">
                        ${document.getElementById('monthlyPhiVerdict')?.textContent || '--'}
                    </div>
                </div>
            </div>
            <div class="print-grid" style="display: grid; grid-template-columns: 1fr; gap: 20px; margin-top: 20px;">
                <div class="print-card" style="border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px;">
                    <h3 style="margin-top:0; font-size: 0.9rem; text-transform: uppercase; color: #475569;">Status Distribution (Past 30 Days)</h3>
                    <img src="${imgDoughnut}" style="width: 100%; max-width: 300px; height: auto; margin: 0 auto; display: block;" />
                </div>
            </div>
        `;
    }
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
        <head>
            <title>Ceres Water Quality Report - ${deviceName}</title>
            <style>
                body {
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    color: #1e293b;
                    background-color: #ffffff;
                    padding: 40px;
                    margin: 0;
                }
                .report-header {
                    border-bottom: 2px solid #e2e8f0;
                    padding-bottom: 15px;
                    margin-bottom: 25px;
                }
                .report-title {
                    font-size: 1.5rem;
                    text-transform: uppercase;
                    color: #0f172a;
                    margin: 0 0 5px 0;
                    letter-spacing: 0.5px;
                }
                .report-metadata {
                    font-size: 0.82rem;
                    color: #64748b;
                }
                .report-metadata strong {
                    color: #0f172a;
                }
                .section-title {
                    font-size: 0.95rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: #475569;
                    margin-top: 30px;
                    margin-bottom: 12px;
                    letter-spacing: 0.5px;
                    border-left: 3px solid #10b981;
                    padding-left: 8px;
                }
                .assessment-card {
                    background-color: #f8fafc;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    padding: 20px;
                    margin-bottom: 25px;
                }
                .ai-assessment-verdict {
                    font-size: 1rem;
                    font-weight: 700;
                    margin-bottom: 10px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .ai-assessment-analysis {
                    font-size: 0.88rem;
                    line-height: 1.6;
                    color: #334155;
                    margin-bottom: 15px;
                }
                .ai-assessment-recs-title {
                    font-size: 0.82rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    color: #475569;
                    margin-bottom: 8px;
                }
                .ai-assessment-recs-list {
                    margin: 0;
                    padding-left: 20px;
                    font-size: 0.85rem;
                    color: #334155;
                    line-height: 1.5;
                }
                @media print {
                    body {
                        padding: 0;
                    }
                    .print-card {
                        page-break-inside: avoid;
                    }
                }
            </style>
        </head>
        <body>
            <div class="report-header">
                <h1 class="report-title">${range === 'weekly' ? 'Weekly' : 'Monthly'} Water Quality Assessment Report</h1>
                <div class="report-metadata">
                    Device Name: <strong>${deviceName}</strong> &nbsp;|&nbsp;
                    Device ID: <strong>${deviceId}</strong> &nbsp;|&nbsp;
                    Report Generated: <strong>${reportTime}</strong> &nbsp;|&nbsp;
                    Report Accessed: <strong>${new Date().toLocaleString()} UTC</strong>
                </div>
            </div>
            
            <div class="section-title">Biological Evaluation (Nile Tilapia Focus)</div>
            <div class="assessment-card">
                ${aiAssessmentHtml}
            </div>
            
            <div class="section-title">Water Parameter Trends &amp; Graphics</div>
            ${chartImagesHtml}
            
            <script>
                window.onload = function() {
                    setTimeout(function() {
                        window.print();
                    }, 800);
                };
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// ─── SYSTEM-WIDE AI DIAGNOSTICS ──────────────────────────────────────────
async function updateSystemAiDiagnostics() {
    try {
        const response = await fetch('/api/ai/system_interpretation');
        if (!response.ok) return;
        const data = await response.json();
        
        // Update parameter values
        setText('sysAvgTemp', (data.temp?.toFixed(1) ?? '--') + ' °C');
        setText('sysAvgPh',   data.ph?.toFixed(2) ?? '--');
        setText('sysAvgHs',   (data.hs_nh3?.toFixed(2) ?? '--') + ' ppm');
        setText('sysAvgNh3',  (data.nh3?.toFixed(4) ?? '--') + ' mg/L');
        setText('sysAvgPhi',  data.phi?.toFixed(1) ?? '--');
        setText('sysAvgSurvival', (data.survival_rate?.toFixed(1) ?? '--') + ' %');
        
        // Update Badge
        const badge = document.getElementById('systemAiStatusBadge');
        if (badge && data.status) {
            badge.textContent = data.status.toUpperCase();
            badge.className = `status-badge ${data.status === 'Optimal' ? 'optimal' : data.status === 'Harmful' ? 'harmful' : 'deadly'}`;
        }
        
        // Update AI Verdict and Analysis text
        setText('sysAiVerdict', data.verdict);
        setText('sysAiAnalysis', data.analysis);
        
        // Update AI Recommendations
        const recList = document.getElementById('sysAiRecommendations');
        if (recList && data.recommendations) {
            recList.innerHTML = data.recommendations.map(rec => `<li>${rec}</li>`).join('');
        }
    } catch (e) {
        console.error('Failed to fetch system-wide AI diagnostics:', e);
    }
}

// ─── ACTIVE DEVICE CAROUSEL ───────────────────────────────────────────────
function initDeviceDropdown() {
    const dropdown = document.getElementById('vesselSelectDropdown');
    if (!dropdown) return;

    dropdown.addEventListener('change', (e) => {
        window.selectDeviceDropdown(e.target.value);
    });
}

function updateDeviceDropdown(fleetData, activeVid) {
    const vessels = Array.isArray(fleetData) ? fleetData : Object.values(fleetData);
    if (!vessels.length) return;

    const optionsHtml = vessels.map(v => {
        const isStation = (v.device_type === 'charging_station');
        const typeLabel = isStation ? '⚡ Station' : '🚢 Vessel';
        const statusText = v.online ? '(Online)' : '(Offline)';
        return `<option value="${v.vessel_id}">${typeLabel}: ${v.name || v.vessel_id} ${statusText}</option>`;
    }).join('');

    // Update main vessel dropdown (in header/base)
    const dropdown = document.getElementById('vesselSelectDropdown');
    if (dropdown) {
        if (dropdown.innerHTML !== optionsHtml) dropdown.innerHTML = optionsHtml;
        dropdown.value = activeVid;
    }

    // Also update HUD vessel dropdown on dashboard page
    const hudSel = document.getElementById('vesselSelectDropdown');
    // (same element — already handled above)
}

window.selectDeviceDropdown = async function(vesselId) {
    activeVesselId = vesselId;
    lastParamUpdateTime = 0;
    
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'select_vessel', vessel_id: vesselId }));
    }
    try { await fetch(`/api/fleet/select/${vesselId}`); } catch(_) {}

    if (lastFleetData) {
        updateDeviceDropdown(lastFleetData, vesselId);
        const active = lastFleetData[vesselId];
        if (active) handleActiveTelemetry(active);
    }
    
    if (typeof window.updateHeatmap === 'function') {
        const paramSelect = document.getElementById('heatmapParamSelect');
        const param = paramSelect ? paramSelect.value : 'hs_nh3';
        window.updateHeatmap('consolidated', param);
    }
};

