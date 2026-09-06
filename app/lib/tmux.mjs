import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// 列出 tmux 里正在运行的 claude / codex 会话
export async function listTmuxAgents() {
  try {
    const { stdout } = await execFileP('/opt/homebrew/bin/tmux', [
      'list-panes', '-a',
      '-F', '#{session_name}\t#{window_index}\t#{pane_index}\t#{pane_current_command}\t#{pane_current_path}\t#{session_attached}',
    ], { timeout: 5000 });
    const rows = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [session, win, pane, command, cwd, attached] = line.split('\t');
      const tool = classify(command);
      if (!tool) continue;
      rows.push({
        source: 'tmux',
        name: session,
        window: win,
        pane,
        tool,
        command: command || '',
        cwd: cwd || '',
        attached: attached === '1',
      });
    }
    return { ok: true, items: rows, error: null };
  } catch (e) {
    const msg = String(e?.message || e);
    if (/error connecting|No such file|no server running|not running/i.test(msg)) {
      return { ok: true, items: [], error: null };
    }
    return { ok: false, items: [], error: msg.slice(0, 160) };
  }
}

function classify(command) {
  const c = String(command || '').toLowerCase();
  if (!c) return null;
  if (c.includes('claude') || c.includes('claude-code')) return 'claude';
  if (c.includes('codex')) return 'codex';
  return null;
}
