#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_NAME="木辛说视频下载器"
BUNDLE_ID="com.muxin.video-downloader"
VERSION="$(node -p "require('./package.json').version")"
NODE_VERSION="$(node -p "process.version")"
WHISPER_VERSION="1.9.1"
DENO_VERSION="2.9.2"
FFMPEG_VERSION="b6.1.1"
BUILD="$ROOT/build/macos"
DOWNLOADS="$BUILD/downloads"
RELEASE="$ROOT/release/macos"
APP="$RELEASE/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
RUNTIME="$RESOURCES/runtime"
APP_BIN="$MACOS/$APP_NAME"
DMG="$RELEASE/$APP_NAME-macOS-universal.dmg"

download() {
  local url="$1" output="$2"
  mkdir -p "$(dirname "$output")"
  curl --fail --location --retry 4 --retry-all-errors --connect-timeout 20 "$url" --output "$output"
}

extract_tar() {
  local archive="$1" destination="$2"
  mkdir -p "$destination"
  tar -xzf "$archive" -C "$destination"
}

rm -rf "$RELEASE"
mkdir -p "$DOWNLOADS" "$MACOS" "$RUNTIME" "$RESOURCES/legal"

node scripts/build-macos-sea.mjs
SEA_BLOB="$BUILD/muxin-video-downloader.blob"
POSTJECT="$ROOT/node_modules/postject/dist/cli.js"

for arch in x64 arm64; do
  NODE_ARCH="$arch"
  [[ "$arch" == "arm64" ]] && NODE_ARCH="arm64"
  NODE_TAR="$DOWNLOADS/node-$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"
  NODE_DIR="$BUILD/node-$arch"
  download "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-$NODE_ARCH.tar.gz" "$NODE_TAR"
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  extract_tar "$NODE_TAR" "$NODE_DIR"
  NODE_BIN="$(find "$NODE_DIR" -path '*/bin/node' -type f | head -n 1)"
  cp "$NODE_BIN" "$BUILD/app-$arch"
  chmod +x "$BUILD/app-$arch"
  codesign --remove-signature "$BUILD/app-$arch" 2>/dev/null || true
  node "$POSTJECT" "$BUILD/app-$arch" NODE_SEA_BLOB "$SEA_BLOB" \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
    --macho-segment-name NODE_SEA --overwrite
done
lipo -create "$BUILD/app-x64" "$BUILD/app-arm64" -output "$APP_BIN"
chmod +x "$APP_BIN"

# Universal Deno
for arch in x86_64 aarch64; do
  zip="$DOWNLOADS/deno-$arch.zip"
  dir="$BUILD/deno-$arch"
  download "https://github.com/denoland/deno/releases/download/v$DENO_VERSION/deno-$arch-apple-darwin.zip" "$zip"
  rm -rf "$dir" && mkdir -p "$dir"
  ditto -x -k "$zip" "$dir"
done
lipo -create "$BUILD/deno-x86_64/deno" "$BUILD/deno-aarch64/deno" -output "$RUNTIME/deno"

# Universal static FFmpeg and FFprobe
for tool in ffmpeg ffprobe; do
  for arch in x64 arm64; do
    output="$BUILD/$tool-$arch"
    download "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_VERSION/$tool-darwin-$arch" "$output"
    chmod +x "$output"
  done
  lipo -create "$BUILD/$tool-x64" "$BUILD/$tool-arm64" -output "$RUNTIME/$tool"
done

# yt-dlp's official macOS standalone is universal.
download "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" "$RUNTIME/yt-dlp"

# Build a universal whisper.cpp CPU engine. Models remain optional downloads.
WHISPER_TAR="$DOWNLOADS/whisper-v$WHISPER_VERSION.tar.gz"
WHISPER_SRC="$BUILD/whisper.cpp-$WHISPER_VERSION"
download "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v$WHISPER_VERSION.tar.gz" "$WHISPER_TAR"
rm -rf "$WHISPER_SRC"
extract_tar "$WHISPER_TAR" "$BUILD"
cmake -S "$WHISPER_SRC" -B "$WHISPER_SRC/build-universal" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="x86_64;arm64" \
  -DGGML_METAL=OFF \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_SERVER=OFF \
  -DBUILD_SHARED_LIBS=OFF
cmake --build "$WHISPER_SRC/build-universal" --config Release --target whisper-cli -j3
mkdir -p "$RUNTIME/whisper/engine-cpu"
WHISPER_BIN="$(find "$WHISPER_SRC/build-universal" -type f -name whisper-cli | head -n 1)"
cp "$WHISPER_BIN" "$RUNTIME/whisper/engine-cpu/whisper-cli"

chmod +x "$APP_BIN" "$RUNTIME/deno" "$RUNTIME/ffmpeg" "$RUNTIME/ffprobe" "$RUNTIME/yt-dlp" "$RUNTIME/whisper/engine-cpu/whisper-cli"

# Build macOS icon from the selected application icon.
ICONSET="$BUILD/AppIcon.iconset"
mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" assets/app-icon/app-icon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" assets/app-icon/app-icon.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns"

cp legal/THIRD-PARTY-NOTICES.txt legal/SMARTSCREEN.txt "$RESOURCES/legal/"
cat > "$RESOURCES/version.json" <<JSON
{
  "version": "$VERSION",
  "channel": "stable",
  "platform": "macos-universal",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>$APP_NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

# Ad-hoc signing keeps the bundle internally consistent. Distribution is not notarized yet.
codesign --force --deep --sign - --timestamp=none "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

# Automated smoke checks on the app and all bundled tools.
file "$APP_BIN" "$RUNTIME/deno" "$RUNTIME/ffmpeg" "$RUNTIME/ffprobe" "$RUNTIME/whisper/engine-cpu/whisper-cli"
for binary in "$APP_BIN" "$RUNTIME/deno" "$RUNTIME/ffmpeg" "$RUNTIME/ffprobe" "$RUNTIME/whisper/engine-cpu/whisper-cli"; do
  lipo -verify_arch x86_64 arm64 "$binary"
done
"$RUNTIME/yt-dlp" --version
"$RUNTIME/deno" --version
"$RUNTIME/ffmpeg" -version | head -n 1
"$RUNTIME/ffprobe" -version | head -n 1
"$RUNTIME/whisper/engine-cpu/whisper-cli" --help >/dev/null
SMOKE_DATA="$BUILD/smoke-data"
MUXIN_DATA_DIR="$SMOKE_DATA" "$APP_BIN" --diagnose > "$BUILD/diagnose.json"
node -e "const d=require('./build/macos/diagnose.json'); if(!d.tools.ytDlp.ok||!d.tools.ffmpeg.ok||!d.tools.javascript.ok) process.exit(1); console.log(d.paths);"

# Create a drag-to-Applications DMG.
DMG_ROOT="$BUILD/dmg-root"
rm -rf "$DMG_ROOT"
mkdir -p "$DMG_ROOT"
cp -R "$APP" "$DMG_ROOT/"
ln -s /Applications "$DMG_ROOT/Applications"
rm -f "$DMG"
hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG"

# Mount the finished DMG and rerun the packaged binary from the mounted image.
MOUNT="$BUILD/mount"
mkdir -p "$MOUNT"
hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT"
trap 'hdiutil detach "$MOUNT" -force >/dev/null 2>&1 || true' EXIT
MOUNTED_BIN="$MOUNT/$APP_NAME.app/Contents/MacOS/$APP_NAME"
codesign --verify --deep --strict "$MOUNT/$APP_NAME.app"
MUXIN_DATA_DIR="$BUILD/mounted-smoke-data" "$MOUNTED_BIN" --diagnose > "$BUILD/mounted-diagnose.json"
hdiutil detach "$MOUNT"
trap - EXIT

shasum -a 256 "$DMG" | tee "$RELEASE/SHA256SUMS.txt"
echo "Built $DMG"
