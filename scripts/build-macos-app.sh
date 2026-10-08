#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[[ "$(uname -m)" == arm64 ]] || { printf 'Build on an Apple Silicon Mac.\n' >&2; exit 1; }
mkdir -p build/downloads build/vendor dist

download() {
  local file="$1" url="$2" expected="$3"
  if [[ ! -f "build/downloads/$file" ]]; then
    /usr/bin/curl -fL --connect-timeout 20 --max-time 300 "$url" -o "build/downloads/$file.part"
    mv "build/downloads/$file.part" "build/downloads/$file"
  fi
  local actual
  actual="$(/usr/bin/shasum -a 256 "build/downloads/$file")"
  [[ "${actual%% *}" == "$expected" ]] || { printf 'Checksum mismatch: %s\n' "$file" >&2; exit 1; }
}

download node-v24.21.0-darwin-arm64.tar.xz \
  https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.xz \
  6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe
download libwebp-1.6.0-mac-arm64.tar.gz \
  https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0-mac-arm64.tar.gz \
  bc6bf84cc70f3f8574fba797d1e4a7dea4feebe9fa4be919f202413ea2b3b8f2
download ffmpeg-7.1.5.tar.xz https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz \
  de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f
download libwebp-1.6.0.tar.gz \
  https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz \
  e4ab7009bf0629fd11982d4c2aa83964cf244cffba7347ecd39019a9e38c4564

for archive in node-v24.21.0-darwin-arm64.tar.xz libwebp-1.6.0-mac-arm64.tar.gz ffmpeg-7.1.5.tar.xz libwebp-1.6.0.tar.gz; do
  directory="${archive%.tar.*}"
  [[ -d "build/vendor/$directory" ]] || tar -xf "build/downloads/$archive" -C build/vendor
done
VERSION="$(build/vendor/node-v24.21.0-darwin-arm64/bin/node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf 'Expected a numeric MAJOR.MINOR.PATCH version\n' >&2; exit 1; }
if [[ ! -x build/vendor/ffmpeg-7.1.5/ffmpeg ]] || [[ scripts/build-ffmpeg.sh -nt build/vendor/ffmpeg-7.1.5/ffmpeg ]]; then
  /bin/bash scripts/build-ffmpeg.sh
fi

STAGING="$(mktemp -d "${TMPDIR:-/tmp}/obsidian-screenshot-build.XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT
RELEASE="$STAGING/Obsidian Screenshot Importer $VERSION"
APP="$RELEASE/Obsidian Screenshot Importer.app"
RES="$APP/Contents/Resources"
SOURCES="$STAGING/Sources"
mkdir -p "$APP/Contents/MacOS" "$RES/bin" "$RES/app" "$RES/Licenses" "$SOURCES"
/bin/bash scripts/build-native-helpers.sh
cp build/bin/preserve-creation-time "$RES/bin/preserve-creation-time"
cp macos/DesktopInfo.plist "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$APP/Contents/Info.plist"
/usr/bin/swiftc -swift-version 5 -O -target arm64-apple-macos13.5 \
  -module-cache-path "$ROOT/build/swift-cache" macos/DesktopApp.swift \
  -o "$APP/Contents/MacOS/ObsidianScreenshotImporter" -framework AppKit -framework WebKit
/usr/bin/swiftc -swift-version 5 -O -target arm64-apple-macos13.5 \
  -module-cache-path "$ROOT/build/swift-cache" macos/UpdateInstaller.swift \
  -o "$RES/bin/update-installer" -framework AppKit
/usr/bin/swiftc -swift-version 5 -module-cache-path "$ROOT/build/swift-cache" macos/MakeIcon.swift -o "$STAGING/MakeIcon" -framework AppKit
"$STAGING/MakeIcon" "$STAGING/AppIcon.iconset"
/usr/bin/iconutil -c icns "$STAGING/AppIcon.iconset" -o "$RES/AppIcon.icns"
cp build/vendor/node-v24.21.0-darwin-arm64/bin/node "$RES/bin/node"
# Remove debug/local symbol tables, retaining runtime code, exports, ICU, and codecs.
/usr/bin/strip -S -x "$RES/bin/node"
cp build/vendor/libwebp-1.6.0-mac-arm64/bin/cwebp "$RES/bin/cwebp"
cp build/vendor/ffmpeg-7.1.5/ffmpeg "$RES/bin/ffmpeg"
cp -R src public "$RES/app/"
cp package.json "$RES/app/"
cp README.md PROJECT.md AUDIT.md PORTABLE-APP.md CHANGELOG.md PERFORMANCE.md "$RES/"
cp build/vendor/node-v24.21.0-darwin-arm64/LICENSE "$RES/Licenses/Node.txt"
cp build/vendor/ffmpeg-7.1.5/COPYING.LGPLv2.1 "$RES/Licenses/FFmpeg.txt"
cp build/vendor/libwebp-1.6.0/COPYING "$RES/Licenses/WebP.txt"
cp build/vendor/libwebp-1.6.0/PATENTS "$RES/Licenses/WebP-PATENTS.txt"
cp build/downloads/libwebp-1.6.0.tar.gz "$SOURCES/"
cp build/downloads/ffmpeg-7.1.5.tar.xz "$SOURCES/"
# config.log contains the developer's full environment; distribute flags only.
"$RES/bin/ffmpeg" -hide_banner -buildconf > "$SOURCES/ffmpeg-build-config.txt" 2>&1
cp -R src public scripts tests "$SOURCES/"
mkdir -p "$SOURCES/macos"
cp macos/*.swift macos/*.c macos/*.plist "$SOURCES/macos/"
cp package.json .gitignore .gitattributes AGENTS.md README.md PROJECT.md AUDIT.md PORTABLE-APP.md CHANGELOG.md PERFORMANCE.md "$SOURCES/"
cp -R .github "$SOURCES/"
cp -R "$RES/Licenses" "$SOURCES/"
/usr/bin/ditto -c -k --keepParent "$SOURCES" "$RELEASE/Sources-$VERSION.zip"
cp PORTABLE-APP.md CHANGELOG.md PERFORMANCE.md "$RELEASE/"

# A portable build must not accidentally depend on the developer's Homebrew.
for binary in "$RES/bin/"* "$APP/Contents/MacOS/"*; do
  if /usr/bin/otool -L "$binary" | /usr/bin/grep -E '^[[:space:]]+/(opt/homebrew|usr/local|Users)/'; then
    printf 'Nonportable dynamic dependency in %s\n' "$binary" >&2
    exit 1
  fi
done
for binary in "$RES/bin/"*; do /usr/bin/codesign --force --sign - "$binary"; done
/usr/bin/codesign --force --sign - "$APP"
/usr/bin/codesign --verify --deep --strict "$APP"
if [[ -d "$ROOT/dist/Obsidian Screenshot Importer.app" ]]; then rm -rf "$ROOT/dist/Obsidian Screenshot Importer.app"; fi
/usr/bin/ditto --noextattr "$APP" "$ROOT/dist/Obsidian Screenshot Importer.app"
ZIP="$ROOT/dist/Obsidian-Screenshot-Importer-$VERSION-Apple-Silicon.zip"
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$RELEASE" "$ZIP"
printf '\nBuilt: %s\n' "$ZIP"
