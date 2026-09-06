const LIVE = document.getElementById('liveRows');
const HIST = document.getElementById('historyRows');
const LIVE_COUNT = document.getElementById('liveCount');
const HIST_COUNT = document.getElementById('historyCount');
const SKILLS_COUNT = document.getElementById('skillsCount');
const SKILL_ROWS = document.getElementById('skillRows');
const TAB_SESSIONS = document.getElementById('tab-sessions');
const TAB_SKILLS = document.getElementById('tab-skills');
const TAB_CONFIG = document.getElementById('tab-config');
const TAB_SESS_COUNT = document.getElementById('tabSessCount');
const TAB_SKILL_COUNT = document.getElementById('tabSkillCount');
const TAB_CONFIG_COUNT = document.getElementById('tabConfigCount');
const CONFIG_TITLE = document.getElementById('configTitle');
const CONFIG_COUNT = document.getElementById('configCount');
const CONFIG_ROWS = document.getElementById('configRows');
const CONFIG_SEARCH = document.getElementById('configSearch');
const CONFIG_VIEW_BTNS = [...document.querySelectorAll('.seg-btn[data-cview]')];
const LIVE_SEARCH = document.getElementById('liveSearch');
const SEARCH = document.getElementById('search');
const DIR_FILTER = document.getElementById('dirFilter');
const SKILLS_SEARCH = document.getElementById('skillsSearch');
const WARNINGS = document.getElementById('warnings');
const CONN = document.getElementById('connText');
const REFRESH = document.getElementById('refreshText');
const TOAST = document.getElementById('toast');
const MODAL_BACKDROP = document.getElementById('modalBackdrop');
const MODAL_TITLE = document.getElementById('modalTitle');
const MODAL_TEXT = document.getElementById('modalText');
const MODAL_COMMAND = document.getElementById('modalCommand');
const MODAL_COPY = document.getElementById('modalCopy');
const MODAL_OK = document.getElementById('modalOk');
const MODAL_CLOSE = document.getElementById('modalClose');
let configView = 'rules';
const mcpStatus = new Map(); // key -> {state:'ok'|'fail'|'checking'|'skip', detail}

function mcpKey(x) {
  return `${x.tool}|${x.scope}|${x.name}|${x.sourceFile || x.path || ''}`;
}

const SKILL_SCOPE_BTNS = [...document.querySelectorAll('.seg-btn[data-scope]')];
let skillScope = 'all';

function activateTab(name) {
  if (!['sessions', 'skills', 'config'].includes(name)) name = 'sessions';
  for (const btn of [TAB_SESSIONS, TAB_SKILLS, TAB_CONFIG]) {
    const on = btn.dataset.tab === name;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
    btn.tabIndex = on ? 0 : -1;
  }
  document.getElementById('panel-sessions').hidden = name !== 'sessions';
  document.getElementById('panel-skills').hidden = name !== 'skills';
  document.getElementById('panel-config').hidden = name !== 'config';
  try {
    localStorage.setItem('shiyi.tab', name);
  } catch { /* 忽略 */ }
  if (name === 'sessions') {
    renderLive();
    renderDirFilter();
    renderHistory();
  } else if (name === 'skills') {
    renderSkills();
  } else {
    renderConfig();
  }
}

let state = {
  sessions: [], windows: [], tmuxSessions: [], skills: [],
  rules: [], mcp: [], agents: [], commands: [], hooks: [],
  errors: [], now: Date.now(),
};
let lastError = null;

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

function fmtRel(ts) {
  if (!ts) return '';
  const d = Math.max(0, Date.now() - ts);
  const m = Math.floor(d / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const day = Math.floor(h / 24);
  if (day < 7) return `${day} 天前`;
  const dt = new Date(ts);
  return `${dt.getMonth() + 1}月${dt.getDate()}日`;
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function liveTitle(w) {
  if (w.session?.title && w.session.title !== '未命名会话') return w.session.title;
  if (w.title) return w.title;
  return w.tool === 'codex' ? 'Codex 会话' : 'Claude Code 会话';
}

function toolChip(obj) {
  const tool = obj.session?.tool || obj.tool || '';
  if (tool !== 'codex' && tool !== 'claude') return null;
  return tool === 'codex' ? ['tag tool-codex', 'Codex'] : ['tag tool-claude', 'Claude Code'];
}

function renderWarnings() {
  WARNINGS.innerHTML = '';
  for (const err of state.errors || []) {
    const box = el('div', 'warning');
    box.append(el('span', 'warn-ico', '!'), el('span', '', err.detail));
    WARNINGS.appendChild(box);
  }
}

function liveFiltered() {
  const q = LIVE_SEARCH.value.trim().toLowerCase();
  const all = liveAll();
  if (!q) return all;
  return all.filter((w) => {
    const parts = [w.title, w.name, w.wname, w.tool, String(w.win || ''), w.session?.title, w.session?.cwd, w.session?.tool];
    return parts.filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
  });
}

function liveAll() {
  const windows = (state.windows || []).filter((w) => w.running || w.session);
  const tmux = (state.tmuxSessions || []).map((t) => ({
    running: true,
    tmux: true,
    tool: t.tool,
    title: t.name,
    name: t.name,
    sessionName: t.name,
    session: { title: t.name, tool: t.tool, cwd: t.cwd },
    cwd: t.cwd,
    attached: t.attached,
    pane: `${t.window}.${t.pane}`,
  }));
  return [...windows, ...tmux];
}

function renderLive() {
  const all = liveAll();
  const windows = liveFiltered();
  LIVE_COUNT.textContent = `${windows.length} / ${all.length}`;
  LIVE.innerHTML = '';

  if (!windows.length) {
    const empty = el('div', 'empty');
    empty.textContent = '未检测到正在运行的 Claude Code 会话窗口';
    LIVE.appendChild(empty);
    return;
  }

  for (const w of windows) {
    const row = el('div', 'row live-row');
    row.append(el('span', `livedot${w.running ? ' on' : ''}`));

    const main = el('div', 'row-main');
    const line1 = el('div', 'row-title');
    line1.textContent = liveTitle(w);
    if (w.running) line1.append(el('span', 'tag live-tag', '运行中'));
    if (w.tmux) line1.append(el('span', 'tag tmux-tag', 'tmux'));
    const chip = toolChip(w);
    if (chip) line1.append(el('span', chip[0], chip[1]));
    main.appendChild(line1);

    const meta = el('div', 'row-meta');
    if (w.tmux) meta.append(el('span', 'chip', `tmux ${w.name}${w.attached ? '（已连接）' : '（后台）'}`));
    else if (w.win) meta.append(el('span', 'chip', `窗口 ${w.win} · 标签 ${w.tab}`));
    else meta.append(el('span', 'chip', w.procPid ? `进程 ${w.procPid}` : '后台会话'));
    if (w.tmux) meta.append(el('span', 'chip', `窗格 ${w.pane}`));
    if (w.session?.cwd) meta.append(el('span', 'chip path', w.session.cwd));
    if (w.session?.lastTs) meta.append(el('span', 'chip', fmtRel(w.session.lastTs) + '活跃'));
    main.appendChild(meta);
    row.appendChild(main);

    const actions = el('div', 'row-actions');
    if (w.tmux) {
      const attachBtn = el('button', 'btn primary', '接管会话');
      attachBtn.onclick = () => act({ action: 'tmux-attach', name: w.sessionName });
      actions.appendChild(attachBtn);
    } else if (w.win) {
      const focusBtn = el('button', 'btn', '聚焦窗口');
      focusBtn.onclick = () => act({ action: 'focus', win: w.win, tab: w.tab });
      actions.appendChild(focusBtn);
    }
    row.appendChild(actions);
    LIVE.appendChild(row);
  }
}

function baseHistory() {
  const runningIds = new Set(
    (state.windows || []).map((w) => w.session?.sessionId).filter(Boolean)
  );
  return (state.sessions || []).filter((s) => !runningIds.has(s.sessionId));
}

function historyFiltered() {
  const q = SEARCH.value.trim().toLowerCase();
  const dir = DIR_FILTER.value;
  const list = baseHistory().filter((s) => {
    if (dir && s.cwd !== dir) return false;
    if (!q) return true;
    return [s.title, s.dirName, s.cwd, s.branch, s.lastUserText, s.sessionId, s.tool]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });
  list.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
  return list;
}

function renderHistory() {
  const list = historyFiltered();
  const total = baseHistory().length;
  HIST_COUNT.textContent = `${list.length} / ${total}`;
  HIST.innerHTML = '';

  if (!list.length) {
    const empty = el('div', 'empty');
    empty.textContent = total ? '没有匹配的会话' : '暂无历史会话';
    HIST.appendChild(empty);
    return;
  }

  for (const s of list) {
    const row = el('div', 'row hist-row');
    const main = el('div', 'row-main');

    const line1 = el('div', 'row-title');
    line1.textContent = s.title;
    const chip = toolChip(s);
    if (chip) line1.append(el('span', chip[0], chip[1]));
    if (s.branch) line1.append(el('span', 'tag branch', s.branch));
    main.appendChild(line1);

    const meta = el('div', 'row-meta');
    meta.append(el('span', 'chip path', s.dirName));
    meta.append(el('span', 'chip', fmtDate(s.lastTs)));
    meta.append(el('span', 'chip', `${s.exchanges} 轮`));
    meta.append(el('span', 'chip', `${s.mb} MB`));
    if (s.lastUserText) {
      const preview = el('div', 'row-preview');
      preview.textContent = s.lastUserText;
      main.appendChild(preview);
    }
    row.appendChild(main);

    const actions = el('div', 'row-actions');
    const resume = el('button', 'btn primary', '恢复会话');
    resume.onclick = () => act({ action: 'resume', sessionId: s.sessionId, cwd: s.cwd, tool: s.tool });
    const copy = el('button', 'btn ghost small', '复制命令');
    copy.onclick = () => {
      const bin = s.tool === 'codex' ? 'codex' : 'claude';
      const cmd = s.cwd
        ? `cd '${s.cwd}' && ${bin} ${s.tool === 'codex' ? 'resume' : '--resume'} ${s.sessionId}`
        : `${bin} ${s.tool === 'codex' ? 'resume' : '--resume'} ${s.sessionId}`;
      navigator.clipboard?.writeText(cmd)
        .then(() => toast('已复制：' + cmd))
        .catch(() => toast('复制失败，请手动复制'));
    };
    const del = el('button', 'btn danger small', '删除');
    del.onclick = () => {
      const where = s.tool === 'codex' ? '~/.codex/trash-zyin' : '~/.claude/trash-zyin';
      showConfirm(
        `删除会话「${s.title}」？`,
        `会话文件会移到 ${where}（可手动找回），并从面板和恢复列表移除。此操作不可在面板内撤销。`,
        async () => {
          await act({ action: 'delete', tool: s.tool, sessionId: s.sessionId, path: s.path });
        }
      );
    };
    actions.append(resume, copy, del);
    row.appendChild(actions);
    HIST.appendChild(row);
  }
}

function skillsFiltered() {
  const q = SKILLS_SEARCH.value.trim().toLowerCase();
  const all = state.skills || [];
  return all.filter((s) => {
    if (skillScope !== 'all' && s.scope !== skillScope) return false;
    if (!q) return true;
    return [s.name, s.description, s.toolLabel, s.path, s.folder, s.projectName]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q));
  });
}

function renderSkills() {
  const all = state.skills || [];
  const list = skillsFiltered();
  SKILLS_COUNT.textContent = `${list.length} / ${all.length}`;
  SKILL_ROWS.innerHTML = '';

  if (!list.length) {
    const empty = el('div', 'empty');
    empty.textContent = all.length
      ? '没有匹配的技能'
      : '暂未发现技能（扫描 ~/.claude/skills、~/.codex/skills、~/.agents/skills）';
    SKILL_ROWS.appendChild(empty);
    return;
  }

  for (const s of list) {
    const row = el('div', 'row skill-row');
    const main = el('div', 'row-main');

    const line1 = el('div', 'row-title');
    line1.textContent = s.name;
    const toolCls = s.tool === 'codex' ? 'tool-codex' : s.tool === 'agents' ? 'tool-agents' : 'tool-claude';
    const toolText = s.tool === 'agents' ? '本地' : s.toolLabel;
    line1.append(el('span', `tag ${toolCls}`, toolText));
    line1.append(el('span', `tag scope-${s.scope}`, s.scope === 'project' ? '项目' : '全局'));
    main.appendChild(line1);

    if (s.description) {
      const desc = el('div', 'row-preview');
      desc.textContent = s.description;
      main.appendChild(desc);
    }

    const meta = el('div', 'row-meta');
    if (s.scope === 'project' && s.projectName) meta.append(el('span', 'chip', s.projectName));
    meta.append(el('span', 'chip path', s.folder));
    meta.append(el('span', 'chip', `${fmtRel(s.mtime)}更新`));
    main.appendChild(meta);
    row.appendChild(main);

    const actions = el('div', 'row-actions');
    const folderBtn = el('button', 'btn small', '文件夹');
    folderBtn.onclick = () => act({ action: 'open', reveal: true, path: s.folder });
    const editBtn = el('button', 'btn small', '编辑');
    editBtn.onclick = () => act({ action: 'open', reveal: false, path: s.path });
    const delBtn = el('button', 'btn danger small', '删除');
    delBtn.onclick = () => {
      const where =
        s.tool === 'claude' ? '~/.claude/trash-zyin'
        : s.tool === 'codex' ? '~/.codex/trash-zyin'
        : '~/.agents/trash-zyin';
      showConfirm(
        `删除技能「${s.name}」？`,
        `技能目录会移到 ${where}（可手动找回），并从技能库移除。此操作不可在面板内撤销。`,
        async () => {
          await act({ action: 'delete-skill', tool: s.tool, path: s.folder });
        }
      );
    };
    actions.append(folderBtn, editBtn, delBtn);
    row.appendChild(actions);
    SKILL_ROWS.appendChild(row);
  }
}

function configFiltered() {
  const q = CONFIG_SEARCH.value.trim().toLowerCase();
  const map = {
    rules: 'rules',
    mcp: 'mcp',
    agents: 'agents',
    commands: 'commands',
    hooks: 'hooks',
  };
  const all = state[map[configView]] || [];
  if (!q) return all;
  return all.filter((x) =>
    [x.name, x.label, x.event, x.matcher, x.toolLabel, x.projectName, x.path, x.sourceFile, x.command, x.url, x.preview]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q))
  );
}

function toolClsOf(x) {
  return x.tool === 'codex' ? 'tool-codex' : x.tool === 'agents' ? 'tool-agents' : 'tool-claude';
}

function scopeTag(x) {
  return el('span', `tag scope-${x.scope}`, x.scope === 'project' ? '项目' : '全局');
}

function toolTag(x) {
  const label = x.toolLabel || (x.tool === 'codex' ? 'Codex' : x.tool === 'agents' ? '本地' : 'Claude Code');
  return el('span', `tag ${toolClsOf(x)}`, label);
}

function renderConfig() {
  const map = { rules: 'rules', mcp: 'mcp', agents: 'agents', commands: 'commands', hooks: 'hooks' };
  const all = state[map[configView]] || [];
  const list = configFiltered();
  const titles = { rules: '规则库', mcp: 'MCP 服务器', agents: 'Agents', commands: '斜杠命令', hooks: 'Hooks（只读）' };
  CONFIG_TITLE.textContent = titles[configView] || '配置';
  CONFIG_COUNT.textContent = `${list.length} / ${all.length}`;
  CONFIG_ROWS.innerHTML = '';

  if (!list.length) {
    const empty = el('div', 'empty');
    const empties = {
      rules: '暂无规则文件（CLAUDE.md / AGENTS.md）',
      mcp: '暂无 MCP 服务器',
      agents: '暂无 Agent 角色',
      commands: '暂无斜杠命令',
      hooks: '暂无 Hooks',
    };
    empty.textContent = all.length ? '没有匹配的项目' : empties[configView] || '暂无内容';
    CONFIG_ROWS.appendChild(empty);
    return;
  }

  for (const x of list) {
    const row = el('div', 'row config-row');
    const main = el('div', 'row-main');
    const line1 = el('div', 'row-title');
    line1.textContent = x.kind === 'hook' ? `${x.event}` : x.name || x.label;
    line1.append(toolTag(x), scopeTag(x));
    if (x.kind === 'hook' && x.matcher) line1.append(el('span', 'tag branch', x.matcher));
    main.appendChild(line1);

    if (x.kind === 'hook' && x.command) {
      const cmd = el('div', 'row-preview');
      cmd.textContent = x.command;
      main.appendChild(cmd);
    } else if (x.preview || x.command || x.url) {
      const desc = el('div', 'row-preview');
      desc.textContent = x.preview || (x.command ? `${x.command} ${(x.args || []).join(' ')}`.trim() : x.url || '');
      main.appendChild(desc);
    }

    const meta = el('div', 'row-meta');
    if (x.projectName) meta.append(el('span', 'chip', x.projectName));
    if (x.lines) meta.append(el('span', 'chip', `${x.lines} 行`));
    if (x.type) meta.append(el('span', 'chip', x.type));
    if (x.kind === 'hook') {
      if (x.timeout) meta.append(el('span', 'chip', `超时 ${x.timeout}s`));
      if (x.statusMessage) meta.append(el('span', 'chip', x.statusMessage));
    }
    if (x.envKeys && x.envKeys.length) meta.append(el('span', 'chip', `env ${x.envKeys.length} 项`));
    meta.append(el('span', 'chip path', (x.path || x.sourceFile)));
    meta.append(el('span', 'chip', `${fmtRel(x.mtime)}更新`));
    if (x.kind === 'mcp' && mcpStatus.has(mcpKey(x))) {
      const st = mcpStatus.get(mcpKey(x));
      meta.append(el('span', `chip mcp-${st.state}`, statusText(st)));
    }
    main.appendChild(meta);
    row.appendChild(main);

    const actions = el('div', 'row-actions');
    const file = x.path || x.sourceFile;
    if (x.kind === 'mcp') {
      const checkBtn = el('button', `btn small ${(mcpStatus.get(mcpKey(x)) || {}).state === 'checking' ? '' : ''}`, checkLabel(x));
      checkBtn.disabled = (mcpStatus.get(mcpKey(x)) || {}).state === 'checking';
      checkBtn.onclick = () => doMcpCheck(x);
      actions.append(checkBtn);
    }
    const editBtn = el('button', 'btn small', '编辑');
    editBtn.onclick = () => act({ action: 'open', reveal: false, path: file });
    const revealBtn = el('button', 'btn small', '文件夹');
    revealBtn.onclick = () => act({ action: 'open', reveal: true, path: file });
    actions.append(editBtn, revealBtn);
    if (x.kind === 'hook') {
      // Hooks 只读，不做编辑/删除
      const copyBtn = el('button', 'btn small', '打开配置');
      copyBtn.onclick = () => act({ action: 'open', reveal: false, path: file });
      actions.append(copyBtn);
    } else if (x.kind === 'rule' || x.kind === 'agent' || x.kind === 'command') {
      const delBtn = el('button', 'btn danger small', '删除');
      delBtn.onclick = () => {
        const where = x.scope === 'global'
          ? (x.tool === 'codex' ? '~/.codex/trash-zyin' : '~/.claude/trash-zyin')
          : '项目 .trash-zyin';
        showConfirm(
          `删除「${x.name || x.event}」？`,
          `文件会移到 ${where}（可手动找回）。此操作不可在面板内撤销。`,
          async () => {
            await act({ action: 'delete-rule', path: file });
          }
        );
      };
      actions.append(delBtn);
    } else {
      const copyBtn = el('button', 'btn small', '复制名称');
      copyBtn.onclick = () => {
        navigator.clipboard?.writeText(x.name)
          .then(() => toast('已复制 MCP 名称'))
          .catch(() => toast('复制失败', true));
      };
      actions.append(copyBtn);
    }
    row.appendChild(actions);
    CONFIG_ROWS.appendChild(row);
  }
}

function renderDirFilter() {
  const dirs = [...new Set(baseHistory().map((s) => s.cwd).filter(Boolean))];
  const prev = DIR_FILTER.value;
  DIR_FILTER.innerHTML = '';
  DIR_FILTER.append(new Option('全部目录', ''));
  for (const d of dirs.sort()) DIR_FILTER.append(new Option(shortDir(d), d));
  if (dirs.includes(prev)) DIR_FILTER.value = prev;
}

function shortDir(d) {
  const parts = d.split('/').filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : d;
}

async function act(payload) {
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.ok) {
      if (payload.action === 'delete' || payload.action === 'delete-skill' || payload.action === 'delete-rule') {
        hideModal();
        toast('已移至回收目录（可从那里找回）');
        refresh();
      } else if (payload.action === 'resume') toast('已在 iTerm 新标签恢复会话');
      else toast('已切换到该窗口');
    }
    else if (payload.action === 'resume' && data.command) showResumeModal(data.error, data.command);
    else toast(data.error || '操作失败', true);
  } catch (e) {
    toast('操作失败：' + e.message, true);
  }
}

function statusText(st) {
  if (!st) return '检测';
  if (st.state === 'ok') return '✓ 可用';
  if (st.state === 'fail') return '✕ 失败';
  if (st.state === 'checking') return '检测中…';
  return '— 跳过';
}

function checkLabel(x) {
  const st = mcpStatus.get(mcpKey(x));
  return st && st.state === 'checking' ? '检测中…' : '检测';
}

async function doMcpCheck(x) {
  const key = mcpKey(x);
  mcpStatus.set(key, { state: 'checking' });
  renderConfig();
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'mcp-check',
        name: x.name,
        tool: x.tool,
        scope: x.scope,
        project: x.project || '',
      }),
    });
    const data = await res.json();
    mcpStatus.set(key, { state: data.state || 'fail', detail: data.detail || '' });
  } catch (e) {
    mcpStatus.set(key, { state: 'fail', detail: e.message });
  }
  renderConfig();
  const st = mcpStatus.get(key);
  if (st.detail) toast(`${x.name}: ${st.detail}`, st.state === 'ok' ? false : st.state === 'fail');
}

function showResumeModal(text, command) {
  MODAL_TITLE.textContent = '无法自动恢复';
  MODAL_TEXT.textContent = text;
  MODAL_COMMAND.textContent = command;
  MODAL_COMMAND.hidden = false;
  MODAL_COPY.hidden = false;
  MODAL_OK.hidden = true;
  MODAL_CLOSE.textContent = '知道了';
  MODAL_BACKDROP.hidden = false;
  MODAL_COPY.onclick = () => {
    navigator.clipboard?.writeText(command)
      .then(() => toast('命令已复制，粘贴到终端回车即可'))
      .catch(() => toast('复制失败，请长按选择复制', true));
  };
  MODAL_CLOSE.onclick = hideModal;
}

function showConfirm(title, text, onOk) {
  MODAL_TITLE.textContent = title;
  MODAL_TEXT.textContent = text;
  MODAL_COMMAND.hidden = true;
  MODAL_COPY.hidden = true;
  MODAL_OK.hidden = false;
  MODAL_CLOSE.textContent = '取消';
  MODAL_BACKDROP.hidden = false;
  MODAL_OK.onclick = () => onOk();
  MODAL_CLOSE.onclick = hideModal;
}

function hideModal() {
  MODAL_BACKDROP.hidden = true;
}

let toastTimer;
function toast(msg, isError = false) {
  TOAST.textContent = msg;
  TOAST.classList.toggle('error', isError);
  TOAST.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { TOAST.hidden = true; }, 3200);
}

async function refresh() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state = await res.json();
    lastError = null;
    CONN.textContent = '已连接';
    document.body.classList.remove('offline');
  } catch (e) {
    CONN.textContent = '连接断开';
    document.body.classList.add('offline');
  }
  renderWarnings();
  renderLive();
  renderDirFilter();
  renderHistory();
  renderSkills();
  renderConfig();
  TAB_SESS_COUNT.textContent = baseHistory().length;
  TAB_SKILL_COUNT.textContent = (state.skills || []).length;
  TAB_CONFIG_COUNT.textContent =
    (state.rules || []).length + (state.mcp || []).length +
    (state.agents || []).length + (state.commands || []).length + (state.hooks || []).length;
  REFRESH.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
}

TAB_SESSIONS.addEventListener('click', () => activateTab('sessions'));
TAB_SKILLS.addEventListener('click', () => activateTab('skills'));
TAB_CONFIG.addEventListener('click', () => activateTab('config'));
document.querySelector('.tabbar').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const tabs = [TAB_SESSIONS, TAB_SKILLS, TAB_CONFIG];
  const cur = tabs.findIndex((t) => t.classList.contains('active'));
  const dir = e.key === 'ArrowRight' ? 1 : -1;
  const next = tabs[(cur + dir + tabs.length) % tabs.length];
  next.focus();
  activateTab(next.dataset.tab);
});

SEARCH.addEventListener('input', renderHistory);
LIVE_SEARCH.addEventListener('input', renderLive);
SKILLS_SEARCH.addEventListener('input', renderSkills);
CONFIG_SEARCH.addEventListener('input', renderConfig);
for (const btn of CONFIG_VIEW_BTNS) {
  btn.addEventListener('click', () => {
    configView = btn.dataset.cview;
    for (const b of CONFIG_VIEW_BTNS) b.classList.toggle('active', b === btn);
    renderConfig();
  });
}
for (const btn of SKILL_SCOPE_BTNS) {
  btn.addEventListener('click', () => {
    skillScope = btn.dataset.scope;
    for (const b of SKILL_SCOPE_BTNS) b.classList.toggle('active', b === btn);
    renderSkills();
  });
}
DIR_FILTER.addEventListener('change', renderHistory);

refresh();
activateTab((() => { try { return localStorage.getItem('shiyi.tab'); } catch { return null; } })() || 'sessions');
setInterval(refresh, 5000);
setInterval(() => { renderLive(); renderHistory(); renderSkills(); renderConfig(); }, 30000);
