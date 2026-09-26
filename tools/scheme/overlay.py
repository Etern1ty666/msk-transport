"""Наложение осевых линий полос схемы на эталон — для ручной сверки района.  python3 overlay.py ref.png x0 y0 x1 y1 scale out.png"""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageDraw
from audit_lib import lanes
ref, x0, y0, x1, y1, S, out = sys.argv[1], *map(int, sys.argv[2:7]), sys.argv[7]
im = Image.open(ref).convert("RGB").crop((x0, y0, x1, y1)).resize(((x1 - x0) * S, (y1 - y0) * S), Image.LANCZOS)
d = ImageDraw.Draw(im, "RGBA")
for x in range((x0 // 10) * 10, x1 + 1, 10):
    if x >= x0: d.line([((x - x0) * S, 0), ((x - x0) * S, (y1 - y0) * S)], fill=(255, 0, 255, 90 if x % 50 == 0 else 30)); x % 50 == 0 and d.text(((x - x0) * S + 2, 2), str(x), fill=(200, 0, 200))
for y in range((y0 // 10) * 10, y1 + 1, 10):
    if y >= y0: d.line([(0, (y - y0) * S), ((x1 - x0) * S, (y - y0) * S)], fill=(255, 0, 255, 90 if y % 50 == 0 else 30)); y % 50 == 0 and d.text((2, (y - y0) * S + 2), str(y), fill=(200, 0, 200))
import json as _j
_D=_j.loads((Path(__file__).resolve().parents[2]/'frontend/src/ops/scheme/scheme.json').read_text())
_L=[(0,l['route'],l['pts']) for l in _D.get('lanes',[])] or list(lanes())
for ci, r, pts in _L:
    d.line([((p[0] - x0) * S, (p[1] - y0) * S) for p in pts], fill=(0, 0, 0, 230), width=1)
    p = pts[len(pts) // 2]
im.save(out)
