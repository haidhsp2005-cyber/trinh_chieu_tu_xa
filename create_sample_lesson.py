import os
import sys

# Ensure UTF-8 output on Windows console
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# Ensure app is in path
sys.path.insert(0, os.path.dirname(__file__))

from app.ppt_generator import generate_powerpoint_from_lesson
from app.document_parser import process_uploaded_document
from app.storage import add_material

def create_sample():
    upload_dir = os.path.join(os.path.dirname(__file__), "app", "uploads")
    cache_dir = os.path.join(upload_dir, "cache")
    os.makedirs(upload_dir, exist_ok=True)
    os.makedirs(cache_dir, exist_ok=True)

    sample_pptx_path = os.path.join(upload_dir, "mau_bai_giang_ba_dinh_luat_newton.pptx")

    lesson_text = """I. MỤC TIÊU BÀI HỌC
- Nắm vững khái niệm quán tính và nội dung 3 định luật Newton.
- Vận dụng biểu thức F = m.a để tính toán gia tốc và lực tác dụng.
- Hiểu được bản chất cặp lực và phản lực trong tự nhiên.

II. HOẠT ĐỘNG KHỞI ĐỘNG
- Hiện tượng thực tế: Khi xe phanh gấp hoặc rẽ đột ngột, hành khách nghiêng người theo hướng nào?
- Thảo luận nhóm: Nguyên nhân gì khiến vật có xu hướng giữ nguyên vận tốc?

III. HÌNH THÀNH KIẾN THỨC
1. Định luật I Newton (Quán tính)
- Một vật đứng yên hoặc chuyển động thẳng đều nếu không chịu lực nào tác dụng, hoặc hợp lực bằng 0.
- Khái niệm hệ quy chiếu quán tính.
2. Định luật II Newton (Động lực học)
- Gia tốc của một vật tỉ lệ thuận với hợp lực tác dụng và tỉ lệ nghịch với khối lượng: a = F / m.
- Khối lượng là số đo mức quán tính của vật thể.
3. Định luật III Newton (Tương tác)
- Trong mọi trường hợp, khi vật A tác dụng lên vật B một lực, thì vật B cũng tác dụng lại vật A một lực.
- Hai lực này cùng giá, cùng độ lớn, ngược chiều và đặt vào hai vật khác nhau (không triệt tiêu nhau).

IV. LUYỆN TẬP & VẬN DỤNG
- Ví dụ: Người nhảy từ thuyền lên bờ, tại sao thuyền bị đẩy lùi về phía sau?
- Ứng dụng nguyên lý phản lực trong động cơ phản lực và phóng tên lửa vũ trụ.

V. HƯỚNG DẪN TỰ HỌC
- Làm bài tập 1, 2, 3 trong SGK trang 45.
- Chuẩn bị bài thí nghiệm đo lực ma sát trong tiết học tiếp theo."""

    print("[*] Đang tạo bài giảng mẫu PowerPoint...")
    res = generate_powerpoint_from_lesson(
        title="Ba Định Luật Newton Về Chuyển Động",
        subject="Vật Lý",
        grade="10",
        lesson_text=lesson_text,
        output_path=sample_pptx_path
    )

    item = add_material(
        title="[Mẫu] Ba Định Luật Newton Về Chuyển Động",
        subject="Vật Lý",
        grade="10",
        filename="mau_bai_giang_ba_dinh_luat_newton.pptx",
        filepath=sample_pptx_path,
        file_format=".pptx",
        size=os.path.getsize(sample_pptx_path)
    )

    process_uploaded_document(sample_pptx_path, cache_dir)
    print(f"[✓] Đã tạo bài giảng mẫu thành công: {sample_pptx_path}")

if __name__ == "__main__":
    create_sample()
