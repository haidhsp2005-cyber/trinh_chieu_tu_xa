FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Cài đặt LibreOffice và font tiếng Việt/quốc tế để kết xuất PPTX và DOCX chuẩn đồ họa trên Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Tạo sẵn thư mục uploads và cache
RUN mkdir -p app/uploads app/cache

EXPOSE 8000

ENV PORT=8000
CMD ["python", "run.py"]
