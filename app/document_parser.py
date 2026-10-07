import os
import io
import json
import uuid
import pymupdf
import docx
from pptx import Presentation
from PIL import Image

def _load_cached_manifest(output_dir: str) -> dict | None:
    manifest_file = os.path.join(output_dir, "manifest.json")
    if os.path.exists(manifest_file):
        try:
            with open(manifest_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("mode") == "image":
                    first_img = os.path.join(output_dir, "page_1.png")
                    if os.path.exists(first_img):
                        return data
                elif data.get("pages"):
                    return data
        except Exception:
            pass
    return None

def _save_manifest(output_dir: str, data: dict):
    try:
        manifest_file = os.path.join(output_dir, "manifest.json")
        with open(manifest_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Warning saving manifest: {e}")

def _convert_pptx_to_pdf_com(input_path: str, output_pdf_path: str) -> bool:
    """Uses Microsoft PowerPoint via Windows COM automation to export PPTX to PDF."""
    try:
        import comtypes
        import comtypes.client
        comtypes.CoInitialize()
        ppt_app = None
        pres = None
        try:
            ppt_app = comtypes.client.CreateObject('PowerPoint.Application')
            try:
                ppt_app.DisplayAlerts = 1  # ppAlertsNone
            except Exception:
                pass
            # Open(FileName, ReadOnly, Untitled, WithWindow)
            pres = ppt_app.Presentations.Open(os.path.abspath(input_path), True, False, False)
            pres.SaveAs(os.path.abspath(output_pdf_path), 32)  # 32 = ppSaveAsPDF
            return True
        finally:
            if pres:
                try:
                    pres.Close()
                except Exception:
                    pass
            if ppt_app:
                try:
                    ppt_app.Quit()
                except Exception:
                    pass
            comtypes.CoUninitialize()
    except Exception as e:
        print(f"PowerPoint COM export error: {e}")
        return False

def _convert_docx_to_pdf_com(input_path: str, output_pdf_path: str) -> bool:
    """Uses Microsoft Word via Windows COM automation to export DOCX to PDF."""
    try:
        import comtypes
        import comtypes.client
        comtypes.CoInitialize()
        word_app = None
        doc = None
        try:
            word_app = comtypes.client.CreateObject('Word.Application')
            word_app.Visible = False
            try:
                word_app.DisplayAlerts = 0  # wdAlertsNone
            except Exception:
                pass
            doc = word_app.Documents.Open(os.path.abspath(input_path), ReadOnly=True)
            doc.SaveAs(os.path.abspath(output_pdf_path), FileFormat=17)  # 17 = wdFormatPDF
            return True
        finally:
            if doc:
                try:
                    doc.Close()
                except Exception:
                    pass
            if word_app:
                try:
                    word_app.Quit()
                except Exception:
                    pass
            comtypes.CoUninitialize()
    except Exception as e:
        print(f"Word COM export error: {e}")
        return False

def _convert_office_linux(input_path: str, output_pdf_path: str) -> bool:
    """Uses headless LibreOffice if available on Linux / Render / Docker."""
    if os.name == 'nt':
        return False
    import subprocess
    import shutil
    cmd = shutil.which("soffice") or shutil.which("libreoffice")
    if not cmd:
        return False
    try:
        out_dir = os.path.dirname(output_pdf_path)
        subprocess.run([
            cmd, "--headless", "--convert-to", "pdf",
            os.path.abspath(input_path),
            "--outdir", os.path.abspath(out_dir)
        ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
        
        base_name = os.path.splitext(os.path.basename(input_path))[0]
        gen_pdf = os.path.join(out_dir, f"{base_name}.pdf")
        if os.path.exists(gen_pdf):
            if gen_pdf != output_pdf_path:
                if os.path.exists(output_pdf_path):
                    os.remove(output_pdf_path)
                shutil.move(gen_pdf, output_pdf_path)
            return True
    except Exception as e:
        print(f"Linux LibreOffice convert error: {e}")
    return False

def _render_pdf_to_images(pdf_path: str, output_dir: str, doc_id: str, format_name: str) -> dict:
    """Renders PDF pages into 300 DPI high-resolution PNG images."""
    doc = pymupdf.open(pdf_path)
    pages = []
    zoom = 2.0  # Sharp 300 DPI rendering
    mat = pymupdf.Matrix(zoom, zoom)

    for i, page in enumerate(doc):
        page_num = i + 1
        img_filename = f"page_{page_num}.png"
        img_path = os.path.join(output_dir, img_filename)
        
        if not os.path.exists(img_path):
            pix = page.get_pixmap(matrix=mat)
            pix.save(img_path)

        rect = page.rect
        aspect_ratio = "16:9" if (rect.width > rect.height * 1.3) else "portrait"

        pages.append({
            "page_num": page_num,
            "image_url": f"/cache/{doc_id}/{img_filename}",
            "text": page.get_text()[:300],
            "aspect_ratio": aspect_ratio
        })
    doc.close()

    result = {
        "format": format_name,
        "mode": "image",
        "total_pages": len(pages),
        "pages": pages
    }
    _save_manifest(output_dir, result)
    return result

def process_uploaded_document(file_path: str, cache_dir: str) -> dict:
    """
    Parses PDF, DOCX, or PPTX into a structured slide presentation format.
    Priority:
    - High-fidelity visual images (PPTX / DOCX / PDF converted to high-res slide images)
    - Fallback: structured text cards
    """
    ext = os.path.splitext(file_path)[1].lower()
    doc_id = os.path.basename(file_path).replace(".", "_")
    output_dir = os.path.join(cache_dir, doc_id)
    os.makedirs(output_dir, exist_ok=True)

    if not ext:
        if "baigiang" in file_path or "mau_bai_giang" in file_path:
            ext = ".pptx"

    if ext == ".pdf":
        return _process_pdf(file_path, output_dir, doc_id)
    elif ext in [".pptx", ".ppt"]:
        return _process_pptx(file_path, output_dir, doc_id)
    elif ext in [".docx", ".doc"]:
        return _process_docx(file_path, output_dir, doc_id)
    else:
        try:
            return _process_pptx(file_path, output_dir, doc_id)
        except Exception:
            raise ValueError(f"Định dạng {ext} chưa được hỗ trợ.")

def _process_pdf(file_path: str, output_dir: str, doc_id: str) -> dict:
    manifest = _load_cached_manifest(output_dir)
    if manifest:
        return manifest
    return _render_pdf_to_images(file_path, output_dir, doc_id, "pdf")

def _process_pptx(file_path: str, output_dir: str, doc_id: str) -> dict:
    # 1. Cached manifest check
    manifest = _load_cached_manifest(output_dir)
    if manifest:
        return manifest

    # 2. High-fidelity Microsoft PowerPoint COM conversion (Windows)
    temp_pdf = os.path.join(output_dir, "exported_slides.pdf")
    converted = False
    if os.name == 'nt':
        converted = _convert_pptx_to_pdf_com(file_path, temp_pdf)
    if not converted:
        converted = _convert_office_linux(file_path, temp_pdf)

    if converted and os.path.exists(temp_pdf) and os.path.getsize(temp_pdf) > 0:
        return _render_pdf_to_images(temp_pdf, output_dir, doc_id, "pptx")

    # 3. Fallback to python-pptx cards
    return _fallback_process_pptx_cards(file_path, output_dir)

def _fallback_process_pptx_cards(file_path: str, output_dir: str) -> dict:
    prs = Presentation(file_path)
    pages = []

    for idx, slide in enumerate(prs.slides):
        page_num = idx + 1
        title = ""
        bullet_points = []
        
        for shape in slide.shapes:
            if shape.has_text_frame:
                text = shape.text.strip()
                if not text:
                    continue
                if not title and (shape.name.startswith("Title") or len(text) < 80):
                    title = text
                else:
                    lines = [line.strip() for line in text.split("\n") if line.strip()]
                    bullet_points.extend(lines)

        if not title:
            title = f"Slide {page_num}"

        pages.append({
            "page_num": page_num,
            "title": title,
            "bullets": bullet_points,
            "mode": "card"
        })

    result = {
        "format": "pptx",
        "mode": "cards",
        "total_pages": len(pages),
        "pages": pages
    }
    _save_manifest(output_dir, result)
    return result

def _process_docx(file_path: str, output_dir: str, doc_id: str) -> dict:
    # 1. Cached manifest check
    manifest = _load_cached_manifest(output_dir)
    if manifest:
        return manifest

    # 2. High-fidelity Microsoft Word COM conversion (Windows)
    temp_pdf = os.path.join(output_dir, "exported_doc.pdf")
    converted = False
    if os.name == 'nt':
        converted = _convert_docx_to_pdf_com(file_path, temp_pdf)
    if not converted:
        converted = _convert_office_linux(file_path, temp_pdf)

    if converted and os.path.exists(temp_pdf) and os.path.getsize(temp_pdf) > 0:
        return _render_pdf_to_images(temp_pdf, output_dir, doc_id, "docx")

    # 3. Fallback to python-docx cards
    return _fallback_process_docx_cards(file_path, output_dir)

def _fallback_process_docx_cards(file_path: str, output_dir: str) -> dict:
    doc = docx.Document(file_path)
    slides = []
    current_title = "Giới thiệu & Tổng quan"
    current_bullets = []

    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        
        if para.style.name.startswith("Heading") or text.startswith(("I.", "II.", "III.", "IV.", "V.", "Phần", "Bài")):
            if current_bullets:
                slides.append({
                    "page_num": len(slides) + 1,
                    "title": current_title,
                    "bullets": current_bullets,
                    "mode": "card"
                })
                current_bullets = []
            current_title = text
        else:
            current_bullets.append(text)

    if current_bullets or len(slides) == 0:
        slides.append({
            "page_num": len(slides) + 1,
            "title": current_title,
            "bullets": current_bullets,
            "mode": "card"
        })

    result = {
        "format": "docx",
        "mode": "cards",
        "total_pages": len(slides),
        "pages": slides
    }
    _save_manifest(output_dir, result)
    return result
