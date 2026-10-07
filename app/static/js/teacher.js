// TEACHER STUDIO SCRIPT
let ws = null;
let currentSession = (typeof window !== 'undefined' && window.INITIAL_SESSION) ? window.INITIAL_SESSION : ((typeof INITIAL_SESSION !== 'undefined') ? INITIAL_SESSION : {});
let currentTool = 'cursor'; // cursor, laser, pen, highlighter
let isDrawing = false;
let currentStroke = [];
let localScreenStream = null;
const peerConnections = {}; // student_id -> RTCPeerConnection

// Canvas Setup
const canvas = document.getElementById('paint-canvas');
const ctx = canvas.getContext('2d');
const stageWrapper = document.getElementById('stage-wrapper');
const laserDot = document.getElementById('laser-dot');

function init() {
    // Re-check session in case script order varied
    if (typeof window !== 'undefined' && window.INITIAL_SESSION) {
        currentSession = window.INITIAL_SESSION;
    } else if (typeof INITIAL_SESSION !== 'undefined') {
        currentSession = INITIAL_SESSION;
    }

    if (currentSession && currentSession.doc_data && currentSession.doc_data.format === 'pptx') {
        fitMode = 'page';
    }

    setupCanvasResolution();
    window.addEventListener('resize', setupCanvasResolution);

    connectWebSocket();
    setupCanvasEvents();
    setupKeyboardNavigation();

    // Render slide immediately
    renderPage(currentSession.current_page || 1);
    buildSlideDrawer();

    if (currentSession.drawings) {
        redrawAllStrokes(currentSession.drawings);
    }
}

function setupCanvasResolution() {
    if (!stageWrapper || !canvas) return;
    const rect = stageWrapper.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    if (currentSession.drawings) {
        redrawAllStrokes(currentSession.drawings);
    }
}

// ----------------- WEBSOCKET REALTIME -----------------

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${ROOM_ID}/teacher`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log("WebSocket connected as Teacher");
    };

    ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'INIT_STATE') {
            if (msg.state && msg.state.doc_data) {
                currentSession = msg.state;
                renderPage(currentSession.current_page || 1);
                buildSlideDrawer();
            }
        } else if (msg.type === 'STUDENT_COUNT') {
            const el = document.getElementById('student-counter');
            if (el) el.textContent = msg.count;
        } else if (msg.type === 'WEBRTC_ANSWER') {
            const pc = peerConnections[msg.from];
            if (pc && pc.signalingState !== 'closed') {
                await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            }
        } else if (msg.type === 'WEBRTC_CANDIDATE') {
            const pc = peerConnections[msg.from];
            if (pc && pc.signalingState !== 'closed') {
                await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
            }
        }
    };

    ws.onclose = () => {
        setTimeout(connectWebSocket, 2000);
    };
}

let zoomLevel = 1.0;
let fitMode = 'width'; // 'width' (phóng to vừa bề ngang - chữ to cho PDF) hoặc 'page' (vừa toàn trang)

function changeZoom(delta) {
    zoomLevel = Math.max(0.75, Math.min(2.5, zoomLevel + delta));
    applyZoomAndFit();
    syncZoom();
}

function resetZoom() {
    zoomLevel = 1.0;
    applyZoomAndFit();
    syncZoom();
}

function toggleFitMode() {
    fitMode = (fitMode === 'width') ? 'page' : 'width';
    applyZoomAndFit();
    syncZoom();
}

function applyZoomAndFit() {
    const stage = document.getElementById('stage-wrapper');
    const img = document.getElementById('slide-img');
    const zoomText = document.getElementById('btn-zoom-level');
    const textFit = document.getElementById('text-fit-mode');
    const btnFit = document.getElementById('btn-fit-mode');

    if (zoomText) zoomText.textContent = `${Math.round(zoomLevel * 100)}%`;

    if (fitMode === 'width') {
        if (textFit) textFit.textContent = "Vừa chiều rộng";
        if (btnFit) {
            btnFit.className = "px-2.5 py-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition flex items-center space-x-1";
        }
        if (stage) {
            const widthClass = zoomLevel >= 2.0 ? 'max-w-7xl' : (zoomLevel >= 1.5 ? 'max-w-6xl' : (zoomLevel >= 1.25 ? 'max-w-5xl' : 'max-w-4xl'));
            stage.className = `relative w-full ${widthClass} bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col items-center justify-start border border-slate-800 transition-all duration-150 my-2`;
        }
        if (img) {
            img.style.width = '100%';
            img.style.maxWidth = '100%';
            img.style.maxHeight = 'none';
            img.style.height = 'auto';
        }
    } else {
        if (textFit) textFit.textContent = "Vừa toàn trang";
        if (btnFit) {
            btnFit.className = "px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-800 text-slate-300 hover:text-white transition flex items-center space-x-1";
        }
        if (stage) {
            stage.className = `relative max-h-[calc(100vh-160px)] w-fit max-w-[95vw] bg-white text-slate-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col items-center justify-center border border-slate-800 transition-all duration-150 my-auto`;
        }
        if (img) {
            img.style.width = 'auto';
            img.style.maxWidth = 'calc(100vw - 60px)';
            img.style.maxHeight = 'calc(100vh - 170px)';
            img.style.height = 'auto';
        }
    }

    setTimeout(setupCanvasResolution, 60);
}

function syncZoom() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'ZOOM_SYNC',
            zoom: zoomLevel,
            fit_mode: fitMode
        }));
    }
}

let lastScrollSync = 0;
function handleScroll(e) {
    const el = e.target;
    const maxScroll = el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;

    const ratio = el.scrollTop / maxScroll;
    const now = Date.now();
    if (now - lastScrollSync > 40) {
        lastScrollSync = now;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'SCROLL_SYNC',
                ratio: ratio
            }));
        }
    }
}

// ----------------- SLIDE NAVIGATION & RENDERING -----------------

function renderPage(pageNum) {
    currentSession.current_page = pageNum;
    const doc = currentSession.doc_data;
    
    const pageText = document.getElementById('current-page-text');
    if (pageText) pageText.textContent = pageNum;

    if (!doc || !doc.pages || doc.pages.length === 0) {
        document.getElementById('slide-img').classList.add('hidden');
        document.getElementById('slide-card').classList.add('hidden');
        document.getElementById('whiteboard-notice').classList.remove('hidden');
        const tot = document.getElementById('total-page-text');
        if (tot) tot.textContent = "1";
        updateNavButtons(1, 1);
        return;
    }

    const total = doc.total_pages;
    const tot = document.getElementById('total-page-text');
    if (tot) tot.textContent = total;
    document.getElementById('whiteboard-notice').classList.add('hidden');

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
        document.getElementById('card-page-badge').textContent = `Slide ${pageNum} / ${total}`;
        document.getElementById('card-page-indicator').textContent = `Slide ${pageNum} / ${total}`;

        const bulletsList = document.getElementById('card-bullets');
        bulletsList.innerHTML = '';
        const bullets = pageData.bullets || [];
        bullets.forEach(b => {
            const li = document.createElement('li');
            li.className = "flex items-start space-x-3 bg-white/70 p-3 rounded-xl border border-slate-100 shadow-sm";
            li.innerHTML = `<span class="w-3 h-3 rounded-full bg-blue-600 mt-1 shrink-0"></span><span class="leading-relaxed font-semibold text-slate-800">${b}</span>`;
            bulletsList.appendChild(li);
        });

        fitMode = 'page';
        applyZoomAndFit();
    }

    updateNavButtons(pageNum, total);
    highlightActiveDrawerSlide(pageNum);
}

function updateNavButtons(current, total) {
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const arrPrev = document.getElementById('arrow-prev');
    const arrNext = document.getElementById('arrow-next');

    if (btnPrev) btnPrev.disabled = current <= 1;
    if (btnNext) btnNext.disabled = current >= total;
    if (arrPrev) arrPrev.disabled = current <= 1;
    if (arrNext) arrNext.disabled = current >= total;
}

function prevPage() {
    if (currentSession.current_page > 1) {
        goToPage(currentSession.current_page - 1);
    }
}

function nextPage() {
    const total = currentSession.doc_data ? currentSession.doc_data.total_pages : 1;
    if (currentSession.current_page < total) {
        goToPage(currentSession.current_page + 1);
    }
}

function goToPage(page) {
    renderPage(page);
    clearCanvas();
    const scrollCont = document.getElementById('stage-scroll-container');
    if (scrollCont) scrollCont.scrollTop = 0;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'PAGE_CHANGE',
            page: page
        }));
        ws.send(JSON.stringify({
            type: 'SCROLL_SYNC',
            ratio: 0
        }));
    }
}

// ----------------- SLIDE DRAWER / SIDEBAR -----------------

function toggleSlideDrawer() {
    const drawer = document.getElementById('slide-drawer');
    drawer.classList.toggle('hidden');
    setTimeout(setupCanvasResolution, 300);
}

function buildSlideDrawer() {
    const doc = currentSession.doc_data;
    const listCont = document.getElementById('drawer-slide-list');
    const countEl = document.getElementById('drawer-total-count');
    if (!doc || !doc.pages) return;

    if (countEl) countEl.textContent = doc.pages.length;
    listCont.innerHTML = '';

    doc.pages.forEach((p, idx) => {
        const item = document.createElement('div');
        const pNum = idx + 1;
        item.id = `drawer-item-${pNum}`;
        item.className = `p-2.5 rounded-xl border text-left cursor-pointer transition ${pNum === currentSession.current_page ? 'bg-blue-950/80 border-blue-500 text-white' : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800'}`;
        item.onclick = () => goToPage(pNum);

        if (p.image_url) {
            item.innerHTML = `
                <div class="flex items-center space-x-3">
                    <div class="relative w-20 h-12 shrink-0 bg-slate-900 rounded-lg overflow-hidden border border-slate-700 shadow-sm flex items-center justify-center">
                        <img src="${p.image_url}" class="w-full h-full object-cover" loading="lazy" />
                        <span class="absolute bottom-0.5 right-1 text-[9px] font-mono font-bold bg-black/70 text-white px-1 rounded">${pNum}</span>
                    </div>
                    <div class="overflow-hidden flex-1">
                        <span class="text-[10px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-blue-900/60 font-mono text-blue-300">Slide ${pNum}</span>
                        <p class="text-xs font-semibold truncate text-slate-300 mt-1">${p.text ? p.text.substring(0, 35) : 'Trang ' + pNum}</p>
                    </div>
                </div>
            `;
        } else {
            item.innerHTML = `
                <div class="flex items-center justify-between mb-1">
                    <span class="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-slate-900/60 font-mono text-blue-400">Slide ${pNum}</span>
                </div>
                <p class="text-xs font-bold truncate">${p.title || 'Slide ' + pNum}</p>
            `;
        }
        listCont.appendChild(item);
    });
}

function highlightActiveDrawerSlide(activeNum) {
    const doc = currentSession.doc_data;
    if (!doc || !doc.pages) return;
    for (let i = 1; i <= doc.pages.length; i++) {
        const el = document.getElementById(`drawer-item-${i}`);
        if (el) {
            if (i === activeNum) {
                el.className = "p-3 rounded-xl border text-left cursor-pointer transition bg-blue-950/80 border-blue-500 text-white shadow-md";
            } else {
                el.className = "p-3 rounded-xl border text-left cursor-pointer transition bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800";
            }
        }
    }
}

function changeMaterial(matId) {
    if (!matId) return;
    window.location.href = `/teacher/${ROOM_ID}?material_id=${matId}`;
}

// ----------------- TOOLS & CANVAS DRAWING -----------------

function setTool(tool) {
    currentTool = tool;

    ['cursor', 'laser', 'pen', 'highlighter'].forEach(t => {
        const btn = document.getElementById(`tool-${t}`);
        if (btn) {
            btn.className = "px-3 py-1.5 rounded-xl text-xs font-bold transition text-slate-400 hover:text-white flex items-center space-x-1.5";
        }
    });

    const activeBtn = document.getElementById(`tool-${tool}`);
    if (activeBtn) {
        activeBtn.className = "px-3 py-1.5 rounded-xl text-xs font-bold transition bg-blue-600 text-white flex items-center space-x-1.5 shadow";
    }

    if (tool !== 'laser') {
        laserDot.classList.add('hidden');
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'LASER_MOVE', active: false }));
        }
    }
}

let lastLaserTime = 0;
function setupCanvasEvents() {
    stageWrapper.addEventListener('mousemove', (e) => {
        if (currentTool === 'laser') {
            const rect = stageWrapper.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            laserDot.style.left = `${x}px`;
            laserDot.style.top = `${y}px`;
            laserDot.classList.remove('hidden');

            const now = Date.now();
            if (now - lastLaserTime > 30) {
                lastLaserTime = now;
                const normX = x / rect.width;
                const normY = y / rect.height;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'LASER_MOVE',
                        x: normX,
                        y: normY,
                        active: true
                    }));
                }
            }
        }
    });

    stageWrapper.addEventListener('mouseleave', () => {
        if (currentTool === 'laser') {
            laserDot.classList.add('hidden');
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'LASER_MOVE', active: false }));
            }
        }
    });

    canvas.addEventListener('mousedown', (e) => {
        if (currentTool === 'pen' || currentTool === 'highlighter') {
            isDrawing = true;
            const rect = canvas.getBoundingClientRect();
            const pt = {
                x: (e.clientX - rect.left) / rect.width,
                y: (e.clientY - rect.top) / rect.height
            };
            currentStroke = [pt];
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDrawing) return;
        const rect = canvas.getBoundingClientRect();
        const pt = {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height
        };
        currentStroke.push(pt);
        drawSegment(currentStroke, currentTool);
    });

    window.addEventListener('mouseup', () => {
        if (isDrawing && currentStroke.length > 1) {
            isDrawing = false;
            const strokeData = {
                tool: currentTool,
                color: currentTool === 'highlighter' ? 'rgba(250, 204, 21, 0.4)' : '#ef4444',
                size: currentTool === 'highlighter' ? 18 : 3,
                points: currentStroke
            };
            if (!currentSession.drawings) currentSession.drawings = [];
            currentSession.drawings.push(strokeData);

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'DRAW_STROKE',
                    stroke: strokeData
                }));
            }
        }
        isDrawing = false;
    });
}

function drawSegment(points, tool) {
    if (points.length < 2) return;
    const p1 = points[points.length - 2];
    const p2 = points[points.length - 1];

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (tool === 'highlighter') {
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.4)';
        ctx.lineWidth = 18;
    } else {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
    }

    ctx.beginPath();
    ctx.moveTo(p1.x * canvas.width, p1.y * canvas.height);
    ctx.lineTo(p2.x * canvas.width, p2.y * canvas.height);
    ctx.stroke();
    ctx.restore();
}

function redrawAllStrokes(strokes) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!strokes) return;

    strokes.forEach(s => {
        if (!s.points || s.points.length < 2) return;
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
    });
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentSession.drawings = [];
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CLEAR_DRAWINGS' }));
    }
}

// ----------------- SCREEN SHARING & LIVE BROADCAST -----------------

let screenCaptureInterval = null;
let offscreenCaptureCanvas = null;
let offscreenCaptureCtx = null;

async function toggleScreenShare() {
    const video = document.getElementById('screen-video');
    const slideCont = document.getElementById('slide-container');
    const btn = document.getElementById('btn-screen-share');
    const btnText = document.getElementById('screen-share-text');
    const banner = document.getElementById('screen-share-banner');
    const bannerUrl = document.getElementById('banner-share-url');

    if (localScreenStream) {
        if (screenCaptureInterval) {
            clearInterval(screenCaptureInterval);
            screenCaptureInterval = null;
        }
        localScreenStream.getTracks().forEach(t => t.stop());
        localScreenStream = null;
        video.srcObject = null;
        video.classList.add('hidden');
        slideCont.classList.remove('hidden');
        if (btn) {
            btn.classList.remove('bg-rose-600', 'hover:bg-rose-700', 'text-white');
            btn.classList.add('bg-slate-800', 'text-slate-200');
        }
        if (btnText) btnText.textContent = "Chia sẻ màn hình";
        if (banner) banner.classList.add('hidden');

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'SWITCH_MODE', mode: 'slides' }));
        }
    } else {
        try {
            localScreenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 15, max: 30 } },
                audio: false
            });

            video.srcObject = localScreenStream;
            video.classList.remove('hidden');
            slideCont.classList.add('hidden');

            if (btn) {
                btn.classList.remove('bg-slate-800', 'text-slate-200');
                btn.classList.add('bg-rose-600', 'hover:bg-rose-700', 'text-white');
            }
            if (btnText) btnText.textContent = "Dừng chia sẻ";

            // Hiển thị thanh nổi kèm link học sinh
            const studentUrl = window.location.origin.includes('localhost')
                ? `http://${LAN_IP}:8000/view/${ROOM_ID}`
                : `${window.location.origin}/view/${ROOM_ID}`;
            if (bannerUrl) bannerUrl.textContent = studentUrl;
            if (banner) banner.classList.remove('hidden');

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'SWITCH_MODE', mode: 'screen' }));
            }

            // Khởi tạo offscreen canvas để truyền khung hình trực tiếp tới học sinh
            if (!offscreenCaptureCanvas) {
                offscreenCaptureCanvas = document.createElement('canvas');
                offscreenCaptureCtx = offscreenCaptureCanvas.getContext('2d');
            }

            // Gửi khung hình định kỳ (mỗi 140ms ~ 7 FPS, chất lượng nén JPEG mượt mà)
            screenCaptureInterval = setInterval(() => {
                if (!localScreenStream || !video.videoWidth || !video.videoHeight) return;
                if (!ws || ws.readyState !== WebSocket.OPEN) return;

                const maxDim = 1280;
                let w = video.videoWidth;
                let h = video.videoHeight;
                if (w > maxDim) {
                    h = Math.round((h * maxDim) / w);
                    w = maxDim;
                }
                offscreenCaptureCanvas.width = w;
                offscreenCaptureCanvas.height = h;
                offscreenCaptureCtx.drawImage(video, 0, 0, w, h);

                const frameData = offscreenCaptureCanvas.toDataURL('image/jpeg', 0.55);
                ws.send(JSON.stringify({
                    type: 'SCREEN_FRAME',
                    frame: frameData
                }));
            }, 140);

            localScreenStream.getVideoTracks()[0].onended = () => {
                toggleScreenShare();
            };
        } catch (err) {
            console.error("Lỗi chia sẻ màn hình:", err);
        }
    }
}

// ----------------- TEACHER MICROPHONE STREAMING (REAL-TIME VOICE BROADCAST) -----------------
let micStream = null;
let micRecorder = null;
let isMicActive = false;
let isMicToggling = false;
let audioContext = null;
let audioAnalyser = null;
let micAnimFrame = null;

function resetMicBtnUI() {
    isMicActive = false;
    const btn = document.getElementById('btn-mic-toggle');
    const icon = document.getElementById('mic-icon');
    const text = document.getElementById('mic-text');
    const pulse = document.getElementById('mic-pulse');
    if (btn) {
        btn.className = "px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition border border-slate-700 cursor-pointer";
    }
    if (icon) icon.className = "fa-solid fa-microphone-slash text-slate-400";
    if (text) text.textContent = "Bật Mic";
    if (pulse) pulse.classList.add('hidden');
}

async function toggleMicrophone() {
    if (isMicToggling) return;
    isMicToggling = true;

    const btn = document.getElementById('btn-mic-toggle');
    const icon = document.getElementById('mic-icon');
    const text = document.getElementById('mic-text');
    const pulse = document.getElementById('mic-pulse');

    try {
        if (isMicActive) {
            // Tắt Micro
            isMicActive = false;
            if (micRecorder && micRecorder.state !== 'inactive') {
                try { micRecorder.stop(); } catch(e) {}
            }
            if (micStream) {
                micStream.getTracks().forEach(t => t.stop());
                micStream = null;
            }
            if (micAnimFrame) {
                cancelAnimationFrame(micAnimFrame);
                micAnimFrame = null;
            }
            if (audioContext && audioContext.state !== 'closed') {
                try { audioContext.close(); } catch(e) {}
                audioContext = null;
            }

            resetMicBtnUI();

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'MIC_STATUS', active: false }));
            }
        } else {
            // Bật Micro: Phản hồi giao diện tức thì để không bị trơ
            if (icon) icon.className = "fa-solid fa-spinner fa-spin text-amber-400";
            if (text) text.textContent = "Đang mở mic...";

            // Kiểm tra Secure Context (HTTPS hoặc localhost)
            const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
            if (location.protocol !== 'https:' && !isLocal) {
                alert("Không thể bật Micro qua địa chỉ HTTP (" + location.hostname + ") do trình duyệt chặn bảo mật.\n\n👉 Vui lòng sử dụng đường link HTTPS chính thức (ví dụ trên Render Cloud) hoặc truy cập từ máy chủ localhost để được cấp quyền Micro.");
                resetMicBtnUI();
                return;
            }

            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                alert("Trình duyệt không hỗ trợ API Micro hoặc tính năng này bị vô hiệu hoá. Vui lòng mở trang trên Google Chrome, Edge hoặc Safari.");
                resetMicBtnUI();
                return;
            }

            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });

            isMicActive = true;

            if (btn) {
                btn.className = "px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition shadow-lg shadow-emerald-500/25 border border-emerald-400 cursor-pointer";
            }
            if (icon) icon.className = "fa-solid fa-microphone text-white";
            if (text) text.textContent = "Đang phát tiếng";
            if (pulse) pulse.classList.remove('hidden');

            // Báo cho toàn bộ học sinh biết Micro đã bật
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'MIC_STATUS', active: true }));
            }

            // Đo âm lượng giọng nói để tạo hiệu ứng nhấp nháy
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (AudioCtx) {
                    audioContext = new AudioCtx();
                    const source = audioContext.createMediaStreamSource(micStream);
                    audioAnalyser = audioContext.createAnalyser();
                    audioAnalyser.fftSize = 256;
                    source.connect(audioAnalyser);

                    const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
                    const checkVolume = () => {
                        if (!isMicActive) return;
                        audioAnalyser.getByteFrequencyData(dataArray);
                        let sum = 0;
                        for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                        const avg = sum / dataArray.length;
                        if (pulse) {
                            pulse.style.transform = `scale(${1 + Math.min(avg / 25, 2)})`;
                        }
                        micAnimFrame = requestAnimationFrame(checkVolume);
                    };
                    checkVolume();
                }
            } catch (e) {
                console.warn("Visualizer audio context:", e);
            }

            // Tìm định dạng âm thanh phù hợp
            let mimeType = '';
            const candidateTypes = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/mp4',
                'audio/aac',
                'audio/ogg'
            ];
            if (typeof MediaRecorder !== 'undefined') {
                for (const t of candidateTypes) {
                    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
                        mimeType = t;
                        break;
                    }
                }
            }

            const options = mimeType ? { mimeType, audioBitsPerSecond: 32000 } : {};
            micRecorder = new MediaRecorder(micStream, options);

            micRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0 && isMicActive) {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const base64Data = reader.result;
                            ws.send(JSON.stringify({
                                type: 'AUDIO_CHUNK',
                                audio: base64Data,
                                mime_type: mimeType || 'audio/webm'
                            }));
                        };
                        reader.readAsDataURL(event.data);
                    }
                }
            };

            // Cắt lát âm thanh gửi đều đặn mỗi 200ms
            micRecorder.start(200);

            if (micStream.getAudioTracks().length > 0) {
                micStream.getAudioTracks()[0].onended = () => {
                    if (isMicActive) toggleMicrophone();
                };
            }
        }
    } catch (err) {
        console.error("Lỗi cấp quyền Micro:", err);
        resetMicBtnUI();
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            alert("Bạn đã chặn quyền truy cập Micro.\n\n👉 Hãy nhấp vào biểu tượng Ổ khoá hoặc Cài đặt trang web trên thanh địa chỉ trình duyệt, chọn 'Cho phép (Allow)' quyền Micro rồi tải lại trang!");
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            alert("Không tìm thấy Micro trên thiết bị của bạn. Vui lòng kiểm tra lại mic hoặc cắm tai nghe có mic!");
        } else {
            alert("Không thể khởi động Micro: " + (err.message || err.name));
        }
    } finally {
        isMicToggling = false;
    }
}
window.toggleMicrophone = toggleMicrophone;

// ----------------- SHARE MODAL & QR CODE (DUAL TABS) -----------------

let qrcodeObj = null;
let currentShareTab = 'internet';
let internetShareUrl = '';
let lanShareUrl = '';

function openShareModal() {
    const modal = document.getElementById('share-modal');
    modal.classList.remove('hidden');

    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

    // 1. Internet Share URL: Lấy chính URL của trang web (trên Render là https://trinh-chieu-tu-xa.onrender.com)
    if (!isLocalhost) {
        internetShareUrl = `${window.location.origin}/view/${ROOM_ID}`;
    } else {
        internetShareUrl = `${window.location.protocol}//${window.location.host}/view/${ROOM_ID}`;
    }

    // 2. LAN Share URL: Lấy IP mạng LAN nội bộ
    lanShareUrl = `http://${LAN_IP}:8000/view/${ROOM_ID}`;

    // Tự động chọn tab phù hợp nhất: nếu đang ở Render thì ưu tiên Internet, nếu ở localhost thì ưu tiên LAN
    selectShareTab(isLocalhost ? 'lan' : 'internet');
}

function selectShareTab(tab) {
    currentShareTab = tab;
    const btnInternet = document.getElementById('tab-btn-internet');
    const btnLan = document.getElementById('tab-btn-lan');
    const inputUrl = document.getElementById('share-url-input');
    const labelUrl = document.getElementById('share-url-label');
    const badgeTag = document.getElementById('share-badge-tag');
    const guideText = document.getElementById('qr-guide-text');
    const noteText = document.getElementById('lan-note-text');
    const noteBox = document.getElementById('lan-note-box');

    let activeUrl = '';

    if (tab === 'internet') {
        activeUrl = internetShareUrl;
        if (btnInternet) btnInternet.className = "flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 bg-blue-600 text-white shadow-sm";
        if (btnLan) btnLan.className = "flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 text-slate-600 hover:text-slate-900";
        if (labelUrl) labelUrl.textContent = "Đường link Internet (Xem từ mọi nơi):";
        if (badgeTag) {
            badgeTag.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700";
            badgeTag.textContent = "Toàn quốc / 4G";
        }
        if (guideText) guideText.textContent = "Quét mã QR để mở link Internet trên điện thoại / iPad";
        if (noteBox) noteBox.className = "p-3 bg-blue-50/80 border border-blue-200 rounded-xl text-[11px] text-blue-900 flex items-start space-x-2";
        if (noteText) noteText.innerHTML = `Học sinh ở bất kỳ đâu chỉ cần có mạng Internet (WiFi hoặc 4G/5G) đều có thể truy cập link trên mà không cần chung mạng LAN.`;
    } else {
        activeUrl = lanShareUrl;
        if (btnLan) btnLan.className = "flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 bg-blue-600 text-white shadow-sm";
        if (btnInternet) btnInternet.className = "flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 text-slate-600 hover:text-slate-900";
        if (labelUrl) labelUrl.textContent = "Đường link mạng LAN nội bộ:";
        if (badgeTag) {
            badgeTag.className = "text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800";
            badgeTag.textContent = "Chung Wi-Fi trường";
        }
        if (guideText) guideText.textContent = "Dành cho học sinh kết nối cùng mạng WiFi phòng học / trường";
        if (noteBox) noteBox.className = "p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 flex items-start space-x-2";
        if (noteText) noteText.innerHTML = `Trong phòng tin học hoặc khi kết nối chung mạng WiFi trường, học sinh nhập địa chỉ: <strong class="font-mono text-amber-900 break-all">${activeUrl}</strong>`;
    }

    if (inputUrl) inputUrl.value = activeUrl;

    const qrContainer = document.getElementById('qrcode-container');
    if (qrContainer) {
        qrContainer.innerHTML = '';
        qrcodeObj = new QRCode(qrContainer, {
            text: activeUrl,
            width: 160,
            height: 160,
            colorDark: "#0f172a",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    }
}

function closeShareModal() {
    document.getElementById('share-modal').classList.add('hidden');
    document.getElementById('copy-toast').classList.add('hidden');
}

function copyShareUrl() {
    const input = document.getElementById('share-url-input');
    navigator.clipboard.writeText(input.value).then(() => {
        const toast = document.getElementById('copy-toast');
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 3000);
    }).catch(() => {
        input.select();
        document.execCommand('copy');
        alert("Đã sao chép link!");
    });
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    } else {
        document.exitFullscreen().catch(() => {});
    }
}

function setupKeyboardNavigation() {
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeShareModal();
            return;
        }
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
            nextPage();
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            prevPage();
        } else if (e.key === 'l' || e.key === 'L') {
            setTool(currentTool === 'laser' ? 'cursor' : 'laser');
        } else if (e.key === 'p' || e.key === 'P') {
            setTool(currentTool === 'pen' ? 'cursor' : 'pen');
        } else if (e.key === 'm' || e.key === 'M') {
            toggleMicrophone();
        }
    });
}

// Chạy init ngay lập tức (không chờ DOMContentLoaded nếu đã sẵn sàng)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
