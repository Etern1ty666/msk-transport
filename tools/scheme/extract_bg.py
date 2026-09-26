"""Фон схемы (Москва-река, парки, белые полосы МКАД и колец) — векторизация эталонного изображения схемы.

Нужны numpy, scipy, scikit-image, pillow.  Запуск:  python extract_bg.py path/to/scheme.png  → bg.json
Результат уже лежит в bg.json рядом; повторять нужно только при смене эталона.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import measure


def masks(img: np.ndarray):
    R, G, B = (img[..., i].astype(int) for i in range(3))
    net = np.zeros(R.shape, bool)
    net[85:1680, 20:1440] = True
    water = (B - R > 14) & (B > 215) & (G > 205) & net
    park = (G - B > 12) & (G > 236) & (R > 225) & net
    white = (R >= 249) & (G >= 249) & (B >= 249) & net
    for m in (water, park, white):
        m[80:240, 1200:1400] = False  # фирменный логотип в углу не переносим
    return water, park, white


def paths(mask, close=2, min_area=300, fill_holes=False, tol=0.9):
    if close:
        mask = ndi.binary_closing(mask, iterations=close)
    if fill_holes:
        mask = ndi.binary_fill_holes(mask)
    lab, n = ndi.label(mask)
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    out = []
    for i, s in enumerate(sizes, 1):
        if s < min_area:
            continue
        comp = np.pad(lab == i, 1)
        parts = []
        for c in measure.find_contours(comp.astype(float), 0.5):
            c = measure.approximate_polygon(c, tol)
            if len(c) >= 4:
                parts.append("M" + " L".join(f"{x - 1:.1f},{y - 1:.1f}" for y, x in c) + "Z")
        if parts:
            out.append("".join(parts))
    return out


if __name__ == "__main__":
    img = np.asarray(Image.open(sys.argv[1]).convert("RGB"))
    water, park, white = masks(img)
    res = {"water": paths(water, close=3, min_area=250), "parks": paths(park, close=2, min_area=900, fill_holes=True, tol=1.2),
           "white": paths(white, close=1, min_area=400, tol=0.8)}
    (Path(__file__).parent / "bg.json").write_text(json.dumps(res))
    print({k: len(v) for k, v in res.items()})
