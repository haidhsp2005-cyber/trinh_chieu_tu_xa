// STUDENT VIEWER SCRIPT
let ws = null;
let sessionState = {};

const canvas = document.getElementById('paint-canvas');
const ctx = canvas.getContext('2d');
const stageWrapper = document.getElementById('stage-wrapper');
const laserDot = document.getElementById('laser-dot');

function init() {
    if (typeof window !== 'undefined' && window.INITIAL_SESSION) {
        sessionState = window.INITIAL_SESSION;
    } else if (typeof INITIAL_SESSION !== 'undefined') {
        sessionState = INITIAL_SESSION;
    }

    if (sessionState && sessionState.doc_data) {
        if (sessionState.doc_data.format === 'pptx') {
            currentFitMode = 'page';
        }
        document.getElementById('room-title-text').textContent = sessionState.title || "Lớp học trực tuyến";
        document.title = sessionState.title || "Lớp học trực tuyến";
        renderPage(sessionState.current_page || 1);
        if (sessionState.drawings) {
            redrawAllStrokes(sessionState.drawings);
        }
        if (sessionState.mode) {
            switchDisplayMode(sessionState.mode);
        }
    }

    setupCanvasResolution();
    window.addEventListener('resize', setupCanvasResolution);
    connectWebSocket();
}

function setupCanvasResolution() {
    const rect = stageWrapper.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    if (sessionState.drawings) {
        redrawAllStrokes(sessionState.drawings);
    }
}

// ----------------- WEBSOCKET REALTIME SYNC -----------------

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${ROOM_ID}/student`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log("WebSocket connected as Student");
        updateSyncStatus(true);
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        // 1. Initial State from Teacher
        if (msg.type === 'INIT_STATE') {
            sessionState = msg.state || {};
            if (sessionState && sessionState.doc_data && sessionState.doc_data.format === 'pptx') {
                currentFitMode = 'page';
            }
            document.getElementById('room-title-text').textContent = sessionState.title || "Lớp học trực tuyến";
            document.title = sessionState.title || "Lớp học trực tuyến";
            
            renderPage(sessionState.current_page || 1);
            if (sessionState.drawings) {
                redrawAllStrokes(sessionState.drawings);
            }
            if (sessionState.mode) {
                switchDisplayMode(sessionState.mode);
            }
        }

        // 2. Teacher Changed Page
        else if (msg.type === 'PAGE_CHANGE') {
            sessionState.current_page = msg.page;
            sessionState.drawings = [];
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            laserDot.classList.add('hidden');
            renderPage(msg.page);
        }

        // 3. Teacher Moved Laser Pointer
        else if (msg.type === 'LASER_MOVE') {
            const laser = msg.laser;
            if (laser && laser.active && laser.x >= 0 && laser.y >= 0) {
                const rect = stageWrapper.getBoundingClientRect();
                laserDot.style.left = `${laser.x * rect.width}px`;
                laserDot.style.top = `${laser.y * rect.height}px`;
                laserDot.classList.remove('hidden');
            } else {
                laserDot.classList.add('hidden');
            }
        }

        // 4. Teacher Drew a Stroke
        else if (msg.type === 'DRAW_STROKE') {
            if (!sessionState.drawings) sessionState.drawings = [];
            sessionState.drawings.push(msg.stroke);
            drawSingleStroke(msg.stroke);
        }

        // 5. Teacher Cleared Drawings
        else if (msg.type === 'CLEAR_DRAWINGS') {
            sessionState.drawings = [];
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        // 6. Teacher Switched Mode (Slides <-> Screen Share)
        else if (msg.type === 'SWITCH_MODE') {
            sessionState.mode = msg.mode;
            switchDisplayMode(msg.mode);
        }

        // 7. Teacher Zoomed or Changed Fit Mode
        else if (msg.type === 'ZOOM_SYNC') {
            applyZoomAndFit(msg.zoom, msg.fit_mode);
        }

        // 8. Teacher Scrolled PDF Page
        else if (msg.type === 'SCROLL_SYNC') {
            const scrollCont = document.getElementById('stage-scroll-container');
            if (scrollCont) {
                const maxScroll = scrollCont.scrollHeight - scrollCont.clientHeight;
                if (maxScroll > 0) {
                    scrollCont.scrollTop = msg.ratio * maxScroll;
                }
            }
        }
    };

    ws.onclose = () => {
        updateSyncStatus(false);
        console.warn("WebSocket closed, reconnecting in 2s...");
        setTimeout(connectWebSocket, 2000);
    };
}

function updateSyncStatus(connected) {
    const el = document.getElementById('sync-status');
    if (connected) {
        el.className = "text-[11px] text-emerald-400 font-semibold flex items-center space-x-1";
        el.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> <span class="hidden sm:inline">Đã đồng bộ</span>`;
    } else {
        el.className = "text-[11px] text-amber-400 font-semibold flex items-center space-x-1";
        el.innerHTML = `<i class="fa-solid fa-rotate fa-spin"></i> <span class="hidden sm:inline">Đang kết nối lại...</span>`;
    }
}

let currentZoom = 1.0;
let currentFitMode = 'width';

function applyZoomAndFit(zoom = currentZoom, fitMode = currentFitMode) {
    currentZoom = zoom;
    currentFitMode = fitMode;

    const stage = document.getElementById('stage-wrapper');
    const img = document.getElementById('slide-img');

    if (currentFitMode === 'width') {
        if (stage) {
            const widthClass = currentZoom >= 2.0 ? 'max-w-7xl' : (currentZoom >= 1.5 ? 'max-w-6xl' : (currentZoom >= 1.25 ? 'max-w-5xl' : 'max-w-4xl'));
            stage.className = `relative w-full ${widthClass} bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col items-center justify-start border border-slate-800 transition-all duration-150 my-2`;
        }
        if (img) {
            img.style.width = '100%';
            img.style.maxWidth = '100%';
            img.style.maxHeight = 'none';
            img.style.height = 'auto';
        }
    } else {
        if (stage) {
            stage.className = `relative max-h-[calc(100vh-120px)] w-fit max-w-[95vw] bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col items-center justify-center border border-slate-800 transition-all duration-150 my-auto`;
        }
        if (img) {
            img.style.width = 'auto';
            img.style.maxWidth = 'calc(100vw - 40px)';
            img.style.maxHeight = 'calc(100vh - 130px)';
            img.style.height = 'auto';
        }
    }

    setTimeout(setupCanvasResolution, 60);
}

// ----------------- RENDER SLIDE -----------------

function renderPage(pageNum) {
    const doc = sessionState.doc_data;
    document.getElementById('current-page-text').textContent = pageNum;

    if (!doc || !doc.pages || doc.pages.length === 0) {
        document.getElementById('slide-img').classList.add('hidden');
        document.getElementById('slide-card').classList.add('hidden');
        document.getElementById('waiting-notice').classList.remove('hidden');
        document.getElementById('total-page-text').textContent = "1";
        return;
    }

    const total = doc.total_pages;
    document.getElementById('total-page-text').textContent = total;
    document.getElementById('waiting-notice').classList.add('hidden');

    const pageData = doc.pages[pageNum - 1];

    if (doc.mode === 'image') {
        const img = document.getElementById('slide-img');
        img.src = pageData.image_url;
        img.classList.remove('hidden');
        document.getElementById('slide-card').classList.add('hidden');
        img.onload = () => {
            applyZoomAndFit();
            setupCanvasResolution();
        };
        applyZoomAndFit();
    } else {
        document.getElementById('slide-img').classList.add('hidden');
        const card = document.getElementById('slide-card');
        card.classList.remove('hidden');

        document.getElementById('card-title').textContent = pageData.title || `Slide ${pageNum}`;
        document.getElementById('card-page-indicator').textContent = `Trang ${pageNum} / ${total}`;

        const bulletsList = document.getElementById('card-bullets');
        bulletsList.innerHTML = '';
        const bullets = pageData.bullets || [];
        bullets.forEach(b => {
            const li = document.createElement('li');
            li.className = "flex items-start space-x-3 bg-white/70 p-3 rounded-xl border border-slate-100 shadow-sm";
            li.innerHTML = `<span class="w-3 h-3 rounded-full bg-blue-600 mt-1 shrink-0"></span><span class="leading-relaxed font-semibold text-slate-800">${b}</span>`;
            bulletsList.appendChild(li);
        });

        currentFitMode = 'page';
        applyZoomAndFit();
    }
}

function switchDisplayMode(mode) {
    const video = document.getElementById('screen-video');
    const slideCont = document.getElementById('slide-container');

    if (mode === 'screen') {
        video.classList.remove('hidden');
        slideCont.classList.add('hidden');
    } else {
        video.classList.add('hidden');
        slideCont.classList.remove('hidden');
    }
}

// ----------------- DRAWINGS REPLAY -----------------

function drawSingleStroke(s) {
    if (!s || !s.points || s.points.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color || '#ef4444';
    ctx.lineWidth = s.size || 3;

    ctx.beginPath();
    ctx.moveTo(s.points[0].x * canvas.width, s.points[0].y * canvas.height);
    for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x * canvas.width, s.points[i].y * canvas.height);
    }
    ctx.stroke();
    ctx.restore();
}

function redrawAllStrokes(strokes) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!strokes) return;
    strokes.forEach(s => drawSingleStroke(s));
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
