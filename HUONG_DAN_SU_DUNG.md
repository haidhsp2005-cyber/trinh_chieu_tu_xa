# HƯỚNG DẪN SỬ DỤNG HỆ THỐNG SMARTCLASSROOM
### Giải pháp Giảng dạy & Trình chiếu Thời gian thực Không cần Màn chiếu

---

## 1. Cách khởi động hệ thống

### Cách 1: Khởi động nhanh bằng 1 click (Khuyên dùng)
- Trong thư mục `d:\Antigravity\trinh chieu luu tru`, nhấp đúp chuột vào file:
  👉 **`start.bat`**
- Trình duyệt sẽ tự động mở trang chủ tại địa chỉ: `http://localhost:8000`.

### Cách 2: Khởi động bằng dòng lệnh Terminal
```bash
python run.py
```

---

## 2. Hướng dẫn Giảng dạy cho Giáo viên

### Bước 1: Chuẩn bị học liệu số
- **Tải lên bài giảng có sẵn:** Hỗ trợ các định dạng file phổ biến:
  - Slide PowerPoint: `.pptx`, `.ppt`
  - Tài liệu PDF: `.pdf`
  - Giáo án / Văn bản Word: `.docx`, `.doc`
- **Tạo PowerPoint tự động từ Giáo án (AI Lesson-to-PPT):**
  - Chuyển sang thẻ **"Tạo bài giảng AI từ Giáo án"**.
  - Nhập Tên bài học, Môn học, Khối lớp.
  - Tải lên file giáo án Word/PDF hoặc dán nội dung văn bản.
  - Nhấn **"Tạo PowerPoint Ngay"** $\rightarrow$ Hệ thống tự động tạo file PowerPoint chuẩn bố cục sư phạm và chuyển hướng vào phòng trình chiếu.

### Bước 2: Bắt đầu Trình chiếu & Kết nối Học sinh
- Nhấn nút **"Bắt đầu trình chiếu"** trên bài giảng mong muốn.
- Nhấn nút **"Chia sẻ bài giảng"** (góc trên cùng bên phải):
  - Bảng chia sẻ sẽ hiện ra gồm:
    1. **Đường link trực tiếp cho học sinh** (Ví dụ: `http://192.168.1.15:8000/view/room_xyz`). Bấm nút **Sao chép** để gửi vào nhóm lớp.
    2. **Mã QR Code động**: Học sinh dùng điện thoại hoặc máy tính bảng quét mã là xem được ngay.
- Học sinh **không cần đăng ký tài khoản** và **không cần cài đặt phần mềm**.

### Bước 3: Điều khiển Trình chiếu trong Lớp học
- **Lật trang slide:**
  - Bấm nút mũi tên hoặc phím cách (Space), phím mũi tên trái/phải trên bàn phím.
  - Toàn bộ máy học sinh tự động chuyển trang theo thời gian thực (độ trễ < 50ms).
- **Con trỏ Laser ảo (Laser Pointer):**
  - Nhấn phím `L` hoặc chọn biểu tượng **Laser** trên thanh công cụ.
  - Khi giáo viên di chuột trên slide, một chấm laser đỏ phát sáng sẽ di chuyển mượt mà trên tất cả màn hình của học sinh.
- **Bút vẽ & Bút dạ quang (Highlighter):**
  - Chọn **Bút vẽ** (màu đỏ) hoặc **Highlight** (màu vàng) để gạch chân từ khóa, vẽ sơ đồ, nhấn mạnh công thức.
  - Nét vẽ tự động hiển thị tức thì trên máy học sinh.
- **Chia sẻ Màn hình Máy tính (Live Screen Share):**
  - Khi giáo viên muốn mở Geogebra, phần mềm thí nghiệm, video YouTube hay code:
  - Nhấn nút **"Chia sẻ màn hình"** $\rightarrow$ Chọn cửa sổ hoặc màn hình muốn phát.
  - Màn hình giáo viên sẽ được truyền trực tiếp đến toàn bộ máy học sinh với chất lượng cao.

---

## 3. Hoạt động trên Mạng Lớp học (WiFi & Phòng Tin Học)

- Hệ thống tự động phát hiện IP mạng nội bộ của giáo viên (ví dụ: `192.168.x.x`).
- Ngay cả khi **mất mạng Internet ngoài**, chỉ cần máy giáo viên và học sinh cùng kết nối vào một mạng WiFi lớp học hoặc mạng dây phòng máy tính, hệ thống vẫn hoạt động trơn tru với tốc độ tối đa!
