#!/bin/sh
# Рендер docs/src/*.html → docs/*.png (Chrome headless, 2x, обрезка по контенту)
cd "$(dirname "$0")/.."
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for n in ${@:-architecture performance}; do
  "$C" --headless=new --hide-scrollbars --force-device-scale-factor=2 --window-size=1600,1600 --virtual-time-budget=5000 --screenshot="$PWD/$n.png" "file://$PWD/src/$n.html" 2>/dev/null
  python3 -c "
from PIL import Image
im=Image.open('$n.png').convert('RGB');w,h=im.size;px=im.load()
last=max(y for y in range(h) if any(sum(px[x,y])<700 for x in range(0,w,8)))
im.crop((0,0,w,min(h,last+128))).save('$n.png');print('$n',w,last+128)"
done
