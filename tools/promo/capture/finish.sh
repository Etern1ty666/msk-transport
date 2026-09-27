#!/bin/sh
# Финал: 4 подкадра 240 fps → один кадр 60 fps с motion blur (tmix), затем сжатая GIF для README.
set -e
cd "$(dirname "$0")/.."
ffmpeg -loglevel error -y -i out/promo240.mp4 \
  -vf "tmix=frames=4:weights='1 1 1 1',select='eq(mod(n\,4)\,3)',setpts=N/(60*TB)" -r 60 \
  -c:v libx264 -crf 17 -preset slow -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart out/tramflow-promo.mp4
# GIF для README: 640 px, 10 fps, 96 цветов без дизеринга + gifsicle --lossy — около 10 МБ на 36 с
ffmpeg -loglevel error -y -i out/tramflow-promo.mp4 \
  -vf "fps=10,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 out/promo-raw.gif
gifsicle -O3 --lossy=80 out/promo-raw.gif -o ../../docs/promo.gif
ls -la out/tramflow-promo.mp4 ../../docs/promo.gif
