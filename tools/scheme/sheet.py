"""Сводный лист наложений: python3 sheet.py out.png x,y x,y ...  — кадры 100×100 вокруг точек, ×4, с линиями схемы."""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw
D = json.loads((Path(__file__).resolve().parents[2] / "frontend/src/ops/scheme/scheme.json").read_text())
ref = Image.open(Path(__file__).parent / "reference.png").convert("RGB")
pts = [tuple(map(float, a.split(","))) for a in sys.argv[2:]]
S, R = 4, 50
cols = 4; rows = (len(pts) + cols - 1) // cols
sheet = Image.new("RGB", (cols * 2 * R * S, rows * 2 * R * S), "white")
for k, (cx, cy) in enumerate(pts):
    x0, y0 = int(cx - R), int(cy - R)
    im = ref.crop((x0, y0, x0 + 2 * R, y0 + 2 * R)).resize((2 * R * S, 2 * R * S), Image.LANCZOS)
    d = ImageDraw.Draw(im, "RGBA")
    for l in D["lanes"]:
        d.line([((p[0] - x0) * S, (p[1] - y0) * S) for p in l["pts"]], fill=(0, 0, 0, 220), width=1)
    d.rectangle([0, 0, 2 * R * S - 1, 2 * R * S - 1], outline=(255, 0, 255))
    d.text((4, 4), f"{k}: {cx:.0f},{cy:.0f}", fill=(200, 0, 200))
    sheet.paste(im, ((k % cols) * 2 * R * S, (k // cols) * 2 * R * S))
sheet.save(sys.argv[1])
