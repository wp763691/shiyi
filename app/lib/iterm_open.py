#!/usr/bin/env python3
"""通过 iTerm2 Python API 在现有窗口新建标签并执行命令。

用法: iterm_open.py '<json>'   json: {"command": "..."}
前提: iTerm2 → Settings → General → Magic → Enable Python API 已开启。
"""
import asyncio
import json
import sys

import iterm2


def out(ok, error=""):
    print(json.dumps({"ok": ok, "error": error}, ensure_ascii=False))


async def main():
    payload = json.loads(sys.argv[1])
    command = payload.get("command", "")
    conn = None
    try:
        conn = await iterm2.Connection.async_create()
        app = await iterm2.async_get_app(conn)
        try:
            await app.async_activate()
        except Exception:
            pass
        window = app.current_terminal_window
        if window is None and app.terminal_windows:
            window = app.terminal_windows[0]
        if window is None:
            out(False, "没有可用的 iTerm 窗口")
            return
        tab = await window.async_create_tab(profile="Default")
        # 等 shell 就绪再发送命令，避免输入竞争
        await asyncio.sleep(0.8)
        session = tab.current_session
        await session.async_send_text(command + "\n")
        out(True)
    except Exception as e:
        out(False, f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    asyncio.run(main())
