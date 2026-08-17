import base64


def convert_image(src, dst, target, quality=None):
    from PIL import Image, ImageOps
    fmt = target.upper()
    q = int(quality) if quality is not None else 90
    q = min(max(q, 1), 100)
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        if fmt == "JPG":
            if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
                bg = im.convert("RGB")
                rgb = im.convert("RGBA")
                alpha = rgb.split()[-1]
                bg.paste(rgb, mask=alpha)
                im = bg
            elif im.mode != "RGB":
                im = im.convert("RGB")
            im.save(dst, format="JPEG", quality=q, subsampling=1, optimize=True)
        elif fmt == "WEBP":
            im.save(dst, format="WEBP", quality=q, method=6)
        elif fmt == "PNG":
            im.save(dst, format="PNG",
                    compress_level=round(q / 100.0 * 9), optimize=True)
        elif fmt == "ICO":
            im.save(dst, format="ICO",
                    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
        else:
            im.save(dst, format=fmt)


def pdf_to_word(pdf_path, docx_path, on_page=None):
    from pdfminer.high_level import extract_pages
    from pdfminer.layout import LTTextContainer
    from docx import Document
    pages = list(extract_pages(pdf_path))
    total = len(pages)
    doc = Document()
    for idx, page in enumerate(pages, 1):
        for element in page:
            if isinstance(element, LTTextContainer):
                text = element.get_text().strip()
                if text:
                    doc.add_paragraph(text)
        if on_page is not None:
            on_page(idx, total)
        if idx < total:
            doc.add_page_break()
    doc.save(docx_path)


def write_b64(path, data):
    with open(path, "wb") as fh:
        fh.write(base64.b64decode(data))


def read_b64(path):
    with open(path, "rb") as fh:
        return base64.b64encode(fh.read()).decode("ascii")