# 🎓 SmartClassroom - Trình Chiếu Thời Gian Thực & Kho Học Liệu Số

Hệ thống trình chiếu bài giảng trực tuyến không cần máy chiếu vật lý. Học sinh chỉ cần mở một liên kết duy nhất (hoặc quét mã QR) trên điện thoại, máy tính bảng hoặc laptop để theo dõi bài giảng của thầy/cô trong thời gian thực.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com)

---

## ✨ Tính Năng Nổi Bật

1. **Trình Chiếu Slide & Tài Liệu Thời Gian Thực:**
   - Hỗ trợ đầy đủ **PowerPoint (`.pptx`, `.ppt`)**, **Word (`.docx`)** và **PDF**.
   - Giữ nguyên 100% hình ảnh, sơ đồ, bảng biểu, công thức toán và bố cục thiết kế gốc (chuẩn đồ họa sắc nét 300 DPI).
   - Tự động đồng bộ chuyển trang (Slide sync), chế độ thu phóng (Zoom sync) và cuộn trang (Scroll sync) cho toàn bộ học sinh.

2. **Công Cụ Tương Tác Sư Phạm Trực Quan:**
   - **Đèn Laser đỏ phát sáng:** Giúp học sinh tập trung vào điểm giáo viên đang giải thích.
   - **Bút vẽ & Bút dạ quang (Highlighter):** Viết chú thích, vẽ hình minh họa trực tiếp lên slide.
   - **Xóa nét vẽ tức thì:** Giữ slide luôn gọn gàng và dễ nhìn.
   - **Thước điều khiển docked cố định:** 2 nút lật trang lớn cạnh màn hình cùng thanh công cụ luôn hiển thị.

3. **Chia Sẻ Màn Hình (WebRTC Live Stream):**
   - Giáo viên có thể chia sẻ toàn bộ màn hình máy tính hoặc từng cửa sổ ứng dụng (GeoGebra, trình duyệt, phần mềm mô phỏng) với độ trễ siêu thấp.

4. **Tạo PowerPoint Tự Động Bằng AI (Google Gemini):**
   - Tải lên giáo án Word/PDF hoặc nhập nội dung bài học, AI sẽ tự động phân tích cấu trúc và sinh file trình chiếu PowerPoint `.pptx` hoàn chỉnh để tải về hoặc giảng dạy ngay.

5. **Kho Học Liệu Số:**
   - Quản lý danh mục bài giảng, tìm kiếm theo môn học và khối lớp, chia sẻ link trực tiếp hoặc mã QR.

---

## 🚀 Triển Khai Lên Render (Deploy on Render)

### Cách 1: Triển khai nhanh qua Docker (Khuyên dùng - Có sẵn LibreOffice)
1. Đăng nhập vào [Render.com](https://render.com).
2. Chọn **New +** -> **Web Service**.
3. Kết nối với kho lưu trữ GitHub của bạn: `https://github.com/haidhsp2005-cyber/trinh_chieu_tu_xa`.
4. Render sẽ tự động nhận diện `Dockerfile`:
   - **Language / Environment:** `Docker`
   - **Region:** `Singapore` (độ trễ thấp nhất cho Việt Nam)
   - **Instance Type:** `Free`
5. Trong mục **Environment Variables** (nếu dùng tính năng AI tạo slide):
   - Thêm biến `GEMINI_API_KEY` (khóa API của bạn từ Google AI Studio).
6. Bấm **Create Web Service**. Render sẽ tự động build và cung cấp liên kết công khai (dạng `https://trinh-chieu-tu-xa.onrender.com`).

---

### Cách 2: Triển khai Native Python
Nếu muốn dùng môi trường Python thuần trên Render:
- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `python run.py`
- **Environment Variables:** `PORT=10000`

---

## 💻 Chạy Trực Tiếp Trên Máy Tính Cá Nhân (Local)

1. **Yêu cầu:** Đã cài Python 3.10 trở lên.
2. **Cài đặt thư viện:**
   ```bash
   pip install -r requirements.txt
   ```
3. **Khởi chạy hệ thống:**
   * Cách 1: Nhấp đúp chuột vào file `start.bat`.
   * Cách 2: Chạy lệnh terminal:
     ```bash
     python run.py
     ```
4. Hệ thống sẽ tự động bật trình duyệt:
   - Giáo viên: `http://localhost:8000`
   - Học sinh trong cùng mạng WiFi / LAN: `http://<IP-may-tinh>:8000`

---

## 📁 Cấu Trúc Thư Mục

```text
├── app/
│   ├── main.py              # Máy chủ FastAPI & WebSocket Signaling
│   ├── document_parser.py   # Bộ xử lý PowerPoint (COM / LibreOffice) & PDF sang ảnh 300 DPI
│   ├── ppt_generator.py     # AI Gemini tạo bài giảng PowerPoint
│   ├── storage.py           # Quản lý kho học liệu số
│   ├── templates/           # Giao diện Teacher, Student, Repository (Jinja2 + TailwindCSS)
│   └── static/js/           # Logic thời gian thực, Canvas vẽ, Laser pointer, WebRTC
├── requirements.txt         # Danh sách thư viện Python
├── Dockerfile               # Cấu hình container cho Render
├── render.yaml              # Cấu hình tự động triển khai Render
├── run.py                   # Script khởi chạy thông minh
└── start.bat                # Khởi động 1-click trên Windows
```
