import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { access, writeFile, chmod } from 'node:fs/promises';

const execFileP = promisify(execFile);
const binCache = new Map();
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

async function resolveBin(name) {
  if (binCache.has(name)) return binCache.get(name);
  const dirs = String(process.env.PATH || '').split(':');
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      await access(candidate);
      binCache.set(name, candidate);
      return candidate;
    } catch { /* 继续找 */ }
  }
  binCache.set(name, name);
  return name;
}

async function runOsascript(script) {
  const { stdout } = await execFileP('/usr/bin/osascript', ['-e', script], {
    timeout: 8000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

export async function listTerminalWindows() {
  const script = `
tell application "iTerm2"
  set out to ""
  set n to count of windows
  repeat with wi from 1 to n
    set w to window wi
    set wid to id of w
    set wname to name of w
    set m to count of tabs of w
    repeat with ti from 1 to m
      set s to current session of tab ti of w
      set ttitle to title of tab ti of w
      set pty to ""
      try
        set pty to tty of s
      end try
      set out to out & (wid as text) & (ASCII character 9) & (ti as text) & (ASCII character 9) & wname & (ASCII character 9) & ttitle & (ASCII character 9) & pty & (ASCII character 10)
    end repeat
  end repeat
  return out
end tell`;
  try {
    const stdout = await runOsascript(script);
    const windows = stdout
      .split('\n')
      .map((row) => {
        const [win, tab, wname, title, tty] = row.split('\t');
        if (!win) return null;
        return { win, tab: Number(tab) || 1, wname: wname || '', title: title || '', tty: tty || '' };
      })
      .filter(Boolean);
    return { ok: true, windows, error: null };
  } catch (e) {
    return { ok: false, windows: [], error: friendlyOsError(e) };
  }
}

export async function runningClaudeProcs() {
  try {
    const { stdout } = await execFileP('/bin/ps', ['-axo', 'pid=,tty=,etime=,command='], {
      timeout: 6000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const procs = [];
    for (const line of stdout.split('\n')) {
      // 只关心有终端（TTY）的交互式 CLI 会话；桌面应用/更新器/扩展宿主都是 '??'
      const m = line.match(/^\s*(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/);
      if (!m || m[2] === '??') continue;
      const tool = classifyAgent(m[4]);
      if (!tool) continue;
      const p = { pid: Number(m[1]), tty: m[2], etime: m[3], command: m[4], tool, cwd: '' };
      try {
        const out = await execFileP('/usr/sbin/lsof', ['-a', '-p', String(p.pid), '-d', 'cwd', '-Fn'], { timeout: 4000 });
        const mm = out.stdout.match(/\nn(.*)/);
        p.cwd = mm ? mm[1] : '';
      } catch { /* lsof 可能受限，忽略 */ }
      procs.push(p);
    }
    return { ok: true, procs, error: null };
  } catch (e) {
    return { ok: false, procs: [], error: friendlyOsError(e) };
  }
}

// 命令行里出现的是真正的 claude / codex 可执行文件（排除 claude-mermaid 这类辅助进程）
function classifyAgent(command) {
  if (!command || /grep|shiyi|拾忆|server\.mjs|claude-mermaid/i.test(command)) return null;
  if (/(?:^|\s)(?:\S+\/)?claude(?:\s|$)/.test(command)) return 'claude';
  if (/(?:^|\s)(?:\S+\/)?codex(?:\s|$)/.test(command)) return 'codex';
  return null;
}

export async function focusWindow(win, tab) {
  const id = Number(win);
  if (!id) return { ok: false, error: '该窗口无法通过 iTerm2 聚焦' };
  const script = `
tell application "iTerm2"
  activate
  tell (first window whose id is ${id})
    select tab ${Number(tab) || 1}
  end tell
end tell`;
  try {
    await runOsascript(script);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: friendlyOsError(e) };
  }
}

export async function resumeSession(sessionId, cwd, tool = 'claude') {
  const bin = await resolveBin(tool === 'codex' ? 'codex' : 'claude');
  const args = tool === 'codex' ? `resume ${shq(sessionId)}` : `--resume ${shq(sessionId)}`;
  const log = '/tmp/zyin-resume.log';
  const dir = shq(cwd || process.env.HOME || '/');
  const manual = buildManualCommand(cwd, tool, sessionId);

  // 第一优先：iTerm2 Python API（在当前 iTerm 窗口新开标签）
  try {
    const pyRes = await resumeViaItermPython(`cd ${dir} && ${bin} ${args}`);
    if (pyRes.ok) return { ok: true };
    // API 可用但执行失败时继续走下一级，不直接报错
  } catch { /* Python API 未开启或环境缺失，走 Terminal.app */ }

  // 命令会由 Terminal.app 在新窗口里执行；失败时窗口停留并显示原因
  const scriptBody =
    `#!/bin/bash\n` +
    `cd ${dir} || { echo '目录不存在，按回车关闭'; read; exit 1; }\n` +
    `${bin} ${args}\n` +
    `__zyin_code=$?\n` +
    `echo "[zyin] $(date +%H:%M:%S) tool=${tool} id=${sessionId} exit=$__zyin_code" >> ${shq(log)}\n` +
    `if [ $__zyin_code -ne 0 ]; then printf '\\n会话未成功启动（退出码 %s）。上面如有错误提示请查看；按回车关闭窗口\\n' "$__zyin_code"; read; fi\n`;

  const scriptPath = path.join(os.tmpdir(), `zyin-resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.command`);
  try {
    await writeFile(scriptPath, scriptBody);
    await chmod(scriptPath, 0o755);
    await execFileP('/usr/bin/open', ['-a', 'Terminal', scriptPath], { timeout: 8000 });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: friendlyOsError(e),
      command: manual,
      detail: `自动打开失败：${e.message}。命令已准备好，请手动粘贴执行：`,
    };
  }
}

async function resumeViaItermPython(command) {
  // venv 与 lib 同级（session-board/venv-iterm）
  const py = path.join(moduleDir, '..', 'venv-iterm', 'bin', 'python');
  const helper = path.join(moduleDir, 'iterm_open.py');
  try {
    await access(py);
  } catch {
    return { ok: false, error: '缺少 iterm2 python 环境' };
  }
  const { stdout } = await execFileP(py, [helper, JSON.stringify({ command })], {
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  });
  const lastLine = stdout.trim().split('\n').pop() || '{}';
  try {
    return JSON.parse(lastLine);
  } catch {
    return { ok: false, error: stdout.slice(0, 200) };
  }
}

function buildManualCommand(cwd, tool, sessionId) {
  const bin = tool === 'codex' ? 'codex' : 'claude';
  const flag = tool === 'codex' ? 'resume' : '--resume';
  return cwd ? `cd '${cwd}' && ${bin} ${flag} ${sessionId}` : `${bin} ${flag} ${sessionId}`;
}

function quoteApple(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function shq(s) {
  return "'" + String(s).replace(/'/g, `'\\''`) + "'";
}

function friendlyOsError(e) {
  const msg = String(e?.message || e);
  if (/not allowed assistive|not authorized|execution error: .*不能获得|application "iTerm2"/.test(msg)) {
    return '无法控制 iTerm2：请确认 iTerm2 正在运行，并在 系统设置 → 隐私与安全性 → 自动化 中允许本终端控制 iTerm2';
  }
  if (/Operation not permitted|EPERM|sysmond/.test(msg)) {
    return '进程查询被系统限制（ps/lsof 不可用），只能显示窗口，无法关联运行中的会话';
  }
  return msg;
}
