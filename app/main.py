import os
import shutil
import socket
import json
import uuid
import asyncio
from datetime import datetime
from typing import Dict, List, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.document_parser import process_uploaded_document
from app.ppt_generator import generate_powerpoint_from_lesson
from app.storage import list_materials, add_material, delete_material, get_material

BASE_DIR = os.path.dirname(__file__)
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
CACHE_DIR = os.path.join(UPLOAD_DIR, "cache")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)

app = FastAPI(title="Smart Classroom - Realtime Presentation")

@app.get("/cache/{doc_id}/{filename}")
async def serve_cached_slide(doc_id: str, filename: str):
    import urllib.parse
    decoded_doc_id = urllib.parse.unquote(doc_id)
    headers = {"Cache-Control": "public, max-age=31536000, immutable"}

    # 1. Kiểm tra file đã có sẵn
    for cid in [doc_id, decoded_doc_id]:
        file_path = os.path.join(CACHE_DIR, cid, filename)
        if os.path.exists(file_path) and os.path.getsize(file_path) > 0:
            return FileResponse(file_path, headers=headers)

    # 2. Nếu chưa có ảnh, render tức thì on-demand trong ~50ms
    if filename.startswith("page_") and filename.endswith(".png"):
        try:
            page_num_str = filename.replace("page_", "").replace(".png", "")
            page_index = int(page_num_str) - 1

            doc_dir = None
            for cid in [doc_id, decoded_doc_id]:
                d = os.path.join(CACHE_DIR, cid)
                if os.path.isdir(d):
                    doc_dir = d
                    break

            if doc_dir:
                temp_pdf = os.path.join(doc_dir, "exported_slides.pdf")
                if not os.path.exists(temp_pdf):
                    candidates = [os.path.join(doc_dir, f) for f in os.listdir(doc_dir) if f.endswith(".pdf")]
                    if candidates:
                        temp_pdf = candidates[0]

                if os.path.exists(temp_pdf):
                    import pymupdf
                    doc = pymupdf.open(temp_pdf)
                    target_file = os.path.join(doc_dir, filename)
                    if page_index < len(doc):
                        mat = pymupdf.Matrix(1.6, 1.6)
                        pix = doc[page_index].get_pixmap(matrix=mat, alpha=False)
                        tmp_file_path = f"{target_file}.tmp.png"
                        pix.save(tmp_file_path, output="png")
                        os.replace(tmp_file_path, target_file)
                        del pix
                    doc.close()
                    del doc
                    if os.path.exists(target_file):
                        return FileResponse(target_file, headers=headers)
        except Exception as e:
            print(f"On-demand slide render error: {e}")

    for cid in [doc_id, decoded_doc_id]:
        fp = os.path.join(CACHE_DIR, cid, filename)
        if os.path.exists(fp):
            return FileResponse(fp, headers=headers)

    return Response(status_code=404)

app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")
app.mount("/cache", StaticFiles(directory=CACHE_DIR), name="cache")
app.mount("/files", StaticFiles(directory=UPLOAD_DIR), name="files")

templates = Jinja2Templates(directory=os.path.join(BASE_DIR, "templates"))

def get_lan_ip() -> str:
    """Lấy địa chỉ IP mạng nội bộ (LAN) để học sinh trong cùng WiFi có thể truy cập"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# State của các phòng học đang hoạt động
class ClassroomSession:
    def __init__(self, room_id: str, title: str = "Bài giảng trực tuyến"):
        self.room_id = room_id
        self.title = title
        self.material_id = None
        self.doc_data = None
        self.current_page = 1
        self.mode = "slides"  # "slides" hoặc "screen"
        self.mic_active = False # Trạng thái bật/tắt micro giáo viên
        self.laser = {"x": -1, "y": -1, "active": False}
        self.drawings = []
        self.chat_messages: List[Dict[str, Any]] = [] # Lịch sử tin nhắn phòng học
        self.speaking_student: Dict[str, Any] = None # Học sinh đang bật micro phát biểu
        self.teacher_ws = None
        self.students: Dict[str, WebSocket] = {}
        self.is_active = False # True khi giáo viên đang mở phòng trình chiếu
        self.chat_enabled = False # Mặc định tắt khung chat khi trình chiếu, giáo viên mở thì học sinh mới chat được
        self.student_mic_allowed = False # Mặc định tắt hết micro học sinh khi trình chiếu

    def to_state_dict(self):
        return {
            "room_id": self.room_id,
            "title": self.title,
            "material_id": self.material_id,
            "doc_data": self.doc_data,
            "current_page": self.current_page,
            "mode": self.mode,
            "mic_active": self.mic_active,
            "laser": self.laser,
            "drawings": self.drawings,
            "chat_messages": self.chat_messages[-50:],
            "speaking_student": self.speaking_student,
            "student_count": len(self.students),
            "is_active": self.is_active,
            "chat_enabled": self.chat_enabled,
            "student_mic_allowed": self.student_mic_allowed
        }

active_rooms: Dict[str, ClassroomSession] = {}
current_active_teacher_room_id: str = None

# ----------------- ROUTES GIAO DIỆN -----------------

@app.get("/", response_class=HTMLResponse)
async def index_page(request: Request):
    lan_ip = get_lan_ip()
    materials = list_materials()
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "lan_ip": lan_ip,
            "materials": materials
        }
    )

def ensure_session_loaded(room_id: str, material_id: str = None) -> ClassroomSession:
    # Chuẩn hóa room_id nếu truyền trực tiếp bằng material_id
    mat_direct = get_material(room_id)
    if mat_direct:
        room_id = f"room_{mat_direct['id']}"
        material_id = mat_direct['id']

    if room_id not in active_rooms:
        active_rooms[room_id] = ClassroomSession(room_id)
    session = active_rooms[room_id]

    if not material_id and session.material_id:
        material_id = session.material_id

    if not material_id:
        if room_id.startswith("room_"):
            candidate_id = room_id.replace("room_", "")
            if get_material(candidate_id):
                material_id = candidate_id

    all_materials = list_materials()
    if not material_id and all_materials:
        material_id = all_materials[0]["id"]

    if material_id and (session.doc_data is None or session.material_id != material_id):
        mat = get_material(material_id)
        if not mat and all_materials:
            mat = all_materials[0]
            material_id = mat["id"]
        if mat:
            session.material_id = material_id
            session.title = mat["title"]
            try:
                raw_path = mat.get("filepath", "")
                target_path = raw_path
                if not os.path.exists(target_path):
                    fname = os.path.basename(raw_path)
                    for alt in [
                        os.path.join(UPLOAD_DIR, fname),
                        os.path.join(BASE_DIR, "uploads", fname),
                        os.path.join(os.getcwd(), "app", "uploads", fname),
                        os.path.join(os.getcwd(), raw_path)
                    ]:
                        if os.path.exists(alt):
                            target_path = alt
                            break
                session.doc_data = process_uploaded_document(target_path, CACHE_DIR)
                session.current_page = 1
                session.drawings = []
            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"Error parsing document: {e}")
    return session

@app.get("/teacher/{room_id}", response_class=HTMLResponse)
async def teacher_view(request: Request, room_id: str, material_id: str = None):
    # Mỗi bài giảng có một link phòng cố định duy nhất (dạy cho mọi lớp)
    mat = get_material(room_id)
    if mat:
        actual_room_id = f"room_{mat['id']}"
        material_id = mat['id']
    else:
        actual_room_id = room_id

    global current_active_teacher_room_id
    current_active_teacher_room_id = actual_room_id

    lan_ip = get_lan_ip()
    session = ensure_session_loaded(actual_room_id, material_id)
    session.is_active = True
    all_materials = list_materials()

    return templates.TemplateResponse(
        request=request,
        name="teacher.html",
        context={
            "room_id": actual_room_id,
            "lan_ip": lan_ip,
            "session": session.to_state_dict(),
            "all_materials": all_materials
        }
    )

@app.get("/view/{room_id}", response_class=HTMLResponse)
async def student_view(request: Request, room_id: str):
    # Link cố định duy nhất cho học sinh của bài giảng này
    mat = get_material(room_id)
    if mat:
        actual_room_id = f"room_{mat['id']}"
        material_id = mat['id']
    else:
        actual_room_id = room_id
        material_id = None

    lan_ip = get_lan_ip()
    session = ensure_session_loaded(actual_room_id, material_id)

    return templates.TemplateResponse(
        request=request,
        name="student.html",
        context={
            "room_id": actual_room_id,
            "lan_ip": lan_ip,
            "session": session.to_state_dict(),
            "room_title": session.title
        }
    )

# ----------------- API QUẢN LÝ HỌC LIỆU & AI -----------------

@app.get("/api/server-info")
async def server_info():
    return {
        "lan_ip": get_lan_ip(),
        "port": 8000
    }

@app.get("/api/materials")
async def get_all_materials():
    return list_materials()

@app.post("/api/materials/upload")
async def upload_material(
    file: UploadFile = File(...),
    title: str = Form(""),
    subject: str = Form("Chung"),
    grade: str = Form("10")
):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in [".pdf", ".pptx", ".ppt", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".webp"]:
        raise HTTPException(status_code=400, detail="Hỗ trợ file PDF, PPTX, DOCX, hình ảnh (PNG, JPG)")

    doc_uuid = str(uuid.uuid4())[:8]
    safe_name = f"{doc_uuid}_{file.filename}"
    save_path = os.path.join(UPLOAD_DIR, safe_name)

    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    file_size = os.path.getsize(save_path)
    mat_title = title if title.strip() else os.path.splitext(file.filename)[0]

    item = add_material(
        title=mat_title,
        subject=subject,
        grade=grade,
        filename=file.filename,
        filepath=save_path,
        file_format=ext,
        size=file_size
    )

    # Tiền xử lý chuyển đổi slide ngay khi tải lên
    try:
        process_uploaded_document(save_path, CACHE_DIR)
    except Exception as e:
        print(f"Warning parsing document on upload: {e}")

    return item

@app.post("/api/materials/generate-ppt")
async def create_ppt_from_lesson(
    title: str = Form(...),
    subject: str = Form("Toán học"),
    grade: str = Form("10"),
    lesson_text: str = Form(""),
    lesson_file: UploadFile = File(None),
    gemini_api_key: str = Form(None)
):
    content_text = lesson_text

    # Nếu người dùng tải lên file giáo án Word/PDF
    if lesson_file and lesson_file.filename:
        temp_path = os.path.join(UPLOAD_DIR, f"temp_{uuid.uuid4().hex[:6]}_{lesson_file.filename}")
        with open(temp_path, "wb") as buf:
            shutil.copyfileobj(lesson_file.file, buf)
        
        ext = os.path.splitext(lesson_file.filename)[1].lower()
        if ext in [".docx", ".doc"]:
            import docx
            d = docx.Document(temp_path)
            content_text = "\n".join([p.text for p in d.paragraphs if p.text.strip()])
        elif ext == ".pdf":
            import pymupdf
            doc = pymupdf.open(temp_path)
            content_text = "\n".join([page.get_text() for page in doc])
            doc.close()
        
        try:
            os.remove(temp_path)
        except Exception:
            pass

    if not content_text.strip():
        content_text = f"Nội dung bài học môn {subject} lớp {grade}: {title}"

    import re
    clean_title = re.sub(r'[\\/*?:"<>|]', '', title).strip().replace(" ", "_")
    ppt_filename = f"baigiang_{uuid.uuid4().hex[:6]}_{clean_title[:30]}.pptx"
    output_path = os.path.join(UPLOAD_DIR, ppt_filename)

    res = generate_powerpoint_from_lesson(
        title=title,
        subject=subject,
        grade=grade,
        lesson_text=content_text,
        output_path=output_path,
        gemini_api_key=gemini_api_key
    )

    # Thêm vào kho học liệu
    item = add_material(
        title=f"[AI Bài giảng] {title}",
        subject=subject,
        grade=grade,
        filename=ppt_filename,
        filepath=output_path,
        file_format=".pptx",
        size=os.path.getsize(output_path)
    )

    # Pre-parse cho trình chiếu
    process_uploaded_document(output_path, CACHE_DIR)

    return {"status": "success", "material": item, "details": res}

@app.delete("/api/materials/{item_id}")
async def remove_material_api(item_id: str):
    success = delete_material(item_id)
    return {"success": success}

@app.post("/api/room/{room_id}/exit")
async def exit_room_api(room_id: str):
    global current_active_teacher_room_id
    mat = get_material(room_id)
    actual_room_id = f"room_{mat['id']}" if mat else room_id
    if actual_room_id in active_rooms:
        session = active_rooms[actual_room_id]
        session.is_active = False
        session.teacher_ws = None
        if current_active_teacher_room_id == actual_room_id:
            current_active_teacher_room_id = None
        await _broadcast_to_students(session, {
            "type": "TEACHER_EXITED",
            "message": "Giáo viên đã tắt không trình chiếu bài giảng này."
        })
    return {"status": "success"}

# ----------------- WEBSOCKET REALTIME SYNC & WEBRTC -----------------

@app.websocket("/ws/{room_id}/{role}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, role: str):
    global current_active_teacher_room_id
    await websocket.accept()

    session = ensure_session_loaded(room_id)
    client_id = str(uuid.uuid4())[:8]

    if role == "teacher":
        current_active_teacher_room_id = room_id
        session.teacher_ws = websocket
        session.is_active = True
        session.student_mic_allowed = False # Mặc định tắt hết micro học sinh khi trình chiếu
        session.chat_enabled = False # Mặc định tắt khung chat khi trình chiếu
        session.speaking_student = None
        # Tắt toàn bộ mic của học sinh nếu có
        for sid, s_ws in list(session.students.items()):
            try:
                await s_ws.send_json({"type": "FORCE_MUTE", "mute_all": True})
            except Exception:
                pass
        # Báo cho các học sinh đang trong phòng rằng giáo viên đã kết nối và đang trình chiếu
        await _broadcast_to_students(session, {
            "type": "TEACHER_STARTED_SESSION",
            "state": session.to_state_dict()
        })
    else:
        session.students[client_id] = websocket

    is_old_link = False
    active_teacher_room = None
    active_teacher_title = ""
    if role == "student" and session.teacher_ws is None and current_active_teacher_room_id and current_active_teacher_room_id != room_id:
        active_sess = active_rooms.get(current_active_teacher_room_id)
        if active_sess and active_sess.teacher_ws is not None:
            is_old_link = True
            active_teacher_room = current_active_teacher_room_id
            active_teacher_title = active_sess.title

    # Gửi trạng thái ban đầu cho máy mới vào
    await websocket.send_json({
        "type": "INIT_STATE",
        "client_id": client_id,
        "role": role,
        "state": session.to_state_dict(),
        "is_old_link": is_old_link,
        "active_teacher_room": active_teacher_room,
        "active_teacher_title": active_teacher_title
    })

    # Báo cho giáo viên số lượng học sinh cập nhật
    if session.teacher_ws:
        try:
            await session.teacher_ws.send_json({
                "type": "STUDENT_COUNT",
                "count": len(session.students)
            })
        except Exception:
            pass

    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")

            # 0. Giáo viên chủ động kết thúc & thoát bài giảng
            if msg_type == "TEACHER_EXIT":
                session.is_active = False
                session.teacher_ws = None
                if current_active_teacher_room_id == room_id:
                    current_active_teacher_room_id = None
                await _broadcast_to_students(session, {
                    "type": "TEACHER_EXITED",
                    "message": "Giáo viên đã tắt không trình chiếu bài giảng này."
                })

            # 1. Chuyển trang Slide
            elif msg_type == "PAGE_CHANGE":
                page = data.get("page", 1)
                session.current_page = page
                session.laser = {"x": -1, "y": -1, "active": False}
                # Phát cho toàn bộ học sinh
                await _broadcast_to_students(session, {
                    "type": "PAGE_CHANGE",
                    "page": page
                })

            # 2. Con trỏ Laser ảo (Laser pointer)
            elif msg_type == "LASER_MOVE":
                session.laser = {
                    "x": data.get("x", -1),
                    "y": data.get("y", -1),
                    "active": data.get("active", False)
                }
                await _broadcast_to_students(session, {
                    "type": "LASER_MOVE",
                    "laser": session.laser
                })

            # 3. Vẽ chú thích (Pen / Highlight)
            elif msg_type == "DRAW_STROKE":
                stroke = data.get("stroke")
                if stroke:
                    session.drawings.append(stroke)
                    await _broadcast_to_students(session, {
                        "type": "DRAW_STROKE",
                        "stroke": stroke
                    })

            # 4. Xóa nét vẽ
            elif msg_type == "CLEAR_DRAWINGS":
                session.drawings = []
                await _broadcast_to_students(session, {
                    "type": "CLEAR_DRAWINGS"
                })

            # 5. Đổi chế độ: Trình chiếu Slide <-> Chia sẻ màn hình
            elif msg_type == "SWITCH_MODE":
                new_mode = data.get("mode", "slides")
                session.mode = new_mode
                await _broadcast_to_students(session, {
                    "type": "SWITCH_MODE",
                    "mode": new_mode
                })

            # Truyền hình ảnh chia sẻ màn hình trực tiếp từ Giáo viên tới Học sinh
            elif msg_type == "SCREEN_FRAME":
                await _broadcast_to_students(session, {
                    "type": "SCREEN_FRAME",
                    "frame": data.get("frame")
                })

            # Truyền giọng nói Micro thời gian thực từ Giáo viên tới Học sinh
            elif msg_type == "AUDIO_CHUNK":
                await _broadcast_to_students(session, {
                    "type": "AUDIO_CHUNK",
                    "pcm": data.get("pcm"),
                    "sample_rate": data.get("sample_rate", 16000),
                    "audio": data.get("audio") or data.get("chunk"),
                    "mime_type": data.get("mime_type", "")
                })

            # Trạng thái Bật/Tắt Micro của Giáo viên
            elif msg_type == "MIC_STATUS":
                active = data.get("active", False)
                session.mic_active = active
                await _broadcast_to_students(session, {
                    "type": "MIC_STATUS",
                    "active": active
                })

            # 6. Bật/Tắt Khung Chat cho Học sinh (Do Giáo viên điều khiển)
            elif msg_type == "TOGGLE_CHAT_LOCK":
                if role == "teacher":
                    new_val = data.get("enabled")
                    if new_val is None:
                        session.chat_enabled = not session.chat_enabled
                    else:
                        session.chat_enabled = bool(new_val)
                    await _broadcast_to_all(session, {
                        "type": "CHAT_LOCK_STATUS",
                        "chat_enabled": session.chat_enabled
                    })

            # 7. Tin nhắn Trò chuyện / Hỏi đáp (Chat Realtime 2 chiều)
            elif msg_type == "CHAT_MESSAGE":
                if role == "student" and not session.chat_enabled:
                    # Khung chat đang bị khóa đối với học sinh
                    await websocket.send_json({
                        "type": "CHAT_LOCK_STATUS",
                        "chat_enabled": False,
                        "notice": "Thầy/Cô đang tạm khóa khung chat."
                    })
                    continue
                text = str(data.get("text", "")).strip()
                if text:
                    sender = str(data.get("sender", "Thầy/Cô" if role == "teacher" else "Học sinh")).strip()
                    time_str = datetime.now().strftime("%H:%M")
                    msg_obj = {
                        "id": str(uuid.uuid4())[:8],
                        "sender": sender,
                        "role": role,
                        "text": text,
                        "time": time_str
                    }
                    session.chat_messages.append(msg_obj)
                    if len(session.chat_messages) > 100:
                        session.chat_messages.pop(0)

                    await _broadcast_to_all(session, {
                        "type": "CHAT_MESSAGE",
                        "message": msg_obj
                    })

            # 7b. Bật/Tắt Quyền Micro Học sinh (Mặc định: TẮT khi trình chiếu)
            elif msg_type == "TOGGLE_STUDENT_MIC_LOCK":
                if role == "teacher":
                    new_val = data.get("allowed")
                    if new_val is None:
                        session.student_mic_allowed = not session.student_mic_allowed
                    else:
                        session.student_mic_allowed = bool(new_val)
                    if not session.student_mic_allowed:
                        session.speaking_student = None
                        for sid, s_ws in list(session.students.items()):
                            try:
                                await s_ws.send_json({"type": "FORCE_MUTE", "mute_all": True})
                            except Exception:
                                pass
                    await _broadcast_to_all(session, {
                        "type": "STUDENT_MIC_LOCK_STATUS",
                        "allowed": session.student_mic_allowed
                    })

            # 8. Trạng thái Bật/Tắt Micro của Học sinh
            elif msg_type == "STUDENT_MIC_STATUS":
                active = bool(data.get("active", False))
                sender = str(data.get("sender", "Học sinh")).strip()

                if active and not session.student_mic_allowed:
                    # Micro học sinh đang bị tắt/khóa bởi Thầy/Cô
                    await websocket.send_json({
                        "type": "FORCE_MUTE",
                        "not_allowed": True
                    })
                    continue

                if active:
                    session.speaking_student = {"id": client_id, "name": sender}
                else:
                    if session.speaking_student and session.speaking_student.get("id") == client_id:
                        session.speaking_student = None

                await _broadcast_to_all(session, {
                    "type": "STUDENT_MIC_STATUS",
                    "student_id": client_id,
                    "student_name": sender,
                    "active": active
                })

            # 9. Truyền âm thanh Micro từ Học sinh tới Giáo viên và các bạn
            elif msg_type == "STUDENT_AUDIO_CHUNK":
                if not session.student_mic_allowed:
                    continue
                pcm = data.get("pcm")
                if pcm:
                    sender = str(data.get("sender", "Học sinh")).strip()
                    sample_rate = data.get("sample_rate", 16000)
                    chunk_payload = {
                        "type": "STUDENT_AUDIO_CHUNK",
                        "student_id": client_id,
                        "student_name": sender,
                        "pcm": pcm,
                        "sample_rate": sample_rate
                    }
                    # Gửi tới Giáo viên để nghe học sinh phát biểu
                    if session.teacher_ws:
                        try:
                            await session.teacher_ws.send_json(chunk_payload)
                        except Exception:
                            pass
                    # Gửi tới các học sinh khác trong lớp
                    for sid, s_ws in list(session.students.items()):
                        if sid != client_id:
                            try:
                                await s_ws.send_json(chunk_payload)
                            except Exception:
                                pass

            # 9. Giáo viên tắt micro của học sinh cụ thể (Force Mute)
            elif msg_type == "TEACHER_MUTE_STUDENT":
                target_id = data.get("student_id")
                if target_id and target_id in session.students:
                    try:
                        await session.students[target_id].send_json({
                            "type": "FORCE_MUTE"
                        })
                    except Exception:
                        pass
                if session.speaking_student and session.speaking_student.get("id") == target_id:
                    session.speaking_student = None
                await _broadcast_to_all(session, {
                    "type": "STUDENT_MIC_STATUS",
                    "student_id": target_id,
                    "student_name": "",
                    "active": False
                })

            # 9b. Giáo viên tắt TẤT CẢ micro của toàn bộ học sinh (Mute All Students)
            elif msg_type == "TEACHER_MUTE_ALL_STUDENTS":
                session.speaking_student = None
                # Gửi lệnh FORCE_MUTE tới toàn bộ học sinh đang kết nối
                for sid, s_ws in list(session.students.items()):
                    try:
                        await s_ws.send_json({
                            "type": "FORCE_MUTE",
                            "mute_all": True
                        })
                    except Exception:
                        pass
                await _broadcast_to_all(session, {
                    "type": "STUDENT_MIC_STATUS",
                    "student_id": None,
                    "student_name": "",
                    "active": False
                })

            # 10. Đồng bộ Phóng to Zoom và Cuộn trang PDF (Scroll & Zoom)
            elif msg_type in ["ZOOM_SYNC", "SCROLL_SYNC"]:
                await _broadcast_to_students(session, data)

            # 11. WebRTC Signaling (Chia sẻ màn hình P2P độ nét cao)
            elif msg_type in ["WEBRTC_OFFER", "WEBRTC_ANSWER", "WEBRTC_CANDIDATE"]:
                target_id = data.get("target")
                if target_id and target_id in session.students:
                    # Gửi tới học sinh cụ thể
                    try:
                        await session.students[target_id].send_json(data)
                    except Exception:
                        pass
                elif role == "student" and session.teacher_ws:
                    # Học sinh gửi answer/candidate về cho giáo viên
                    data["from"] = client_id
                    try:
                        await session.teacher_ws.send_json(data)
                    except Exception:
                        pass

    except (WebSocketDisconnect, Exception):
        if role == "teacher":
            session.teacher_ws = None
            if current_active_teacher_room_id == room_id:
                current_active_teacher_room_id = None
        else:
            if client_id in session.students:
                del session.students[client_id]

            if session.speaking_student and session.speaking_student.get("id") == client_id:
                session.speaking_student = None
                await _broadcast_to_all(session, {
                    "type": "STUDENT_MIC_STATUS",
                    "student_id": client_id,
                    "student_name": "",
                    "active": False
                })

        if session.teacher_ws:
            try:
                await session.teacher_ws.send_json({
                    "type": "STUDENT_COUNT",
                    "count": len(session.students)
                })
            except Exception:
                pass

async def _broadcast_to_students(session: ClassroomSession, payload: dict):
    disconnected = []
    for cid, ws in list(session.students.items()):
        try:
            await ws.send_json(payload)
        except Exception:
            disconnected.append(cid)
    for cid in disconnected:
        if cid in session.students:
            del session.students[cid]

async def _broadcast_to_all(session: ClassroomSession, payload: dict):
    if session.teacher_ws:
        try:
            await session.teacher_ws.send_json(payload)
        except Exception:
            session.teacher_ws = None
    await _broadcast_to_students(session, payload)
