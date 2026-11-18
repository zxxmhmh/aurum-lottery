"""从 WPS 的 DISPIMG 单元格图片里抽出奖项样品图，转成 JPEG。"""
import io
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

from PIL import Image
from openpyxl import load_workbook

src = sys.argv[1]
out_dir = sys.argv[2]
os.makedirs(out_dir, exist_ok=True)

wb = load_workbook(src, read_only=True, data_only=True)
ws = wb.worksheets[0]
rows = list(ws.iter_rows(min_row=1, max_row=3, values_only=True))
levels = [str(v) if v is not None else "" for v in rows[0]]
names = [str(v) if v is not None else "" for v in rows[1]]
ids = []
for cell in rows[2]:
    m = re.search(r"DISPIMG\(\"([^\"]+)\"", str(cell or ""))
    ids.append(m.group(1) if m else "")

NS = {
    "etc": "http://www.wps.cn/officeDocument/2017/etCustomData",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
}

z = zipfile.ZipFile(src)
cell_images = ET.fromstring(z.read("xl/cellimages.xml"))
rels = ET.fromstring(z.read("xl/_rels/cellimages.xml.rels"))
rel_map = {r.get("Id"): r.get("Target") for r in rels}

id_to_media = {}
for pic in cell_images.iter():
    if not pic.tag.endswith("pic"):
        continue
    c_nv = pic.find(".//xdr:cNvPr", NS)
    blip = pic.find(".//a:blip", NS)
    if c_nv is None or blip is None:
        continue
    rid = blip.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed")
    target = rel_map.get(rid)
    if target:
        id_to_media[c_nv.get("name")] = "xl/" + target

print(f"cells: {len(ids)} | images mapped: {len(id_to_media)}")
for i, (level, name, image_id) in enumerate(zip(levels, names, ids), start=1):
    media = id_to_media.get(image_id)
    if not media:
        print(f"  [skip] {level} / {name}: 没找到图片")
        continue
    raw = z.read(media)
    img = Image.open(io.BytesIO(raw))
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    img.thumbnail((900, 900), Image.LANCZOS)
    filename = f"{i:02d}-{level}.jpg"
    img.save(os.path.join(out_dir, filename), "JPEG", quality=86, optimize=True)
    size = os.path.getsize(os.path.join(out_dir, filename))
    print(f"  {filename}: {img.size[0]}x{img.size[1]}  {round(size/1024)}KB  ← {media}")
