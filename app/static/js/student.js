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
        if (sessionState.mic_active !== undefined) {
            updateStudentAudioUI(sessionState.mic_active);
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
            if (sessionState.mic_active !== undefined) {
                updateStudentAudioUI(sessionState.mic_active);
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

        // 9. Nhận khung hình chia sẻ màn hình trực tiếp từ Giáo viên
        else if (msg.type === 'SCREEN_FRAME') {
            const screenCont = document.getElementById('screen-share-container');
            const slideCont = document.getElementById('slide-container');
            const screenImg = document.getElementById('screen-frame-img');
            const loading = document.getElementById('screen-share-loading');

            if (screenCont && slideCont && screenImg) {
                if (screenCont.classList.contains('hidden')) {
                    screenCont.classList.remove('hidden');
                    slideCont.classList.add('hidden');
                }
                if (loading) loading.classList.add('hidden');
                screenImg.src = msg.frame;
            }
        }

        // 10. Trạng thái bật/tắt Micro của Thầy/Cô
        else if (msg.type === 'MIC_STATUS') {
            sessionState.mic_active = !!msg.active;
            updateStudentAudioUI(msg.active);
            if (!msg.active) {
                nextAudioPlayTime = 0;
            }
        }

        // 11. Nhận gói âm thanh giọng nói trực tiếp từ Thầy/Cô
        else if (msg.type === 'AUDIO_CHUNK') {
            handleIncomingAudioChunk(msg);
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
let currentFitMode = 'contain'; // 'contain' (vừa toàn màn hình, tràn đẹp khi xoay ngang) hoặc 'width' (tràn bề ngang, cuộn dọc)
let isForceRotated = false;

function applyZoomAndFit(zoom = currentZoom, fitMode = currentFitMode) {
    currentZoom = zoom;
    currentFitMode = fitMode;

    const stage = document.getElementById('stage-wrapper');
    const img = document.getElementById('slide-img');
    const scrollContainer = document.getElementById('stage-scroll-container');
    const zoomText = document.getElementById('student-zoom-text');
    const btnFit = document.getElementById('btn-fit-toggle');

    if (zoomText) zoomText.textContent = `${Math.round(currentZoom * 100)}%`;

    const isLandscape = window.innerWidth > window.innerHeight;
    const isMobile = window.innerWidth <= 900 || window.innerHeight <= 600;

    if (btnFit) {
        if (currentFitMode === 'width') {
            btnFit.className = "w-7 h-7 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs";
            btnFit.title = "Đang: Tràn bề ngang (Bấm để Vừa toàn màn hình)";
        } else {
            btnFit.className = "w-7 h-7 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs";
            btnFit.title = "Đang: Vừa toàn màn hình (Bấm để Tràn bề ngang)";
        }
    }

    // 1. KHI ĐIỆN THOẠI XOAY NGANG (MOBILE LANDSCAPE)
    if (isMobile && isLandscape) {
        if (scrollContainer) {
            scrollContainer.className = "relative w-full h-full overflow-y-auto overflow-x-hidden flex justify-center items-center custom-scroll p-0 m-0";
        }
        
        if (currentFitMode === 'contain' || currentFitMode === 'page') {
            // Vừa toàn màn hình trong chế độ xoay ngang: không viền, không mép thừa, tràn sát cạnh
            if (stage) {
                stage.className = `relative w-auto h-auto max-w-full max-h-full bg-white text-slate-900 rounded-none shadow-none overflow-hidden flex flex-col items-center justify-center border-0 transition-all duration-150 m-0 p-0`;
            }
            if (img) {
                const headerFooterOffset = document.fullscreenElement ? '0px' : '3.4rem';
                img.style.width = 'auto';
                img.style.height = 'auto';
                img.style.maxWidth = `${Math.round(100 * currentZoom)}vw`;
                img.style.maxHeight = `calc((100dvh - ${headerFooterOffset}) * ${currentZoom})`;
                img.style.objectFit = 'contain';
            }
        } else {
            // Chế độ tràn bề ngang khi xoay ngang
            if (stage) {
                stage.className = `relative w-full max-w-full bg-white text-slate-900 rounded-none shadow-none overflow-hidden flex flex-col items-center justify-start border-0 transition-all duration-150 m-0 p-0`;
            }
            if (img) {
                img.style.width = `${Math.round(100 * currentZoom)}%`;
                img.style.maxWidth = 'none';
                img.style.maxHeight = 'none';
                img.style.height = 'auto';
                img.style.objectFit = 'fill';
            }
        }
    }
    // 2. KHI Ở MÀN HÌNH DỌC (PORTRAIT) HOẶC MÁY TÍNH (DESKTOP)
    else {
        if (scrollContainer) {
            scrollContainer.className = "relative w-full h-full overflow-y-auto overflow-x-hidden flex justify-center items-start custom-scroll p-0 sm:p-2";
        }

        if (currentFitMode === 'width') {
            if (stage) {
                const widthClass = currentZoom >= 2.0 ? 'max-w-7xl' : (currentZoom >= 1.5 ? 'max-w-6xl' : (currentZoom >= 1.25 ? 'max-w-5xl' : 'max-w-4xl'));
                stage.className = `relative w-full ${widthClass} bg-white text-slate-900 sm:rounded-2xl rounded-none shadow-2xl overflow-hidden flex flex-col items-center justify-start border-0 sm:border border-slate-800 transition-all duration-150 sm:my-2 my-0`;
            }
            if (img) {
                img.style.width = '100%';
                img.style.maxWidth = '100%';
                img.style.maxHeight = 'none';
                img.style.height = 'auto';
                img.style.objectFit = 'fill';
            }
        } else {
            if (stage) {
                stage.className = `relative max-h-[calc(100dvh-5rem)] w-auto max-w-full bg-white text-slate-900 sm:rounded-2xl rounded-none shadow-2xl overflow-hidden flex flex-col items-center justify-center border-0 sm:border border-slate-800 transition-all duration-150 my-auto`;
            }
            if (img) {
                img.style.width = 'auto';
                img.style.maxWidth = '100vw';
                img.style.maxHeight = `calc((100dvh - 5.5rem) * ${currentZoom})`;
                img.style.height = 'auto';
                img.style.objectFit = 'contain';
            }
        }
    }

    if (stage) {
        if (isForceRotated) {
            stage.classList.add('force-rotated-landscape');
        } else {
            stage.classList.remove('force-rotated-landscape');
        }
    }

    setTimeout(setupCanvasResolution, 80);
}

function studentZoom(delta) {
    currentZoom = Math.max(0.75, Math.min(2.5, currentZoom + delta));
    applyZoomAndFit(currentZoom, currentFitMode);
}

function studentResetZoom() {
    currentZoom = 1.0;
    applyZoomAndFit(1.0, currentFitMode);
}

function toggleStudentFitMode() {
    currentFitMode = (currentFitMode === 'contain' || currentFitMode === 'page') ? 'width' : 'contain';
    applyZoomAndFit(currentZoom, currentFitMode);
}

function toggleRotateOrLandscape() {
    // Đảo trạng thái xoay ngang cưỡng bức
    isForceRotated = !isForceRotated;
    const stage = document.getElementById('stage-wrapper');
    const container = document.getElementById('stage-scroll-container');

    if (stage) {
        if (isForceRotated) {
            stage.classList.add('force-rotated-landscape');
            if (container) container.classList.add('overflow-hidden');
        } else {
            stage.classList.remove('force-rotated-landscape');
            if (container) container.classList.remove('overflow-hidden');
        }
    }
    applyZoomAndFit(currentZoom, currentFitMode);
    setupCanvasResolution();
}

// Double tap on mobile to zoom
let lastTap = 0;
document.addEventListener('touchend', (e) => {
    if (!e.target.closest('#stage-wrapper')) return;
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 350 && tapLength > 0) {
        if (currentZoom > 1.1) {
            studentResetZoom();
        } else {
            studentZoom(0.5);
        }
    }
    lastTap = currentTime;
});

function handleOrientationOrResize() {
    // Nếu người dùng thực sự xoay ngang điện thoại vật lý, tắt xoay cưỡng bức vì layout đã tự tràn ngang
    if (window.innerWidth > window.innerHeight && isForceRotated) {
        isForceRotated = false;
        const stage = document.getElementById('stage-wrapper');
        if (stage) stage.classList.remove('force-rotated-landscape');
        const container = document.getElementById('stage-scroll-container');
        if (container) container.classList.remove('overflow-hidden');
    }
    applyZoomAndFit(currentZoom, currentFitMode);
    setupCanvasResolution();
}

window.addEventListener('orientationchange', handleOrientationOrResize);
window.addEventListener('resize', handleOrientationOrResize);

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
    const screenCont = document.getElementById('screen-share-container');
    const slideCont = document.getElementById('slide-container');
    const loading = document.getElementById('screen-share-loading');

    if (mode === 'screen') {
        if (screenCont) screenCont.classList.remove('hidden');
        if (slideCont) slideCont.classList.add('hidden');
        if (loading) loading.classList.remove('hidden');
    } else {
        if (screenCont) screenCont.classList.add('hidden');
        if (slideCont) slideCont.classList.remove('hidden');
        if (loading) loading.classList.add('hidden');
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

// ----------------- REAL-TIME AUDIO BROADCAST RECEIVER (PCM WEB AUDIO) -----------------
let studentAudioCtx = null;
let isStudentMuted = false;
let audioUnlocked = false;
let nextAudioPlayTime = 0;

function initOrResumeStudentAudioContext() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            if (!studentAudioCtx) {
                studentAudioCtx = new AudioCtx();
            }
            if (studentAudioCtx.state === 'suspended') {
                studentAudioCtx.resume().catch(() => {});
            }
        }
    } catch (e) {
        console.warn("AudioContext init error:", e);
    }
}

function unlockStudentAudio() {
    audioUnlocked = true;
    const prompt = document.getElementById('mobile-unmute-prompt');
    if (prompt) {
        prompt.classList.add('hidden');
        prompt.style.display = 'none';
    }

    initOrResumeStudentAudioContext();
    updateStudentAudioUI();
    console.log("Audio pipeline successfully unlocked on student device!");
}

// Tự động mở khoá Audio ngay khi học sinh chạm hoặc nhấp bất cứ đâu trên trang
document.addEventListener('click', () => {
    if (!audioUnlocked) unlockStudentAudio();
}, { passive: true });
document.addEventListener('touchstart', () => {
    if (!audioUnlocked) unlockStudentAudio();
}, { passive: true });

function toggleStudentAudioMute() {
    if (!audioUnlocked) {
        unlockStudentAudio();
        return;
    }
    isStudentMuted = !isStudentMuted;
    if (isStudentMuted) {
        nextAudioPlayTime = 0;
    }
    updateStudentAudioUI();
}

function updateStudentAudioUI(micActive = null) {
    const btn = document.getElementById('btn-student-audio-toggle');
    const icon = document.getElementById('student-speaker-icon');
    const text = document.getElementById('student-speaker-text');
    const prompt = document.getElementById('mobile-unmute-prompt');
    if (!btn) return;

    const isTeacherSpeaking = micActive !== null ? micActive : (sessionState && sessionState.mic_active);

    if (!isTeacherSpeaking) {
        btn.classList.add('hidden');
        btn.classList.remove('flex');
        if (prompt) {
            prompt.classList.add('hidden');
            prompt.style.display = 'none';
        }
        return;
    }

    btn.classList.remove('hidden');
    btn.classList.add('flex');

    if (!audioUnlocked && prompt) {
        prompt.classList.remove('hidden');
        prompt.style.display = 'flex';
    }

    if (isStudentMuted) {
        btn.className = "flex px-2 py-1 bg-rose-950/80 border border-rose-500/60 rounded-full text-[10px] text-rose-300 font-bold items-center space-x-1.5 shrink-0 transition hover:bg-rose-900/80 cursor-pointer";
        if (icon) icon.className = "fa-solid fa-volume-xmark text-rose-400";
        if (text) text.textContent = "Đã tắt tiếng";
    } else {
        btn.className = "flex px-2 py-1 bg-emerald-950/80 border border-emerald-500/60 rounded-full text-[10px] text-emerald-300 font-bold items-center space-x-1.5 shrink-0 transition hover:bg-emerald-900/80 cursor-pointer";
        if (icon) icon.className = "fa-solid fa-volume-high text-emerald-400 animate-pulse";
        if (text) text.textContent = "Tiếng Thầy/Cô";
    }
}

function handleIncomingAudioChunk(msg) {
    if (isStudentMuted || !msg) return;

    // Hiển thị nút bật tiếng nếu chưa được mở khoá trên điện thoại
    if (!audioUnlocked) {
        const prompt = document.getElementById('mobile-unmute-prompt');
        if (prompt) {
            prompt.classList.remove('hidden');
            prompt.style.display = 'flex';
        }
        return;
    }

    initOrResumeStudentAudioContext();
    if (!studentAudioCtx) return;

    const pcmBase64 = msg.pcm;
    if (!pcmBase64) return;

    try {
        const binaryStr = atob(pcmBase64);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768.0;
        }

        const sampleRate = msg.sample_rate || 16000;
        const audioBuffer = studentAudioCtx.createBuffer(1, float32.length, sampleRate);
        audioBuffer.copyToChannel(float32, 0);

        const source = studentAudioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(studentAudioCtx.destination);

        const now = studentAudioCtx.currentTime;
        if (nextAudioPlayTime < now || (nextAudioPlayTime - now) > 0.35) {
            nextAudioPlayTime = now + 0.04;
        }

        source.start(nextAudioPlayTime);
        nextAudioPlayTime += audioBuffer.duration;
    } catch (e) {
        console.warn("PCM audio decode/playback error:", e);
    }
}
window.unlockStudentAudio = unlockStudentAudio;
window.toggleStudentAudioMute = toggleStudentAudioMute;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
