#!/bin/bash
# 拾忆 - 本地依赖安装（为"一键恢复 iTerm 标签"创建 Python 环境）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/app/venv-iterm"
PYTHON="${PYTHON:-python3}"

if [ ! -x "$VENV/bin/python" ]; then
  echo "创建 Python 虚拟环境: $VENV"
  "$PYTHON" -m venv "$VENV"
fi

echo "安装 iterm2 Python API 依赖…"
"$VENV/bin/pip" install --quiet iterm2
echo "✅ 依赖就绪"
