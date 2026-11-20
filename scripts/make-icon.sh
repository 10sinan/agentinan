#!/bin/sh
# Builds the app icon from the line drawing in build/icon-source.png (black lines on white):
# crops it, thickens the lines, colours them gold-orange with a soft glow, and puts them on a rounded dark tile.
# Writes build/icon.png (packages) and renderer/icon.png (window). Needs ImageMagick 7 (`magick`).
#   sh scripts/make-icon.sh
set -eu
cd "$(dirname "$0")/.."
SRC=build/icon-source.png
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# the lines as a mask: upscaled first so thickening and scaling back down stay smooth
magick "$SRC" -colorspace Gray -negate -resize 400% -threshold 35% -trim +repage \
  -morphology Dilate Disk:7 \
  -resize 340x340 -gravity center -background black -extent 340x340 "$TMP/mask.png"

# rounded square tile, 460px inside a 512px canvas
magick -size 460x460 gradient:'#1d2030'-'#0b0c14' \
  \( -size 460x460 xc:black -fill white -draw "roundrectangle 0,0 459,459 96,96" \) \
  -alpha off -compose CopyOpacity -composite \
  -background none -gravity center -extent 512x512 PNG32:"$TMP/tile.png"

magick -size 340x340 gradient:'#ffd27a'-'#f07f1e' -colorspace sRGB \( "$TMP/mask.png" -alpha off \) \
  -compose CopyOpacity -composite PNG32:"$TMP/lines.png"
magick "$TMP/mask.png" -background '#f08a24' -alpha shape -blur 0x12 PNG32:"$TMP/glow.png"

magick "$TMP/tile.png" "$TMP/glow.png" -gravity center -compose screen -composite \
  "$TMP/lines.png" -gravity center -compose over -composite PNG32:build/icon.png
cp build/icon.png renderer/icon.png
echo "build/icon.png, renderer/icon.png"
