import os
import json
import time
import uuid

METADATA_FILE = os.path.join(os.path.dirname(__file__), "uploads", "materials.json")

def _load_data() -> list:
    if not os.path.exists(METADATA_FILE):
        return []
    try:
        with open(METADATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def _save_data(data: list):
    os.makedirs(os.path.dirname(METADATA_FILE), exist_ok=True)
    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def _normalize_item_path(item: dict) -> dict:
    if not item:
        return item
    raw_path = item.get("filepath", "")
    if raw_path and os.path.exists(raw_path):
        return item
    filename = os.path.basename(raw_path)
    local_path = os.path.join(os.path.dirname(__file__), "uploads", filename)
    if os.path.exists(local_path):
        item["filepath"] = local_path
        return item
    cwd_path = os.path.join(os.getcwd(), raw_path)
    if os.path.exists(cwd_path):
        item["filepath"] = cwd_path
        return item
    return item

def list_materials() -> list:
    items = _load_data()
    return [_normalize_item_path(m) for m in items]

def get_material(item_id: str) -> dict:
    for item in _load_data():
        if item["id"] == item_id:
            return _normalize_item_path(item)
    return None

def add_material(title: str, subject: str, grade: str, filename: str, filepath: str, file_format: str, size: int) -> dict:
    materials = _load_data()
    item_id = str(uuid.uuid4())[:8]
    item = {
        "id": item_id,
        "title": title,
        "subject": subject,
        "grade": grade,
        "filename": filename,
        "filepath": filepath,
        "format": file_format.lower().replace(".", ""),
        "size_kb": round(size / 1024, 1),
        "created_at": time.strftime("%d/%m/%Y %H:%M"),
        "allow_download": True
    }
    materials.insert(0, item)
    _save_data(materials)
    return item

def delete_material(item_id: str) -> bool:
    materials = _load_data()
    item = next((m for m in materials if m["id"] == item_id), None)
    if not item:
        return False
    
    # Remove physical file if exists
    if os.path.exists(item["filepath"]):
        try:
            os.remove(item["filepath"])
        except Exception:
            pass
            
    materials = [m for m in materials if m["id"] != item_id]
    _save_data(materials)
    return True
