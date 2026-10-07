import uvicorn
import socket
import webbrowser
import threading
import time
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def open_browser(url):
    time.sleep(1.5)
    print(f"[*] Đang tự động mở trình duyệt: {url}")
    try:
        webbrowser.open(url)
    except Exception:
        pass

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8000))
    is_cloud = "RENDER" in os.environ or os.environ.get("ENVIRONMENT") == "production" or sys.platform != "win32"
    lan_ip = get_lan_ip()

    print("=" * 65)
    print("   SMART CLASSROOM - HỆ THỐNG TRÌNH CHIẾU THỜI GIAN THỰC")
    print("=" * 65)
    print(f"[*] Cổng dịch vụ (Port): {port}")
    if not is_cloud:
        print(f"[*] Máy chủ Giáo viên (Localhost): http://localhost:{port}")
        print(f"[*] Mạng LAN lớp học (Cho học sinh): http://{lan_ip}:{port}")
        threading.Thread(target=open_browser, args=(f"http://localhost:{port}",), daemon=True).start()
    else:
        print("[*] Đang chạy chế độ Cloud / Render...")
    print("=" * 65)

    # Khởi chạy server uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=(not is_cloud))
