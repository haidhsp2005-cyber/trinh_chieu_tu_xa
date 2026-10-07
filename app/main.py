import os
import shutil
import socket
import json
import uuid
import asyncio
from typing import Dict, List, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
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
        self.laser = {"x": -1, "y": -1, "active": False}
        self.drawings = []
        self.teacher_ws = None
        self.students: Dict[str, WebSocket] = {}

    def to_state_dict(self):
        return {
            "room_id": self.room_id,
            "title": self.title,
            "material_id": self.material_id,
            "doc_data": self.doc_data,
            "current_page": self.current_page,
            "mode": self.mode,
            "laser": self.laser,
            "drawings": self.drawings,
            "student_count": len(self.students)
        }

active_rooms: Dict[str, ClassroomSession] = {}

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
                session.doc_data = process_uploaded_document(mat["filepath"], CACHE_DIR)
                session.current_page = 1
                session.drawings = []
            except Exception as e:
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

    lan_ip = get_lan_ip()
    session = ensure_session_loaded(actual_room_id, material_id)
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
    if ext not in [".pdf", ".pptx", ".ppt", ".docx", ".doc"]:
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ file PDF, PPTX, DOCX")

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

# ----------------- WEBSOCKET REALTIME SYNC & WEBRTC -----------------

@app.websocket("/ws/{room_id}/{role}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, role: str):
    await websocket.accept()

    session = ensure_session_loaded(room_id)
    client_id = str(uuid.uuid4())[:8]

    if role == "teacher":
        session.teacher_ws = websocket
    else:
        session.students[client_id] = websocket

    # Gửi trạng thái ban đầu cho máy mới vào
    await websocket.send_json({
        "type": "INIT_STATE",
        "client_id": client_id,
        "role": role,
        "state": session.to_state_dict()
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

            # 1. Chuyển trang Slide
            if msg_type == "PAGE_CHANGE":
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

            # 6. Đồng bộ Phóng to Zoom và Cuộn trang PDF (Scroll & Zoom)
            elif msg_type in ["ZOOM_SYNC", "SCROLL_SYNC"]:
                await _broadcast_to_students(session, data)

            # 6. WebRTC Signaling (Chia sẻ màn hình P2P độ nét cao)
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

    except WebSocketDisconnect:
        if role == "teacher":
            session.teacher_ws = None
        else:
            if client_id in session.students:
                del session.students[client_id]

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
    for cid, ws in session.students.items():
        try:
            await ws.send_json(payload)
        except Exception:
            disconnected.append(cid)
    for cid in disconnected:
        if cid in session.students:
            del session.students[cid]
