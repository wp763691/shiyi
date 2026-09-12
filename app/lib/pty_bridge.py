#!/usr/bin/env python3
"""拾忆 PTY 桥：分配 pty 执行命令，将输入/输出转发到 Node 侧管道。
用法: pty_bridge.py <rows> <cols> <cmd> [args...]
"""
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

master = None


def set_winsize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def on_winch(signum, frame):
    ctrl = os.environ.get("ZYIN_CTRL", "")
    if not ctrl:
        return
    try:
        with open(ctrl) as f:
            rows, cols = f.read().split()
        set_winsize(master, int(rows), int(cols))
    except Exception:
        pass


def main():
    global master
    rows = int(sys.argv[1])
    cols = int(sys.argv[2])
    cmd = sys.argv[3]
    args = sys.argv[4:]
    ready_r, ready_w = os.pipe()
    pid, master = pty.fork()
    if pid == 0:
        # 子进程等待父进程设置好窗口尺寸再执行
        os.read(ready_r, 1)
        os.close(ready_r)
        os.execvp(cmd, [cmd] + args)
    os.close(ready_r)
    try:
        set_winsize(master, rows, cols)
    except OSError:
        pass
    os.write(ready_w, b"1")
    os.close(ready_w)
    try:
        signal.signal(signal.SIGWINCH, on_winch)
    except Exception:
        pass

    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    try:
        while True:
            rlist, _, _ = select.select([stdin, master], [], [], 0.5)
            if master in rlist:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    break
                if not data:
                    break
                stdout.write(data)
                stdout.flush()
            if stdin in rlist:
                data = os.read(stdin.fileno(), 65536)
                if not data:
                    break
                os.write(master, data)
    finally:
        try:
            os.kill(pid, 9)
        except OSError:
            pass
        try:
            os.close(master)
        except OSError:
            pass


if __name__ == "__main__":
    main()
