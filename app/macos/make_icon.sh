#!/bin/bash
# 生成「拾忆」图标：PNG → AppIcon.icns，并同步页面左上角的 brand.png
# 用法: bash make_icon.sh [sunrise|mint|sky]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
THEME="${1:-sunrise}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

swift "$HERE/make_icon.swift" "$TMP/icon.png" "$THEME"

# 1. AppIcon.icns（macOS 需要的全部尺寸）
ICONSET="$TMP/AppIcon.iconset"
mkdir -p "$ICONSET"
for spec in \
  "16:icon_16x16" "32:icon_16x16@2x" "32:icon_32x32" "64:icon_32x32@2x" \
  "128:icon_128x128" "256:icon_128x128@2x" "256:icon_256x256" "512:icon_256x256@2x" \
  "512:icon_512x512" "1024:icon_512x512@2x"; do
  px="${spec%%:*}"
  name="${spec##*:}"
  sips -z "$px" "$px" "$TMP/icon.png" --out "$ICONSET/$name.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$HERE/AppIcon.icns"

# 2. 页面左上角品牌图
sips -z 120 120 "$TMP/icon.png" --out "$ROOT/public/brand.png" >/dev/null

echo "✅ 已更新 AppIcon.icns 与 public/brand.png（配色：${THEME}）"
