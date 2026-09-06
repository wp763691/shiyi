#!/bin/bash
# 构建「拾忆」macOS 本地应用
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT/macos/.build"
APP_NAME="拾忆.app"
APP="$BUILD_DIR/$APP_NAME"

rm -rf "$BUILD_DIR"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
mkdir -p "$APP/Contents/Resources/server"

# 1. 拷贝 Web 资源与依赖（含 venv-iterm，供一键恢复用）
cp -R "$ROOT/server.mjs" "$APP/Contents/Resources/server/"
cp -R "$ROOT/lib" "$APP/Contents/Resources/server/"
cp -R "$ROOT/public" "$APP/Contents/Resources/server/"
if [ -f "$ROOT/path-aliases.json" ]; then
  cp "$ROOT/path-aliases.json" "$APP/Contents/Resources/server/path-aliases.json"
else
  cp "$ROOT/path-aliases.example.json" "$APP/Contents/Resources/server/path-aliases.json"
fi
if [ -x "$ROOT/venv-iterm/bin/python" ]; then
  cp -R "$ROOT/venv-iterm" "$APP/Contents/Resources/server/"
else
  echo "⚠️  未找到 venv-iterm（iTerm 一键恢复不可用）；先运行 ../scripts/setup.sh"
fi
cp "$ROOT/README.md" "$APP/Contents/Resources/" 2>/dev/null || true

# 2. 编译原生壳
swiftc -O \
  "$ROOT/macos/main.swift" \
  -o "$APP/Contents/MacOS/ZYinSessions" \
  -framework Cocoa -framework WebKit 2>&1

# 3. Info.plist
cp "$ROOT/macos/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/macos/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

echo "✅ 构建完成: $APP"
echo "打开方式: open \"$APP\""
