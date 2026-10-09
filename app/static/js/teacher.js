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

    if (currentSession && currentSession.doc_data) {
        const d = currentSession.doc_data;
        if (d.format === 'pptx' || d.format === 'image' || (d.pages && d.pages[0] && d.pages[0].aspect_ratio === '16:9')) {
            fitMode = 'page';
        }
    }

    setupCanvasResolution();
    window.addEventListener('resize', setupCanvasResolution);

    connectWebSocket();
    setupCanvasEvents();
    setupKeyboardNavigation();

    // Render slide immediately
    renderPage(currentSession.current_page || 1);
    buildSlideDrawer();

    if (currentSession && currentSession.drawings) {
        redrawAllStrokes(currentSession.drawings);
    }

    if (currentSession && currentSession.chat_messages) {
        loadInitialChatMessages(currentSession.chat_messages);
    }
    if (currentSession && currentSession.speaking_student) {
        handleStudentMicStatus(currentSession.speaking_student.id, currentSession.speaking_student.name, true);
    }

    updateChatLockUI(currentSession ? !!currentSession.chat_enabled : false);
    updateStudentMicLockUI(currentSession ? !!currentSession.student_mic_allowed : false);

    // Mặc định ban đầu là chế độ chuột, tắt chặn cảm ứng vẽ
    setTool('cursor');
}

function setupCanvasResolution() {
    if (!stageWrapper || !canvas) return;
    const rect = stageWrapper.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.round(rect.width);
        canvas.height = Math.round(rect.height);
        if (currentSession && currentSession.drawings) {
            redrawAllStrokes(currentSession.drawings);
        }
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
            if (msg.state && msg.state.chat_messages) {
                loadInitialChatMessages(msg.state.chat_messages);
            }
            if (msg.state && msg.state.speaking_student) {
                handleStudentMicStatus(msg.state.speaking_student.id, msg.state.speaking_student.name, true);
            }
            if (msg.state) {
                updateChatLockUI(!!msg.state.chat_enabled);
                updateStudentMicLockUI(!!msg.state.student_mic_allowed);
            }
        } else if (msg.type === 'STUDENT_COUNT') {
            const el = document.getElementById('student-counter');
            if (el) el.textContent = msg.count;
        } else if (msg.type === 'CHAT_LOCK_STATUS') {
            updateChatLockUI(msg.chat_enabled);
        } else if (msg.type === 'STUDENT_MIC_LOCK_STATUS') {
            updateStudentMicLockUI(msg.allowed);
        } else if (msg.type === 'CHAT_MESSAGE') {
            handleIncomingChatMessage(msg.message);
        } else if (msg.type === 'STUDENT_MIC_STATUS') {
            handleStudentMicStatus(msg.student_id, msg.student_name, msg.active);
        } else if (msg.type === 'STUDENT_AUDIO_CHUNK') {
            handleStudentAudioChunk(msg);
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

// ----------------- CACHE & PRELOAD SLIDES (0ms Chuyển Trang) -----------------
const slideImageCache = new Map();

function preloadSlideImage(url) {
    if (!url || slideImageCache.has(url)) return;
    const img = new Image();
    img.src = url;
    slideImageCache.set(url, img);
}

function preloadSlidesAround(pageNum, doc) {
    if (!doc || !doc.pages || doc.mode !== 'image') return;
    const total = doc.pages.length;
    // 1. Ưu tiên cao nhất: 3 trang tiếp theo
    for (let i = 1; i <= 3; i++) {
        const idx = pageNum - 1 + i;
        if (idx < total && doc.pages[idx] && doc.pages[idx].image_url) {
            preloadSlideImage(doc.pages[idx].image_url);
        }
    }
    // 2. Ưu tiên kế: 2 trang phía trước (đề phòng quay lại)
    for (let i = 1; i <= 2; i++) {
        const idx = pageNum - 1 - i;
        if (idx >= 0 && doc.pages[idx] && doc.pages[idx].image_url) {
            preloadSlideImage(doc.pages[idx].image_url);
        }
    }
    // 3. Tải ngầm toàn bộ bài giảng trong nền để chuyển bất kỳ slide nào cũng 0ms
    setTimeout(() => {
        doc.pages.forEach(p => {
            if (p && p.image_url) {
                preloadSlideImage(p.image_url);
            }
        });
    }, 300);
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
        const targetUrl = pageData.image_url;

        // Nếu ảnh đã sẵn sàng trong cache, hoán đổi tức thì trong 0ms không chớp nháy
        const cachedImg = slideImageCache.get(targetUrl);
        if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
            img.src = targetUrl;
            img.classList.remove('hidden');
            document.getElementById('slide-card').classList.add('hidden');
            applyZoomAndFit();
            setupCanvasResolution();
        } else {
            const preImg = cachedImg || new Image();
            if (!slideImageCache.has(targetUrl)) {
                slideImageCache.set(targetUrl, preImg);
                preImg.src = targetUrl;
            }
            preImg.onload = () => {
                if (currentSession.current_page === pageNum) {
                    img.src = targetUrl;
                    img.classList.remove('hidden');
                    document.getElementById('slide-card').classList.add('hidden');
                    applyZoomAndFit();
                    setupCanvasResolution();
                }
            };
            if (preImg.complete && preImg.naturalWidth > 0) {
                img.src = targetUrl;
                img.classList.remove('hidden');
                document.getElementById('slide-card').classList.add('hidden');
                applyZoomAndFit();
                setupCanvasResolution();
            } else {
                img.src = targetUrl;
                img.classList.remove('hidden');
                document.getElementById('slide-card').classList.add('hidden');
                img.onload = () => {
                    applyZoomAndFit();
                    setupCanvasResolution();
                };
            }
        }

        applyZoomAndFit();
        // Tiền tải ngầm các trang tiếp theo và toàn bộ bài giảng
        preloadSlidesAround(pageNum, doc);
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
            btn.className = "px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition text-slate-400 hover:text-white flex items-center space-x-1 sm:space-x-1.5";
        }
    });

    const activeBtn = document.getElementById(`tool-${tool}`);
    if (activeBtn) {
        activeBtn.className = "px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-bold transition bg-blue-600 text-white flex items-center space-x-1 sm:space-x-1.5 shadow-md shadow-blue-600/30 ring-1 ring-blue-400";
    }

    if (canvas) {
        if (tool === 'cursor') {
            canvas.style.pointerEvents = 'none';
            canvas.style.touchAction = 'auto';
            canvas.style.cursor = 'default';
        } else {
            canvas.style.pointerEvents = 'auto';
            canvas.style.touchAction = 'none';
            canvas.style.cursor = 'crosshair';
        }
    }

    if (tool !== 'laser') {
        if (laserDot) laserDot.classList.add('hidden');
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'LASER_MOVE', active: false }));
        }
    }
}
window.setTool = setTool;

let lastLaserTime = 0;
function setupCanvasEvents() {
    if (!canvas || !stageWrapper) return;

    // Laser pointer helper (Hỗ trợ cả di chuột và ngón tay lướt trên điện thoại)
    function updateLaser(clientX, clientY, active) {
        if (currentTool !== 'laser') return;
        const rect = stageWrapper.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const x = clientX - rect.left;
        const y = clientY - rect.top;

        if (active) {
            laserDot.style.left = `${x}px`;
            laserDot.style.top = `${y}px`;
            laserDot.classList.remove('hidden');
        } else {
            laserDot.classList.add('hidden');
        }

        const now = Date.now();
        if (now - lastLaserTime > 30 || !active) {
            lastLaserTime = now;
            const normX = Math.max(0, Math.min(1, x / rect.width));
            const normY = Math.max(0, Math.min(1, y / rect.height));
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'LASER_MOVE',
                    x: normX,
                    y: normY,
                    active: active
                }));
            }
        }
    }

    // Pointer events trên stageWrapper & canvas cho Laser
    const handleLaserMove = (e) => {
        if (currentTool === 'laser') {
            if (e.pointerType === 'touch') {
                updateLaser(e.clientX, e.clientY, true);
            } else {
                updateLaser(e.clientX, e.clientY, true);
            }
        }
    };
    stageWrapper.addEventListener('pointermove', handleLaserMove);
    canvas.addEventListener('pointermove', (e) => {
        if (currentTool === 'laser') {
            handleLaserMove(e);
        }
    });

    stageWrapper.addEventListener('pointerleave', () => {
        if (currentTool === 'laser') {
            updateLaser(0, 0, false);
        }
    });

    // POINTER EVENTS CHO BÚT VẼ (PEN) & HIGHLIGHTER (Hoạt động hoàn hảo cho cả Chuột, Cảm ứng điện thoại, iPad và Bút cảm ứng)
    canvas.addEventListener('pointerdown', (e) => {
        if (currentTool === 'laser') {
            updateLaser(e.clientX, e.clientY, true);
            return;
        }
        if (currentTool !== 'pen' && currentTool !== 'highlighter') return;

        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        isDrawing = true;
        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const pt = {
            x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
        };
        currentStroke = [pt];
        // Vẽ ngay điểm đầu tiên (hỗ trợ cả chạm 1 cái thành chấm tròn)
        drawSegment([pt, pt], currentTool);
    });

    canvas.addEventListener('pointermove', (e) => {
        if (currentTool === 'laser') {
            updateLaser(e.clientX, e.clientY, true);
            return;
        }
        if (!isDrawing) return;
        if (currentTool !== 'pen' && currentTool !== 'highlighter') return;

        const rect = canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const pt = {
            x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
        };
        currentStroke.push(pt);
        drawSegment(currentStroke, currentTool);
    });

    const endDrawing = (e) => {
        if (currentTool === 'laser') {
            if (e && e.pointerType === 'touch') {
                updateLaser(0, 0, false);
            }
            return;
        }
        if (isDrawing && currentStroke.length >= 1) {
            isDrawing = false;
            // Nếu chỉ có 1 điểm (chạm 1 cái), nhân đôi điểm để stroke hợp lệ
            if (currentStroke.length === 1) {
                currentStroke.push({ x: currentStroke[0].x, y: currentStroke[0].y });
            }
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
    };

    canvas.addEventListener('pointerup', endDrawing);
    canvas.addEventListener('pointercancel', endDrawing);
    window.addEventListener('pointerup', endDrawing);
}

function drawSegment(points, tool) {
    if (!points || points.length < 1) return;
    const p1 = points[Math.max(0, points.length - 2)];
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
        if (!s.points || s.points.length < 1) return;
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
    });
}

function clearCanvas() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    currentSession.drawings = [];
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CLEAR_DRAWINGS' }));
    }
}
window.clearCanvas = clearCanvas;

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
let isMicActive = false;
let isMicToggling = false;
let audioContext = null;
let micScriptNode = null;
let micSourceNode = null;
let micMuteGain = null;

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

            if (micScriptNode) {
                micScriptNode.onaudioprocess = null;
                try { micScriptNode.disconnect(); } catch (e) {}
                micScriptNode = null;
            }
            if (micSourceNode) {
                try { micSourceNode.disconnect(); } catch (e) {}
                micSourceNode = null;
            }
            if (micMuteGain) {
                try { micMuteGain.disconnect(); } catch (e) {}
                micMuteGain = null;
            }
            if (micStream) {
                micStream.getTracks().forEach(t => t.stop());
                micStream = null;
            }
            if (audioContext && audioContext.state !== 'closed') {
                try { audioContext.close(); } catch (e) {}
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

            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) {
                alert("Trình duyệt không hỗ trợ Web Audio API.");
                resetMicBtnUI();
                return;
            }

            audioContext = new AudioCtx();
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const inSampleRate = audioContext.sampleRate;
            micSourceNode = audioContext.createMediaStreamSource(micStream);

            // Buffer size 4096 (~85ms ở 48kHz, ~92ms ở 44.1kHz)
            micScriptNode = audioContext.createScriptProcessor(4096, 1, 1);

            micScriptNode.onaudioprocess = (e) => {
                if (!isMicActive) return;
                const inputData = e.inputBuffer.getChannelData(0);

                // Đo âm lượng giọng nói để tạo hiệu ứng nhấp nháy cho Thầy/Cô
                let sum = 0;
                for (let i = 0; i < inputData.length; i++) {
                    sum += inputData[i] * inputData[i];
                }
                const rms = Math.sqrt(sum / inputData.length);
                if (pulse) {
                    pulse.style.transform = `scale(${1 + Math.min(rms * 18, 2.5)})`;
                }

                // Hạ mẫu xuống 16,000 Hz và nén sang PCM 16-bit
                const downsampled = downsampleAudioBuffer(inputData, inSampleRate, 16000);
                const pcm16 = floatTo16BitPCM(downsampled);
                const base64Pcm = int16ToBase64(pcm16);

                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'AUDIO_CHUNK',
                        pcm: base64Pcm,
                        sample_rate: 16000
                    }));
                }
            };

            // Chống dội âm ra loa ngoài của chính máy Giáo viên
            micMuteGain = audioContext.createGain();
            micMuteGain.gain.value = 0;

            micSourceNode.connect(micScriptNode);
            micScriptNode.connect(micMuteGain);
            micMuteGain.connect(audioContext.destination);

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
        // Nếu người dùng đang gõ trong ô nhập liệu (chat input, search...), bỏ qua các phím tắt
        const targetTag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
        if (targetTag === 'input' || targetTag === 'textarea' || e.target.isContentEditable) {
            return;
        }

        if (e.code === 'Space' || e.key === ' ') {
            e.preventDefault();
            return;
        }

        if (e.key === 'Escape') {
            closeShareModal();
            return;
        }
        // Chỉ bấm phím mũi tên (ArrowLeft / ArrowRight) hoặc PageUp / PageDown mới chuyển slide, không dùng phím cách (Space)
        if (e.key === 'ArrowRight' || e.key === 'PageDown') {
            e.preventDefault();
            nextPage();
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            e.preventDefault();
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

// ----------------- TEACHER CHAT & STUDENT AUDIO INTERACTION -----------------
let isChatOpen = false;
let unreadChatCount = 0;
let currentSpeakingStudentId = null;
let teacherAudioPlayerCtx = null;
let nextStudentAudioPlayTime = 0;

function toggleChatDrawer() {
    const drawer = document.getElementById('chat-drawer');
    const slideDrawer = document.getElementById('slide-drawer');
    if (!drawer) return;

    isChatOpen = !isChatOpen;
    if (isChatOpen) {
        drawer.classList.remove('hidden');
        if (slideDrawer && !slideDrawer.classList.contains('hidden')) {
            slideDrawer.classList.add('hidden'); // Close slide drawer if chat opens
        }
        unreadChatCount = 0;
        updateTeacherChatBadge();
        const msgContainer = document.getElementById('teacher-chat-messages');
        if (msgContainer) msgContainer.scrollTop = msgContainer.scrollHeight;
        const input = document.getElementById('teacher-chat-input');
        if (input) setTimeout(() => input.focus(), 100);
    } else {
        drawer.classList.add('hidden');
    }
}

function updateTeacherChatBadge() {
    const badge = document.getElementById('teacher-chat-badge');
    if (!badge) return;
    if (unreadChatCount > 0 && !isChatOpen) {
        badge.textContent = unreadChatCount > 9 ? '9+' : unreadChatCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function loadInitialChatMessages(messages) {
    if (!messages || !Array.isArray(messages)) return;
    const container = document.getElementById('teacher-chat-messages');
    const emptyHint = document.getElementById('chat-empty-hint');
    if (!container) return;

    if (messages.length > 0 && emptyHint) {
        emptyHint.remove();
    }
    messages.forEach(m => renderChatMessageItem(m, false));
    container.scrollTop = container.scrollHeight;
}

function sendTeacherChatMessage(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('teacher-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'CHAT_MESSAGE',
            sender: 'Thầy/Cô',
            role: 'teacher',
            text: text
        }));
        input.value = '';
    }
}

function handleIncomingChatMessage(msg) {
    if (!msg) return;
    renderChatMessageItem(msg, true);
    if (!isChatOpen) {
        unreadChatCount++;
        updateTeacherChatBadge();
    }
}

function renderChatMessageItem(msg, shouldScroll = true) {
    const container = document.getElementById('teacher-chat-messages');
    if (!container) return;

    const emptyHint = document.getElementById('chat-empty-hint');
    if (emptyHint) emptyHint.remove();

    const isTeacher = (msg.role === 'teacher' || msg.sender === 'Thầy/Cô');
    const item = document.createElement('div');
    item.className = `flex flex-col ${isTeacher ? 'items-end' : 'items-start'} space-y-1`;

    const roleBadge = isTeacher
        ? `<span class="text-[9px] px-1.5 py-0.2 bg-blue-500/20 text-blue-300 font-extrabold rounded border border-blue-500/30">Thầy/Cô</span>`
        : `<span class="text-[9px] px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 font-bold rounded border border-emerald-500/30">Học sinh</span>`;

    item.innerHTML = `
        <div class="flex items-center space-x-1.5 text-[11px] text-slate-400">
            ${isTeacher ? `<span>${msg.time || ''}</span> ${roleBadge} <span class="font-bold text-slate-200">${escapeHtml(msg.sender)}</span>` : `<span class="font-bold text-cyan-300">${escapeHtml(msg.sender)}</span> ${roleBadge} <span>${msg.time || ''}</span>`}
        </div>
        <div class="max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed shadow-sm ${isTeacher ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-100 border border-slate-700/80 rounded-tl-none'}">
            ${escapeHtml(msg.text)}
        </div>
    `;

    container.appendChild(item);
    if (shouldScroll) {
        container.scrollTop = container.scrollHeight;
    }
}

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

// Xử lý khi Học sinh bật micro phát biểu
function handleStudentMicStatus(studentId, studentName, active) {
    const banner = document.getElementById('student-speaking-banner');
    const nameEl = document.getElementById('speaking-student-name');

    if (active) {
        currentSpeakingStudentId = studentId;
        if (nameEl) nameEl.textContent = studentName || 'Học sinh';
        if (banner) banner.classList.remove('hidden');
        initOrResumeTeacherAudioPlayer();
    } else {
        if (currentSpeakingStudentId === studentId || !studentId) {
            currentSpeakingStudentId = null;
            if (banner) banner.classList.add('hidden');
        }
    }
}

function forceMuteSpeakingStudent() {
    if (!currentSpeakingStudentId) return;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'TEACHER_MUTE_STUDENT',
            student_id: currentSpeakingStudentId
        }));
    }
    const banner = document.getElementById('student-speaking-banner');
    if (banner) banner.classList.add('hidden');
    currentSpeakingStudentId = null;
}

function muteAllStudents() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'TEACHER_MUTE_ALL_STUDENTS'
        }));
    }
    const banner = document.getElementById('student-speaking-banner');
    if (banner) banner.classList.add('hidden');
    currentSpeakingStudentId = null;

    // Phản hồi trực quan trên nút ở thanh header
    const btnHeader = document.getElementById('btn-mute-all-students');
    if (btnHeader) {
        const originalHtml = btnHeader.innerHTML;
        btnHeader.innerHTML = `<i class="fa-solid fa-check text-emerald-400"></i><span class="hidden xl:inline">Đã tắt tất cả mic</span>`;
        setTimeout(() => {
            btnHeader.innerHTML = originalHtml;
        }, 1500);
    }
}

function initOrResumeTeacherAudioPlayer() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            if (!teacherAudioPlayerCtx) {
                teacherAudioPlayerCtx = new AudioCtx();
            }
            if (teacherAudioPlayerCtx.state === 'suspended') {
                teacherAudioPlayerCtx.resume().catch(() => {});
            }
        }
    } catch (e) {
        console.warn("Teacher audio player context error:", e);
    }
}

function handleStudentAudioChunk(msg) {
    const pcmBase64 = msg.pcm;
    if (!pcmBase64) return;

    initOrResumeTeacherAudioPlayer();
    if (!teacherAudioPlayerCtx) return;

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
        const audioBuffer = teacherAudioPlayerCtx.createBuffer(1, float32.length, sampleRate);
        audioBuffer.copyToChannel(float32, 0);

        const source = teacherAudioPlayerCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(teacherAudioPlayerCtx.destination);

        const now = teacherAudioPlayerCtx.currentTime;
        if (nextStudentAudioPlayTime < now || (nextStudentAudioPlayTime - now) > 0.35) {
            nextStudentAudioPlayTime = now + 0.04;
        }

        source.start(nextStudentAudioPlayTime);
        nextStudentAudioPlayTime += audioBuffer.duration;
    } catch (e) {
        console.warn("Student audio chunk play error:", e);
    }
}

window.toggleChatDrawer = toggleChatDrawer;
window.sendTeacherChatMessage = sendTeacherChatMessage;
window.forceMuteSpeakingStudent = forceMuteSpeakingStudent;
window.muteAllStudents = muteAllStudents;

// ----------------- KHUNG CHAT & MICRO HỌC SINH LOCK/UNLOCK -----------------
let isChatEnabled = false;
let isStudentMicAllowed = false;

function toggleChatLock() {
    isChatEnabled = !isChatEnabled;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'TOGGLE_CHAT_LOCK',
            enabled: isChatEnabled
        }));
    }
    updateChatLockUI(isChatEnabled);
}
window.toggleChatLock = toggleChatLock;

function updateChatLockUI(enabled) {
    isChatEnabled = !!enabled;
    const btnLock = document.getElementById('btn-chat-lock');
    const lockIcon = document.getElementById('chat-lock-icon');
    const lockText = document.getElementById('chat-lock-text');
    const drawerBtn = document.getElementById('btn-drawer-chat-lock');
    const drawerIcon = document.getElementById('drawer-chat-lock-icon');
    const drawerText = document.getElementById('drawer-chat-lock-text');

    if (enabled) {
        if (btnLock) {
            btnLock.className = "px-2.5 sm:px-3 py-1.5 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition border border-emerald-500/50 cursor-pointer shadow-sm";
            btnLock.title = "Khung chat đang MỞ cho học sinh. Bấm để khóa lại.";
        }
        if (lockIcon) lockIcon.className = "fa-solid fa-comments text-emerald-400";
        if (lockText) lockText.textContent = "Chat HS: Mở";

        if (drawerBtn) {
            drawerBtn.className = "px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center space-x-1 transition border bg-emerald-950/80 border-emerald-500/60 text-emerald-300 hover:bg-emerald-900/80 cursor-pointer shadow-sm";
            drawerBtn.title = "Khung chat đang MỞ. Bấm để khóa.";
        }
        if (drawerIcon) drawerIcon.className = "fa-solid fa-comments text-emerald-400";
        if (drawerText) drawerText.textContent = "Chat HS: Mở";
    } else {
        if (btnLock) {
            btnLock.className = "px-2.5 sm:px-3 py-1.5 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-200 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition border border-slate-700 hover:border-rose-700/60 cursor-pointer";
            btnLock.title = "Khung chat đang TẮT đối với học sinh (mặc định). Bấm để mở cho học sinh chat.";
        }
        if (lockIcon) lockIcon.className = "fa-solid fa-comment-slash text-rose-400";
        if (lockText) lockText.textContent = "Chat HS: Tắt";

        if (drawerBtn) {
            drawerBtn.className = "px-2.5 py-1 rounded-lg text-[11px] font-bold flex items-center space-x-1 transition border bg-rose-950/80 border-rose-600/50 text-rose-300 hover:bg-rose-900/80 cursor-pointer shadow-sm";
            drawerBtn.title = "Khung chat đang TẮT. Bấm để mở.";
        }
        if (drawerIcon) drawerIcon.className = "fa-solid fa-comment-slash text-rose-400";
        if (drawerText) drawerText.textContent = "Chat HS: Tắt";
    }
}

function toggleStudentMicLock() {
    isStudentMicAllowed = !isStudentMicAllowed;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'TOGGLE_STUDENT_MIC_LOCK',
            allowed: isStudentMicAllowed
        }));
    }
    updateStudentMicLockUI(isStudentMicAllowed);
}
window.toggleStudentMicLock = toggleStudentMicLock;

function updateStudentMicLockUI(allowed) {
    isStudentMicAllowed = !!allowed;
    const btnLock = document.getElementById('btn-student-mic-lock');
    const lockIcon = document.getElementById('student-mic-lock-icon');
    const lockText = document.getElementById('student-mic-lock-text');

    if (allowed) {
        if (btnLock) {
            btnLock.className = "px-2.5 sm:px-3 py-1.5 bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition border border-emerald-500/50 cursor-pointer shadow-sm";
            btnLock.title = "Micro học sinh đang ĐƯỢC PHÉP phát biểu. Bấm để tắt/khóa lại.";
        }
        if (lockIcon) lockIcon.className = "fa-solid fa-microphone text-emerald-400";
        if (lockText) lockText.textContent = "Mic HS: Mở";
    } else {
        if (btnLock) {
            btnLock.className = "px-2.5 sm:px-3 py-1.5 bg-slate-800 hover:bg-rose-950/80 text-slate-300 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition border border-slate-700 cursor-pointer";
            btnLock.title = "Micro học sinh đang TẮT (mặc định khi trình chiếu). Bấm để cho phép học sinh phát biểu.";
        }
        if (lockIcon) lockIcon.className = "fa-solid fa-microphone-slash text-rose-400";
        if (lockText) lockText.textContent = "Mic HS: Tắt";
    }
}

// ----------------- EXIT LESSON & END SESSION -----------------
function confirmExitLesson(e) {
    if (e && e.preventDefault) e.preventDefault();
    const modal = document.getElementById('modal-confirm-exit');
    if (modal) modal.classList.remove('hidden');
}
window.confirmExitLesson = confirmExitLesson;

function closeExitModal() {
    const modal = document.getElementById('modal-confirm-exit');
    if (modal) modal.classList.add('hidden');
}
window.closeExitModal = closeExitModal;

async function executeExitLesson() {
    try {
        // Tắt micro nếu đang bật
        if (typeof isMicActive !== 'undefined' && isMicActive) {
            await toggleMicrophone().catch(() => {});
        }
        // Dừng chia sẻ màn hình nếu đang bật
        if (typeof isScreenSharing !== 'undefined' && isScreenSharing) {
            await toggleScreenShare().catch(() => {});
        }

        // Gửi thông báo thoát qua WebSocket
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'TEACHER_EXIT' }));
        }

        // Đồng thời gọi API exit để chắc chắn server cập nhật phòng đã kết thúc
        await fetch(`/api/room/${ROOM_ID}/exit`, { method: 'POST' }).catch(() => {});
    } catch (e) {
        console.warn("Exit lesson error:", e);
    } finally {
        // Chuyển về giao diện web ban đầu (trang chủ)
        window.location.href = '/';
    }
}
window.executeExitLesson = executeExitLesson;

// Mở khoá AudioContext của Giáo viên ngay khi có thao tác bất kỳ (Click, chạm, bấm phím)
document.addEventListener('click', () => { initOrResumeTeacherAudioPlayer(); }, { passive: true });
document.addEventListener('touchstart', () => { initOrResumeTeacherAudioPlayer(); }, { passive: true });
document.addEventListener('keydown', () => { initOrResumeTeacherAudioPlayer(); }, { passive: true });

// Chạy init ngay lập tức (không chờ DOMContentLoaded nếu đã sẵn sàng)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
