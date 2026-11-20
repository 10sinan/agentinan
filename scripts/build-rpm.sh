#!/bin/sh
# Builds the RPM with rpmbuild from the app electron-builder unpacked into dist/linux-unpacked.
# (electron-builder's own rpm target uses a bundled fpm that needs libcrypt.so.1, which Fedora doesn't ship
# by default; rpmbuild is part of Fedora's standard tools.)
#   npx electron-builder --linux dir && sh scripts/build-rpm.sh
set -eu
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
SRC="$PWD/dist/linux-unpacked"
[ -x "$SRC/agentinan" ] || { echo "dist/linux-unpacked yok: önce 'npx electron-builder --linux dir' çalıştır" >&2; exit 1; }
TOP=$(mktemp -d)
trap 'rm -rf "$TOP"' EXIT
mkdir -p "$TOP/SPECS" "$TOP/RPMS"

cat > "$TOP/agentinan.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Agentinan
Comment=Claude Code oturum panosu
Exec=/opt/Agentinan/agentinan %U
Icon=agentinan
Terminal=false
Categories=Development;
StartupWMClass=agentinan
DESKTOP

cat > "$TOP/SPECS/agentinan.spec" <<SPEC
Name:           agentinan
Version:        $VERSION
Release:        1
Summary:        Claude Code oturum panosu
License:        MIT
URL:            https://github.com/10sinan/agentinan
BuildArch:      x86_64
AutoReqProv:    no
Requires:       gtk3, nss, libnotify, libXScrnSaver, libXtst, xdg-utils, at-spi2-core, libuuid, alsa-lib

%description
Linux için Claude Code panosu: 3D yörünge haritası, token ve maliyet, bildirimler,
oturumlara komut verme, Git ve temalar.

%install
mkdir -p %{buildroot}/opt/Agentinan %{buildroot}%{_bindir} %{buildroot}%{_datadir}/applications %{buildroot}%{_datadir}/icons/hicolor/512x512/apps
cp -a "$SRC"/. %{buildroot}/opt/Agentinan/
ln -s /opt/Agentinan/agentinan %{buildroot}%{_bindir}/agentinan
install -m 644 "$TOP/agentinan.desktop" %{buildroot}%{_datadir}/applications/agentinan.desktop
install -m 644 "$PWD/build/icon.png" %{buildroot}%{_datadir}/icons/hicolor/512x512/apps/agentinan.png

%files
/opt/Agentinan
%attr(4755, root, root) /opt/Agentinan/chrome-sandbox
%{_bindir}/agentinan
%{_datadir}/applications/agentinan.desktop
%{_datadir}/icons/hicolor/512x512/apps/agentinan.png
SPEC

rpmbuild --quiet --define "_topdir $TOP" --define "_build_id_links none" --define "__strip /bin/true" -bb "$TOP/SPECS/agentinan.spec"
cp "$TOP"/RPMS/x86_64/agentinan-"$VERSION"-1.x86_64.rpm dist/
echo "dist/agentinan-$VERSION-1.x86_64.rpm"

# SHA256SUMS next to the artifacts (the rpm, and the AppImage when `npm run dist` built one), paths relative to dist/
(
  cd dist
  set -- agentinan-"$VERSION"-1.x86_64.rpm
  for f in Agentinan-"$VERSION"-*.AppImage; do [ -f "$f" ] && set -- "$@" "$f"; done
  sha256sum "$@" > SHA256SUMS
)
echo "dist/SHA256SUMS"
