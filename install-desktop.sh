#!/bin/sh
# Adds Agentinan to the GNOME app list (~/.local/share/applications), so it opens like any other app.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/agentinan.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Agentinan
Comment=Claude Code oturum panosu
Exec=env -u ELECTRON_RUN_AS_NODE "$DIR/node_modules/.bin/electron" "$DIR"
Icon=$DIR/renderer/icon.png
Terminal=false
Categories=Development;
DESKTOP
echo "Eklendi: Uygulamalar menüsünde 'Agentinan'"
