// STUDENT VIEWER SCRIPT
let ws = null;
let sessionState = {};

const canvas = document.getElementById('paint-canvas');
const ctx = canvas.getContext('2d');
const stageWrapper = document.getElementById('stage-wrapper');
const laserDot = document.getElementById('laser-dot');

let targetActiveTeacherRoom = null;
let isStudentChatAllowed = false;
let isStudentMicAllowed = false;

function redirectToActiveTeacherRoom() {
    if (targetActiveTeacherRoom) {
        window.location.href = `/view/${targetActiveTeacherRoom}`;
    }
}
window.redirectToActiveTeacherRoom = redirectToActiveTeacherRoom;

function init() {
    try {
        if (typeof window !== 'undefined' && window.INITIAL_SESSION) {
            sessionState = window.INITIAL_SESSION;
        } else if (typeof INITIAL_SESSION !== 'undefined') {
            sessionState = INITIAL_SESSION;
        }

        updateStudentNameUI();

        if (sessionState && sessionState.is_active === false) {
            showSessionEndedScreen(sessionState.title || "Bài giảng trực tuyến");
        } else if (sessionState && sessionState.doc_data) {
            const d = sessionState.doc_data;
            if (d.format === 'pptx' || d.format === 'image' || (d.pages && d.pages[0] && d.pages[0].aspect_ratio === '16:9')) {
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
            if (sessionState.chat_messages) {
                loadInitialStudentChatMessages(sessionState.chat_messages);
            }
            if (sessionState.speaking_student) {
                handlePeerStudentMicStatus(sessionState.speaking_student.id, sessionState.speaking_student.name, true);
            }
        }

        updateStudentChatLockUI(sessionState ? !!sessionState.chat_enabled : false);
        updateStudentMicLockUI(sessionState ? !!sessionState.student_mic_allowed : false);

        setupCanvasResolution();
        window.addEventListener('resize', setupCanvasResolution);
    } catch (e) {
        console.warn("Init setup warning:", e);
    }
    connectWebSocket();
}

function setupCanvasResolution() {
    if (!stageWrapper || !canvas) return;
    const rect = stageWrapper.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.round(rect.width);
        canvas.height = Math.round(rect.height);
        if (sessionState && sessionState.drawings) {
            redrawAllStrokes(sessionState.drawings);
        }
    }
}

// ----------------- WEBSOCKET REALTIME SYNC -----------------
let reconnectTimer = null;

function connectWebSocket() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    if (ws) {
        try {
            ws.onopen = null;
            ws.onmessage = null;
            ws.onerror = null;
            ws.onclose = null;
            ws.close();
        } catch (e) {}
        ws = null;
    }

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
            ownClientId = msg.client_id;
            sessionState = msg.state || {};
            if (sessionState.is_active === false) {
                showSessionEndedScreen(sessionState.title || "Bài giảng trực tuyến");
                return;
            } else {
                hideSessionEndedScreen();
            }
            if (sessionState && sessionState.doc_data) {
                const d = sessionState.doc_data;
                if (d.format === 'pptx' || d.format === 'image' || (d.pages && d.pages[0] && d.pages[0].aspect_ratio === '16:9')) {
                    currentFitMode = 'page';
                }
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
            if (sessionState.chat_messages) {
                loadInitialStudentChatMessages(sessionState.chat_messages);
            }
            if (sessionState.speaking_student) {
                handlePeerStudentMicStatus(sessionState.speaking_student.id, sessionState.speaking_student.name, true);
            }

            updateStudentChatLockUI(sessionState ? !!sessionState.chat_enabled : false);
            updateStudentMicLockUI(sessionState ? !!sessionState.student_mic_allowed : false);

            // Kiểm tra nếu học sinh mở link bài cũ trong khi Thầy/Cô đang ở bài mới
            if (msg.is_old_link && msg.active_teacher_room) {
                targetActiveTeacherRoom = msg.active_teacher_room;
                const notice = document.getElementById('old-link-notice');
                const titleEl = document.getElementById('active-lesson-name');
                if (titleEl) titleEl.textContent = msg.active_teacher_title || 'Bài giảng đang diễn ra';
                if (notice) notice.classList.remove('hidden');
            } else {
                const notice = document.getElementById('old-link-notice');
                if (notice) notice.classList.add('hidden');
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

        // 12. Tin nhắn Trò chuyện / Hỏi đáp (Chat Realtime)
        else if (msg.type === 'CHAT_MESSAGE') {
            handleIncomingStudentChatMessage(msg.message);
        }

        // 13. Học sinh khác phát biểu (Micro trạng thái)
        else if (msg.type === 'STUDENT_MIC_STATUS') {
            handlePeerStudentMicStatus(msg.student_id, msg.student_name, msg.active);
        }

        // 14. Nhận âm thanh micro từ bạn học sinh khác phát biểu
        else if (msg.type === 'STUDENT_AUDIO_CHUNK') {
            if (msg.student_id !== ownClientId) {
                handleIncomingAudioChunk(msg);
            }
        }

        // 15. Giáo viên tắt micro học sinh cưỡng bức
        else if (msg.type === 'FORCE_MUTE') {
            handleForceMute(msg);
        }

        // 16. Giáo viên chủ động kết thúc và tắt bài giảng
        else if (msg.type === 'TEACHER_EXITED') {
            sessionState.is_active = false;
            showSessionEndedScreen(sessionState.title || "Bài giảng trực tuyến");
        }

        // 17. Giáo viên mở lại hoặc bắt đầu bài giảng
        else if (msg.type === 'TEACHER_STARTED_SESSION') {
            sessionState = msg.state || sessionState;
            sessionState.is_active = true;
            hideSessionEndedScreen();
            if (sessionState && sessionState.doc_data) {
                renderPage(sessionState.current_page || 1);
                if (sessionState.drawings) {
                    redrawAllStrokes(sessionState.drawings);
                }
                if (sessionState.mode) {
                    switchDisplayMode(sessionState.mode);
                }
            }
        }

        // 18. Trạng thái Bật/Tắt Khung Chat từ Giáo viên
        else if (msg.type === 'CHAT_LOCK_STATUS') {
            sessionState.chat_enabled = !!msg.chat_enabled;
            updateStudentChatLockUI(msg.chat_enabled);
        }

        // 19. Trạng thái Bật/Tắt Micro Học sinh từ Giáo viên
        else if (msg.type === 'STUDENT_MIC_LOCK_STATUS') {
            sessionState.student_mic_allowed = !!msg.allowed;
            updateStudentMicLockUI(msg.allowed);
        }
    };

    ws.onclose = () => {
        updateSyncStatus(false);
        console.warn("WebSocket closed, reconnecting in 2s...");
        if (!reconnectTimer) {
            reconnectTimer = setTimeout(connectWebSocket, 2000);
        }
    };
}

// Tự động kết nối lại ngay khi học sinh quay lại màn hình điện thoại hoặc mở lại tab
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            console.log("Tab resumed, reconnecting WebSocket...");
            connectWebSocket();
        }
    }
});
window.addEventListener('pageshow', () => {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        connectWebSocket();
    }
});
window.addEventListener('pagehide', () => {
    if (isStudentMicActive) {
        toggleStudentMicrophone();
    }
});

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

    if (!doc || !doc.pages || doc.pages.length === 0) {
        document.getElementById('slide-img').classList.add('hidden');
        document.getElementById('slide-card').classList.add('hidden');
        document.getElementById('waiting-notice').classList.remove('hidden');
        document.getElementById('total-page-text').textContent = "1";
        document.getElementById('current-page-text').textContent = "1";
        return;
    }

    const total = doc.total_pages || (doc.pages ? doc.pages.length : 1);
    pageNum = parseInt(pageNum, 10) || 1;
    if (pageNum < 1) pageNum = 1;
    if (pageNum > total) pageNum = total;

    document.getElementById('current-page-text').textContent = pageNum;
    document.getElementById('total-page-text').textContent = total;
    document.getElementById('waiting-notice').classList.add('hidden');

    const pageData = doc.pages[pageNum - 1];
    if (!pageData) return;

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
        // Tiền tải ngầm trang kế tiếp để khi Thầy/Cô chuyển trang là học sinh thấy ngay tức thì 0ms
        if (doc.pages[pageNum]) {
            const preImg = new Image();
            preImg.src = doc.pages[pageNum].image_url;
        }
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
    if (!s || !s.points || s.points.length < 1) return;
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
    if (s.points.length === 1) {
        ctx.lineTo(s.points[0].x * canvas.width + 0.1, s.points[0].y * canvas.height + 0.1);
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
let studentMasterGain = null;
let isStudentMuted = false;
let audioUnlocked = false;
let nextAudioPlayTime = 0;

function initOrResumeStudentAudioContext() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            if (!studentAudioCtx) {
                studentAudioCtx = new AudioCtx();
                studentMasterGain = studentAudioCtx.createGain();
                studentMasterGain.gain.value = 1.6; // Khuếch đại âm lượng giọng nói Thầy/Cô rõ ràng
                studentMasterGain.connect(studentAudioCtx.destination);
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

    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!studentAudioCtx) {
            studentAudioCtx = new AudioCtx();
            studentMasterGain = studentAudioCtx.createGain();
            studentMasterGain.gain.value = 1.6;
            studentMasterGain.connect(studentAudioCtx.destination);
        }
        if (studentAudioCtx.state === 'suspended') {
            studentAudioCtx.resume();
        }
        // Phát một xung đệm âm thanh siêu nhỏ (1 mẫu) để kích hoạt phần cứng âm thanh trên điện thoại iOS & Android
        const silentBuf = studentAudioCtx.createBuffer(1, 1, 22050);
        const src = studentAudioCtx.createBufferSource();
        src.buffer = silentBuf;
        src.connect(studentAudioCtx.destination);
        src.start(0);
    } catch (e) {
        console.warn("AudioContext unlock error:", e);
    }

    nextAudioPlayTime = 0;
    updateStudentAudioUI();
    console.log("Audio pipeline successfully unlocked on student device!");
}

// Tự động mở khoá Audio ngay khi học sinh chạm, click hoặc tương tác bất cứ đâu trên trang
['click', 'touchstart', 'touchend', 'pointerdown', 'mousedown', 'keydown'].forEach(evt => {
    window.addEventListener(evt, () => {
        if (!audioUnlocked || (studentAudioCtx && studentAudioCtx.state === 'suspended')) {
            unlockStudentAudio();
        }
    }, { passive: true });
});

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

    // Chống vọng âm: Khi học sinh đang bật micro phát biểu, tạm dừng phát loa để tránh mic thu lại tiếng từ loa gây hú/vọng
    if (isStudentMicActive) return;

    // Khởi tạo AudioContext nếu chưa có
    if (!studentAudioCtx) {
        initOrResumeStudentAudioContext();
    }

    if (studentAudioCtx && studentAudioCtx.state === 'suspended') {
        studentAudioCtx.resume().catch(() => {});
    }

    // Nếu AudioContext đã ở trạng thái chạy (running) trên máy tính/điện thoại, tự động mở khóa
    if (studentAudioCtx && studentAudioCtx.state === 'running') {
        audioUnlocked = true;
        const prompt = document.getElementById('mobile-unmute-prompt');
        if (prompt) {
            prompt.classList.add('hidden');
            prompt.style.display = 'none';
        }
    } else if (!audioUnlocked) {
        // Chỉ hiện thông báo nếu trình duyệt di động cưỡng bức chặn autoplay
        const prompt = document.getElementById('mobile-unmute-prompt');
        if (prompt) {
            prompt.classList.remove('hidden');
            prompt.style.display = 'flex';
        }
        return;
    }

    const pcmBase64 = msg.pcm;
    if (!pcmBase64) return;

    try {
        const binaryStr = atob(pcmBase64);
        const len = binaryStr.length;
        const samplesCount = Math.floor(len / 2);
        if (samplesCount === 0) return;

        const float32 = new Float32Array(samplesCount);
        for (let i = 0; i < samplesCount; i++) {
            const byteIndex = i * 2;
            let val = binaryStr.charCodeAt(byteIndex) | (binaryStr.charCodeAt(byteIndex + 1) << 8);
            if (val >= 32768) val -= 65536;
            float32[i] = val / 32768.0;
        }

        const sampleRate = msg.sample_rate || 16000;
        const audioBuffer = studentAudioCtx.createBuffer(1, float32.length, sampleRate);
        audioBuffer.copyToChannel(float32, 0);

        const source = studentAudioCtx.createBufferSource();
        source.buffer = audioBuffer;

        if (!studentMasterGain) {
            studentMasterGain = studentAudioCtx.createGain();
            studentMasterGain.gain.value = 1.6;
            studentMasterGain.connect(studentAudioCtx.destination);
        }
        source.connect(studentMasterGain);

        const now = studentAudioCtx.currentTime;
        if (nextAudioPlayTime < now || (nextAudioPlayTime - now) > 0.4) {
            nextAudioPlayTime = now + 0.03;
        }

        source.start(nextAudioPlayTime);
        nextAudioPlayTime += audioBuffer.duration;
    } catch (e) {
        console.warn("PCM audio decode/playback error:", e);
    }
}

// ----------------- TIỆN ÍCH CHAT & DANH TÍNH HỌC SINH -----------------
let ownClientId = null;
let isStudentChatOpen = false;
let studentUnreadChatCount = 0;

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

function getStudentName() {
    let name = localStorage.getItem('student_display_name');
    if (!name || !name.trim()) {
        const randId = Math.floor(1000 + Math.random() * 9000);
        name = 'Học sinh ' + randId;
        localStorage.setItem('student_display_name', name);
    }
    return name;
}

function updateStudentNameUI() {
    const el = document.getElementById('display-student-name');
    if (el) {
        el.textContent = getStudentName();
    }
}

function changeStudentNamePrompt() {
    const currentName = getStudentName();
    const newName = prompt("Nhập họ tên của bạn để hiển thị khi trao đổi / phát biểu:", currentName);
    if (newName && newName.trim()) {
        localStorage.setItem('student_display_name', newName.trim());
        updateStudentNameUI();
    }
}

function toggleStudentChat() {
    const modal = document.getElementById('student-chat-modal');
    if (!modal) return;

    isStudentChatOpen = !isStudentChatOpen;
    if (isStudentChatOpen) {
        modal.classList.remove('hidden');
        studentUnreadChatCount = 0;
        updateStudentChatBadge();
        const msgCont = document.getElementById('student-chat-messages');
        if (msgCont) msgCont.scrollTop = msgCont.scrollHeight;
        const input = document.getElementById('student-chat-input');
        if (input) setTimeout(() => input.focus(), 100);
    } else {
        modal.classList.add('hidden');
    }
}

function updateStudentChatBadge() {
    const badge = document.getElementById('student-chat-badge');
    if (!badge) return;
    if (studentUnreadChatCount > 0 && !isStudentChatOpen) {
        badge.textContent = studentUnreadChatCount > 99 ? '99+' : studentUnreadChatCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function sendStudentChatMessage(e) {
    if (e) e.preventDefault();
    if (!isStudentChatAllowed) {
        alert("Thầy/Cô đang tạm tắt khung chat để lớp tập trung bài giảng.");
        return;
    }
    const input = document.getElementById('student-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'CHAT_MESSAGE',
            text: text,
            sender: getStudentName()
        }));
        input.value = '';
    } else {
        alert("Chưa kết nối tới máy chủ. Vui lòng thử lại sau giây lát.");
    }
}

function loadInitialStudentChatMessages(messages) {
    if (!Array.isArray(messages)) return;
    const cont = document.getElementById('student-chat-messages');
    if (!cont) return;
    const emptyHint = document.getElementById('student-chat-empty-hint');
    if (messages.length > 0 && emptyHint) {
        emptyHint.remove();
    }
    messages.forEach(msg => {
        renderStudentChatMessageItem(msg);
    });
    cont.scrollTop = cont.scrollHeight;
}

function handleIncomingStudentChatMessage(msg) {
    if (!msg) return;
    const emptyHint = document.getElementById('student-chat-empty-hint');
    if (emptyHint) emptyHint.remove();

    renderStudentChatMessageItem(msg);

    if (!isStudentChatOpen) {
        studentUnreadChatCount++;
        updateStudentChatBadge();
    }
}

function renderStudentChatMessageItem(msg) {
    const cont = document.getElementById('student-chat-messages');
    if (!cont) return;

    const isMe = msg.role === 'student' && msg.sender === getStudentName();
    const isTeacher = msg.role === 'teacher';

    const div = document.createElement('div');
    div.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-0.5 text-xs`;

    const senderDisplay = escapeHtml(msg.sender || (isTeacher ? 'Thầy/Cô' : 'Học sinh'));
    const timeDisplay = escapeHtml(msg.time || '');
    const textDisplay = escapeHtml(msg.text || '');

    if (isTeacher) {
        div.innerHTML = `
            <div class="flex items-center space-x-1.5 px-1">
                <span class="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 font-bold text-[10px] rounded border border-amber-500/40">
                    <i class="fa-solid fa-chalkboard-user mr-1"></i>${senderDisplay}
                </span>
                <span class="text-[9px] text-slate-500">${timeDisplay}</span>
            </div>
            <div class="max-w-[85%] bg-amber-950/60 border border-amber-500/50 text-amber-100 rounded-2xl rounded-tl-sm px-3 py-2 shadow-sm leading-relaxed whitespace-pre-wrap break-words">
                ${textDisplay}
            </div>
        `;
    } else if (isMe) {
        div.innerHTML = `
            <div class="flex items-center space-x-1.5 px-1">
                <span class="text-[9px] text-slate-500">${timeDisplay}</span>
                <span class="text-[10px] font-semibold text-cyan-400">Bạn</span>
            </div>
            <div class="max-w-[85%] bg-cyan-600 text-white rounded-2xl rounded-tr-sm px-3 py-2 shadow-sm leading-relaxed whitespace-pre-wrap break-words">
                ${textDisplay}
            </div>
        `;
    } else {
        div.innerHTML = `
            <div class="flex items-center space-x-1.5 px-1">
                <span class="text-[10px] font-semibold text-slate-300">${senderDisplay}</span>
                <span class="text-[9px] text-slate-500">${timeDisplay}</span>
            </div>
            <div class="max-w-[85%] bg-slate-800 border border-slate-700 text-slate-200 rounded-2xl rounded-tl-sm px-3 py-2 shadow-sm leading-relaxed whitespace-pre-wrap break-words">
                ${textDisplay}
            </div>
        `;
    }

    cont.appendChild(div);
    cont.scrollTop = cont.scrollHeight;
}

// ----------------- HỌC SINH PHÁT BIỂU QUA MICROPHONE (16kHz PCM) -----------------
let isStudentMicActive = false;
let isStudentMicToggling = false;
let studentMicStream = null;
let studentMicContext = null;
let studentMicScriptNode = null;
let studentMicSourceNode = null;
let studentMicMuteGain = null;

function downsampleAudioBuffer(buffer, inputRate, outputRate) {
    if (inputRate === outputRate) return buffer;
    const ratio = inputRate / outputRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < result.length) {
        const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
        let accum = 0, count = 0;
        for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
            accum += buffer[i];
            count++;
        }
        result[offsetResult] = count > 0 ? (accum / count) : 0;
        offsetResult++;
        offsetBuffer = nextOffsetBuffer;
    }
    return result;
}

function floatTo16BitPCM(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
}

function int16ToBase64(int16Array) {
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = '';
    const len = bytes.byteLength;
    const chunkSize = 4096;
    for (let i = 0; i < len; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, len)));
    }
    return btoa(binary);
}

function resetStudentMicUI() {
    isStudentMicActive = false;
    const btn = document.getElementById('btn-student-mic');
    const icon = document.getElementById('student-mic-icon');
    const text = document.getElementById('student-mic-text');
    const pulse = document.getElementById('student-mic-pulse');

    if (!isStudentMicAllowed) {
        if (btn) {
            btn.className = "px-2 sm:px-2.5 py-1 bg-slate-800/80 text-slate-400 border border-slate-700/80 rounded-full text-[10px] sm:text-[11px] font-bold flex items-center space-x-1 transition cursor-pointer";
            btn.title = "Micro học sinh đang TẮT (mặc định khi trình chiếu). Khi Thầy/Cô cho phép bạn mới có thể phát biểu.";
        }
        if (icon) icon.className = "fa-solid fa-microphone-slash text-slate-500";
        if (text) text.textContent = "Phát biểu (Tắt)";
    } else {
        if (btn) {
            btn.className = "px-2 sm:px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-full text-[10px] sm:text-[11px] font-bold flex items-center space-x-1 transition cursor-pointer";
            btn.title = "Bật/Tắt Micro để phát biểu trả lời Thầy/Cô";
        }
        if (icon) icon.className = "fa-solid fa-microphone-slash text-slate-400";
        if (text) text.textContent = "Phát biểu";
    }
    if (pulse) pulse.classList.add('hidden');
}

async function toggleStudentMicrophone() {
    if (isStudentMicToggling) return;

    if (!isStudentMicActive && !isStudentMicAllowed) {
        alert("Thầy/Cô đang tạm tắt micro học sinh khi trình chiếu để lớp tập trung bài giảng.\n\nKhi Thầy/Cô cho phép bạn mới có thể bật mic.");
        return;
    }

    isStudentMicToggling = true;

    const btn = document.getElementById('btn-student-mic');
    const icon = document.getElementById('student-mic-icon');
    const text = document.getElementById('student-mic-text');
    const pulse = document.getElementById('student-mic-pulse');

    try {
        if (isStudentMicActive) {
            // Tắt Micro học sinh
            isStudentMicActive = false;

            if (studentMicScriptNode) {
                studentMicScriptNode.onaudioprocess = null;
                try { studentMicScriptNode.disconnect(); } catch (e) {}
                studentMicScriptNode = null;
            }
            if (studentMicSourceNode) {
                try { studentMicSourceNode.disconnect(); } catch (e) {}
                studentMicSourceNode = null;
            }
            if (studentMicMuteGain) {
                try { studentMicMuteGain.disconnect(); } catch (e) {}
                studentMicMuteGain = null;
            }
            if (studentMicStream) {
                studentMicStream.getTracks().forEach(t => t.stop());
                studentMicStream = null;
            }
            if (studentMicContext && studentMicContext.state !== 'closed') {
                try { studentMicContext.close(); } catch (e) {}
                studentMicContext = null;
            }

            resetStudentMicUI();

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'STUDENT_MIC_STATUS',
                    active: false,
                    sender: getStudentName()
                }));
            }
        } else {
            // Bật Micro: đổi UI phản hồi ngay lập tức
            if (icon) icon.className = "fa-solid fa-spinner fa-spin text-amber-400";
            if (text) text.textContent = "Đang mở mic...";

            const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
            if (location.protocol !== 'https:' && !isLocal) {
                alert("Không thể bật Micro qua HTTP (" + location.hostname + ") do trình duyệt chặn bảo mật.\n\n👉 Vui lòng sử dụng đường link HTTPS chính thức hoặc máy chủ localhost để được cấp quyền Micro.");
                resetStudentMicUI();
                return;
            }

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert("Trình duyệt không hỗ trợ API Micro. Vui lòng mở trang trên Google Chrome, Edge hoặc Safari.");
                resetStudentMicUI();
                return;
            }

            studentMicStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                alert("Trình duyệt không hỗ trợ Web Audio API.");
                resetStudentMicUI();
                return;
            }

            studentMicContext = new AudioCtx();
            if (studentMicContext.state === 'suspended') {
                await studentMicContext.resume();
            }

            const inSampleRate = studentMicContext.sampleRate;
            studentMicSourceNode = studentMicContext.createMediaStreamSource(studentMicStream);
            studentMicScriptNode = studentMicContext.createScriptProcessor(4096, 1, 1);

            studentMicScriptNode.onaudioprocess = (e) => {
                if (!isStudentMicActive) return;
                const inputData = e.inputBuffer.getChannelData(0);

                const downsampled = downsampleAudioBuffer(inputData, inSampleRate, 16000);
                const pcm16 = floatTo16BitPCM(downsampled);
                const base64Pcm = int16ToBase64(pcm16);

                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'STUDENT_AUDIO_CHUNK',
                        pcm: base64Pcm,
                        sample_rate: 16000,
                        sender: getStudentName()
                    }));
                }
            };

            // Tránh dội âm ra loa của chính học sinh
            studentMicMuteGain = studentMicContext.createGain();
            studentMicMuteGain.gain.value = 0;

            studentMicSourceNode.connect(studentMicScriptNode);
            studentMicScriptNode.connect(studentMicMuteGain);
            studentMicMuteGain.connect(studentMicContext.destination);

            isStudentMicActive = true;

            if (btn) {
                btn.className = "px-2 sm:px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-full text-[10px] sm:text-[11px] font-bold flex items-center space-x-1 transition shadow-lg shadow-rose-500/30 border border-rose-400 cursor-pointer animate-pulse";
            }
            if (icon) icon.className = "fa-solid fa-microphone text-white";
            if (text) text.textContent = "Đang phát biểu";
            if (pulse) pulse.classList.remove('hidden');

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'STUDENT_MIC_STATUS',
                    active: true,
                    sender: getStudentName()
                }));
            }

            if (studentMicStream.getAudioTracks().length > 0) {
                studentMicStream.getAudioTracks()[0].onended = () => {
                    if (isStudentMicActive) toggleStudentMicrophone();
                };
            }
        }
    } catch (err) {
        console.error("Lỗi cấp quyền Micro học sinh:", err);
        resetStudentMicUI();
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            alert("Bạn đã chặn quyền truy cập Micro.\n\n👉 Hãy bấm vào biểu tượng Ổ khoá hoặc Cài đặt trang web trên thanh địa chỉ, chọn Cho phép (Allow) quyền Micro rồi thử lại!");
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            alert("Không tìm thấy Micro trên thiết bị của bạn. Vui lòng kiểm tra lại thiết bị thu âm hoặc cắm tai nghe có mic.");
        } else {
            alert("Không thể khởi động Micro: " + (err.message || err.name));
        }
    } finally {
        isStudentMicToggling = false;
    }
}

function handleForceMute(msg) {
    if (isStudentMicActive) {
        toggleStudentMicrophone();
        if (msg && msg.mute_all) {
            alert("Thầy/Cô đã tắt micro của tất cả học sinh để ổn định trật tự lớp.");
        } else {
            alert("Thầy/Cô đã tắt micro của bạn để ổn định lớp học.");
        }
    }
}

function handlePeerStudentMicStatus(studentId, studentName, active) {
    const notice = document.getElementById('peer-speaking-notice');
    const nameEl = document.getElementById('peer-speaking-name');
    if (!notice) return;

    if (active && studentId && studentId !== ownClientId) {
        if (nameEl) nameEl.textContent = studentName || 'Học sinh';
        notice.classList.remove('hidden');
    } else {
        notice.classList.add('hidden');
    }
}

// ----------------- KHUNG CHAT & MICRO HỌC SINH LOCK STATUS UI -----------------
function updateStudentChatLockUI(allowed) {
    isStudentChatAllowed = !!allowed;
    const banner = document.getElementById('student-chat-lock-banner');
    const input = document.getElementById('student-chat-input');
    const sendBtn = document.getElementById('student-chat-send-btn');

    if (isStudentChatAllowed) {
        if (banner) banner.classList.add('hidden');
        if (input) {
            input.disabled = false;
            input.placeholder = "Nhập tin nhắn hoặc câu hỏi gửi Thầy/Cô...";
            input.className = "flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500";
        }
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.className = "px-3.5 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 active:scale-95 text-white rounded-xl text-xs font-bold transition shadow-md shadow-cyan-600/20 shrink-0 flex items-center space-x-1 cursor-pointer";
        }
    } else {
        if (banner) banner.classList.remove('hidden');
        if (input) {
            input.disabled = true;
            input.placeholder = "Thầy/Cô đang tạm tắt khung chat...";
            input.className = "flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-400 placeholder-slate-600 focus:outline-none opacity-60 cursor-not-allowed";
        }
        if (sendBtn) {
            sendBtn.disabled = true;
            sendBtn.className = "px-3.5 py-2 bg-cyan-600 text-white rounded-xl text-xs font-bold transition flex items-center space-x-1 shrink-0 opacity-40 cursor-not-allowed pointer-events-none";
        }
    }
}
window.updateStudentChatLockUI = updateStudentChatLockUI;

function updateStudentMicLockUI(allowed) {
    isStudentMicAllowed = !!allowed;
    if (!isStudentMicAllowed && isStudentMicActive) {
        toggleStudentMicrophone();
    }
    resetStudentMicUI();
}
window.updateStudentMicLockUI = updateStudentMicLockUI;

// ----------------- SESSION ENDED / INACTIVE SCREEN -----------------
function showSessionEndedScreen(title) {
    const screen = document.getElementById('session-ended-screen');
    const titleEl = document.getElementById('ended-lesson-title');
    if (titleEl && title) titleEl.textContent = `"${title}"`;
    if (screen) screen.classList.remove('hidden');

    const stageWrapper = document.getElementById('stage-wrapper');
    if (stageWrapper) stageWrapper.classList.add('hidden');
    const floatingTools = document.getElementById('floating-tools');
    if (floatingTools) floatingTools.classList.add('hidden');
    const footer = document.querySelector('footer');
    if (footer) footer.classList.add('hidden');
    const prompt = document.getElementById('mobile-unmute-prompt');
    if (prompt) prompt.classList.add('hidden');

    // Tắt micro học sinh nếu đang mở
    if (typeof isStudentMicActive !== 'undefined' && isStudentMicActive && typeof toggleStudentMicrophone === 'function') {
        toggleStudentMicrophone();
    }
    // Dừng âm thanh giáo viên nếu đang mở
    if (studentAudioCtx && studentAudioCtx.state === 'running') {
        try { studentAudioCtx.suspend(); } catch (e) {}
    }
}
window.showSessionEndedScreen = showSessionEndedScreen;

function hideSessionEndedScreen() {
    const screen = document.getElementById('session-ended-screen');
    if (screen) screen.classList.add('hidden');

    const stageWrapper = document.getElementById('stage-wrapper');
    if (stageWrapper) stageWrapper.classList.remove('hidden');
    const floatingTools = document.getElementById('floating-tools');
    if (floatingTools) floatingTools.classList.remove('hidden');
    const footer = document.querySelector('footer');
    if (footer) footer.classList.remove('hidden');
}
window.hideSessionEndedScreen = hideSessionEndedScreen;

window.unlockStudentAudio = unlockStudentAudio;
window.toggleStudentAudioMute = toggleStudentAudioMute;
window.toggleStudentMicrophone = toggleStudentMicrophone;
window.toggleStudentChat = toggleStudentChat;
window.sendStudentChatMessage = sendStudentChatMessage;
window.changeStudentNamePrompt = changeStudentNamePrompt;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
