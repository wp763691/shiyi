const LIVE = document.getElementById('liveRows');
const HIST = document.getElementById('historyRows');
const LIVE_COUNT = document.getElementById('liveCount');
const HIST_COUNT = document.getElementById('historyCount');
const SKILLS_COUNT = document.getElementById('skillsCount');
const SKILL_ROWS = document.getElementById('skillRows');
const SKILL_MORE = document.getElementById('skillMore');
const TRANS_BACKDROP = document.getElementById('transBackdrop');
const TRANS_TITLE = document.getElementById('transTitle');
const TRANS_NAME = document.getElementById('transName');
const TRANS_DESC = document.getElementById('transDesc');
const TRANS_CANCEL = document.getElementById('transCancel');
const TRANS_SAVE = document.getElementById('transSave');
const RENAME_BACKDROP = document.getElementById('renameBackdrop');
const RENAME_INPUT = document.getElementById('renameInput');
const RENAME_CANCEL = document.getElementById('renameCancel');
const RENAME_SAVE = document.getElementById('renameSave');
let renameKey = null;
let showZh = (() => { try { return localStorage.getItem('shiyi.skillLang') !== 'en'; } catch { return true; } })();
let transCurrent = null;
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
const RAIL_TOGGLE = document.getElementById('railToggle');
const WB_DRAWER = document.getElementById('wbDrawer');
const DRAWER_RESIZER = document.getElementById('drawerResizer');
const DRAWER_MORE = document.getElementById('drawerMore');
const TERM_TABS = document.getElementById('termTabs');
const TERM_STAGE = document.getElementById('termStage');
const TERM_EMPTY = document.getElementById('termEmpty');
const STATUS_LEFT = document.getElementById('statusLeft');
const STATUS_RIGHT = document.getElementById('statusRight');
const TERM_CLEAR = document.getElementById('termClear');
const TERM_HISTORY = document.getElementById('termHistory');
const FOCUS_TOGGLE = document.getElementById('focusToggle');
const MEM_TOTAL = document.getElementById('memTotal');
const TERM_NEW = document.getElementById('termNew');
const NEW_BACKDROP = document.getElementById('newBackdrop');
const NEW_NAME = document.getElementById('newName');
const NEW_DIR = document.getElementById('newDir');
const NEW_CANCEL = document.getElementById('newCancel');
const NEW_CREATE = document.getElementById('newCreate');
const NEW_TOOL_BTNS = [...document.querySelectorAll('.seg-btn[data-newtool]')];
const NEW_PERM_WRAP = document.getElementById('permWrap');
const NEW_PERM = document.getElementById('newPerm');
const DIR_BROWSE = document.getElementById('dirBrowse');
const CFG_BACKDROP = document.getElementById('cfgBackdrop');
const CFG_TITLE = document.getElementById('cfgTitle');
const CFG_PRE = document.getElementById('cfgPre');
const CFG_TEXT = document.getElementById('cfgText');
const CFG_CANCEL = document.getElementById('cfgCancel');
const CFG_SAVE = document.getElementById('cfgSave');
let cfgCurrent = null;
let newTool = 'bash';
let configView = 'rules';
const mcpStatus = new Map(); // key -> {state:'ok'|'fail'|'checking'|'skip', detail}
let drawerOpen = false;
let termSessions = [];
let activeTermName = null;
let fitTimer = null;
let focusMode = false;

function setFocusMode(on) {
  focusMode = on;
  document.body.classList.toggle('focus-mode', on);
  if (!on) document.body.classList.remove('top-hover');
  toast(on ? '已进入专注模式（⌘⇧F 退出，鼠标移到顶部显示导航）' : '已退出专注模式');
  scheduleFit();
}

function mcpKey(x) {
  return `${x.tool}|${x.scope}|${x.name}|${x.sourceFile || x.path || ''}`;
}

const SKILL_SCOPE_BTNS = [...document.querySelectorAll('.seg-btn[data-scope]')];
let skillScope = 'all';

function activateTab(name) {
  if (!['sessions', 'skills', 'config'].includes(name)) name = 'sessions';
  document.body.dataset.tab = name;
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
    // 进入会话页：自动展开列表（运行中展开、历史收起）
    const panels = document.querySelectorAll('.mini-panel');
    const running = panels[0];
    const history = panels[1];
    running.classList.remove('collapsed');
    history.classList.add('collapsed');
    updateDrawerLayout();
    document.querySelectorAll('.mini-search').forEach((box) => { box.hidden = true; });
    document.querySelectorAll('[data-search]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    setDrawer(true);
    setTimeout(scheduleFit, 60);
  } else if (name === 'skills') {
    renderSkills();
  } else {
    renderConfig();
  }
}

let state = {
  sessions: [], windows: [], tmuxSessions: [], skills: [],
  rules: [], mcp: [], agents: [], commands: [], hooks: [],
  configFiles: [],
  skillTranslations: {}, translationStats: { total: 0, translated: 0 },
  sessionNames: {},
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
  const custom = customName(liveRenameKeys(w));
  if (custom) return custom;
  if (w.tmux) return w.name || w.title || 'tmux';
  if (w.session?.title && w.session.title !== '未命名会话') return w.session.title;
  if (w.title) return w.title;
  if (w.tool === 'bash') return 'Bash 会话';
  return w.tool === 'codex' ? 'Codex 会话' : 'Claude Code 会话';
}

function toolChip(obj) {
  const tool = obj.session?.tool || obj.tool || '';
  if (tool === 'bash') return ['tag tool-bash', 'Bash'];
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
    session: t.session || { title: t.name, tool: t.tool, cwd: t.cwd },
    cwd: t.cwd,
    attached: t.attached,
    pane: `${t.window}.${t.pane}`,
    createdMs: t.createdMs || 0,
    memMB: t.memMB || 0,
    clients: t.clients || [],
    clientCount: t.clientCount || 0,
  }));
  const all = [...windows, ...tmux];
  const pins = livePins();
  all.sort((a, b) => {
    const pa = pins[liveKey(a)] || 0;
    const pb = pins[liveKey(b)] || 0;
    if (pa && pb) return pb - pa;
    if (pa) return -1;
    if (pb) return 1;
    return liveSortTs(b) - liveSortTs(a);
  });
  return all;
}

function liveKey(w) {
  if (w.tmux) return `tmux:${w.sessionName}`;
  if (w.win) return `win:${w.win}:${w.tab}`;
  return `pid:${w.procPid || w.tty || w.name || ''}`;
}

function sessionKeyFor(tool, sessionId) {
  return sessionId ? `session:${tool}:${sessionId}` : null;
}

function customName(keys, fallback) {
  for (const k of keys) {
    if (k && state.sessionNames && state.sessionNames[k]) return state.sessionNames[k];
  }
  return fallback;
}

function sessionMetaById(sessionId) {
  if (!sessionId) return null;
  return (state.sessions || []).find((s) => s.sessionId === sessionId) || null;
}

function ctxBadge(meta) {
  if (!meta || !meta.ctxTokens || !meta.ctxMax) return null;
  const pct = Math.min(999, Math.round((meta.ctxTokens / meta.ctxMax) * 100));
  const level = ctxLevel(meta);
  const cls = level === 'danger' ? 'chip ctx ctx-danger' : level === 'warn' ? 'chip ctx ctx-warn' : 'chip ctx';
  const chip = el('span', cls, `上下文 ${pct}%`);
  const d = meta.ctxDetail || {};
  chip.title = [
    `${meta.ctxTokens.toLocaleString()} / ${meta.ctxMax.toLocaleString()} tokens`,
    `输入 ${(d.input || 0).toLocaleString()} · 缓存读 ${(d.cacheRead || 0).toLocaleString()}${d.cacheCreate ? ` · 缓存写 ${d.cacheCreate.toLocaleString()}` : ''}`,
    `输出 ${(d.output || 0).toLocaleString()}${meta.model ? ` · 模型 ${meta.model}` : ''}`,
  ].join('\n');
  return chip;
}

function ctxLevel(meta) {
  if (!meta?.ctxTokens || !meta?.ctxMax) return 'ok';
  const pct = (meta.ctxTokens / meta.ctxMax) * 100;
  return pct >= 90 ? 'danger' : pct >= 80 ? 'warn' : 'ok';
}

const ctxWarned = new Map();
function checkCtxWarnings(runningMetas) {
  for (const meta of runningMetas) {
    if (!meta?.ctxTokens || !meta?.ctxMax) continue;
    const pct = Math.round((meta.ctxTokens / meta.ctxMax) * 100);
    const level = pct >= 90 ? 2 : pct >= 80 ? 1 : 0;
    const prev = ctxWarned.get(meta.sessionId) || 0;
    if (level > prev) {
      ctxWarned.set(meta.sessionId, level);
      toast(
        `「${meta.title}」上下文已用 ${pct}%（${Math.round(meta.ctxTokens / 1000)}k / ${Math.round(meta.ctxMax / 1000)}k），建议 /compact 或开新会话`,
        level === 2
      );
    } else if (level < prev) {
      ctxWarned.set(meta.sessionId, level);
    }
  }
}

function liveRenameKeys(w) {
  const keys = [];
  if (w.session) keys.push(sessionKeyFor(w.session.tool, w.session.sessionId));
  if (w.tmux) keys.push(`tmux:${w.sessionName}`);
  if (w.win) keys.push(`win:${w.win}:${w.tab}`);
  return keys.filter(Boolean);
}

function liveSortTs(w) {
  return w.createdMs || w.session?.lastTs || 0;
}

function livePins() {
  try {
    return JSON.parse(localStorage.getItem('shiyi.pins') || '{}');
  } catch {
    return {};
  }
}

function togglePin(w) {
  const key = liveKey(w);
  const pins = livePins();
  if (pins[key]) delete pins[key];
  else pins[key] = Date.now();
  try { localStorage.setItem('shiyi.pins', JSON.stringify(pins)); } catch { /* 忽略 */ }
  renderLive();
}

function openRenameDialog(key, current, mode = 'alias') {
  if (mode === 'alias' && !key) return toast('该会话暂不支持重命名', true);
  renameKey = { mode, key, from: mode === 'tmux' ? current : null };
  RENAME_INPUT.value = current || '';
  RENAME_BACKDROP.hidden = false;
  RENAME_INPUT.focus();
  RENAME_INPUT.select();
}

async function saveRenameDialog() {
  if (!renameKey) return;
  RENAME_SAVE.disabled = true;
  try {
    if (renameKey.mode === 'tmux') {
      const from = renameKey.from;
      const res = await fetch('/api/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'tmux-rename', from, to: RENAME_INPUT.value }),
      });
      const data = await res.json();
      if (!data.ok) {
        toast(`重命名失败：${data.error || ''}`, true);
        return;
      }
      const rec = termSessions.find((r) => r.name === from);
      if (rec) rec.name = data.name;
      if (activeTermName === from) activeTermName = data.name;
      if (state.sessionNames[`tmux:${from}`]) {
        await fetch('/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set-session-name', key: `tmux:${data.name}`, name: state.sessionNames[`tmux:${from}`] }),
        });
        await fetch('/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set-session-name', key: `tmux:${from}`, name: '' }),
        });
      }
      RENAME_BACKDROP.hidden = true;
      toast(`tmux 会话已改名为 ${data.name}`);
      renderTermTabs();
      await refresh();
      return;
    }
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-session-name', key: renameKey.key, name: RENAME_INPUT.value }),
    });
    const data = await res.json();
    if (!data.ok) {
      toast(`重命名失败：${data.error || ''}`, true);
      return;
    }
    RENAME_BACKDROP.hidden = true;
    toast(data.name ? '已重命名' : '已恢复默认标题');
    await refresh();
  } catch (e) {
    toast(`重命名失败：${e.message}`, true);
  } finally {
    RENAME_SAVE.disabled = false;
  }
}

function renderLive() {
  const all = liveAll();
  const totalMem = all.reduce((sum, w) => sum + (w.memMB || 0), 0);
  MEM_TOTAL.textContent = totalMem
    ? `内存 ≈ ${totalMem >= 1024 ? `${(totalMem / 1024).toFixed(1)} GB` : `${totalMem} MB`}`
    : '';
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
    const rowMeta = sessionMetaById(w.session?.sessionId);
    const rowLevel = ctxLevel(rowMeta);
    if (rowLevel !== 'ok') row.classList.add(`ctx-${rowLevel}`);
    row.append(el('span', `livedot${w.running ? ' on' : ''}`));

    const main = el('div', 'row-main');
    const line1 = el('div', 'row-title');
    line1.textContent = liveTitle(w);
    if (w.tmux) line1.append(el('span', 'tag tmux-tag', 'tmux'));
    const chip = toolChip(w);
    if (chip) line1.append(el('span', chip[0], chip[1]));
    const ctxChip = ctxBadge(rowMeta);
    if (ctxChip) line1.append(ctxChip);
    main.appendChild(line1);

    const meta = el('div', 'row-meta');
    if (w.tmux) meta.append(el('span', 'chip', `tmux ${w.name}${w.attached ? '（已连接）' : '（后台）'}`));
    else if (w.win) meta.append(el('span', 'chip', `窗口 ${w.win} · 标签 ${w.tab}`));
    else meta.append(el('span', 'chip', w.procPid ? `进程 ${w.procPid}` : '后台会话'));
    if (w.tmux) meta.append(el('span', 'chip', `窗格 ${w.pane}`));
    if (w.session?.cwd) meta.append(el('span', 'chip path', w.session.cwd));
    if (w.session?.lastTs) meta.append(el('span', 'chip', fmtRel(w.session.lastTs) + '活跃'));
    if (w.memMB) meta.append(el('span', `chip mem${w.memMB >= 700 ? ' heavy' : ''}`, `≈${w.memMB} MB`));
    const hasAppClient = (w.clients || []).some((c) => c.isApp);
    if (w.clientCount > 0 && (w.clientCount > 1 || !hasAppClient)) {
      const chip = el('span', 'chip mem', `${w.clientCount} 个连接方`);
      chip.title = (w.clients || []).map((c) => `${c.tty}${c.isApp ? '（拾忆）' : '（外部终端）'}`).join('\n');
      meta.append(chip);
    }
    main.appendChild(meta);
    row.appendChild(main);

    const actions = el('div', 'row-actions');
    const pinned = Boolean(livePins()[liveKey(w)]);
    const pinBtn = el('button', `btn small ${pinned ? 'pin-on' : ''}`, pinned ? '★' : '☆');
    pinBtn.title = pinned ? '取消置顶' : '置顶该会话';
    pinBtn.onclick = () => togglePin(w);
    actions.appendChild(pinBtn);
    const quick = el('button', 'btn small quick-term', '打开');
    quick.title = `按偏好打开（${getOpenMode() === 'embedded' ? '内置终端' : 'iTerm'}）`;
    quick.onclick = () => openRunningItem(w);
    actions.appendChild(quick);
    const more = el('button', 'btn small more-btn', '⋯');
    more.title = '更多操作';
    more.onclick = (e) => showRowMenu(e.currentTarget, w);
    actions.appendChild(more);
    row.appendChild(actions);
    row.ondblclick = (e) => {
      if (e.target.closest('button')) return;
      openRunningItem(w);
    };
    row.title = `双击打开（${getOpenMode() === 'embedded' ? '内置终端' : 'iTerm'}）`;
    LIVE.appendChild(row);
  }
}

function terminateRow(w) {
  const label = w.tmux
    ? `tmux 会话「${w.sessionName}」`
    : `进程 ${w.procPid} 的 ${w.tool === 'codex' ? 'Codex' : 'Claude'} 会话`;
  showConfirm(
    `终止${label}？`,
    w.tmux
      ? '将执行 tmux kill-session，会话中的 claude/codex 会被结束。历史 transcript 仍保留，可随时恢复。'
      : '将向该会话进程发送结束信号。历史 transcript 仍保留，可随时恢复。',
    async () => {
      await act({
        action: 'terminate',
        mode: w.tmux ? 'tmux' : 'process',
        name: w.sessionName,
        pid: w.procPid,
      });
    },
    '确认终止'
  );
}

function closeRowMenu() {
  document.querySelectorAll('.row-menu').forEach((m) => m.remove());
}

function showRowMenu(anchor, w) {
  const exists = document.querySelector('.row-menu');
  closeRowMenu();
  if (exists) return;
  const menu = el('div', 'row-menu');
  const item = (label, fn, danger) => {
    const b = el('button', `row-menu-item${danger ? ' danger' : ''}`, label);
    b.onclick = () => { closeRowMenu(); fn(); };
    menu.appendChild(b);
  };
  const cwd = w.session?.cwd || w.cwd;
  if (cwd) item('打开会话目录', () => act({ action: 'open', reveal: true, path: cwd }));
  const others = (w.clients || []).filter((c) => !c.isApp);
  if (others.length) {
    item(`断开其他连接（${others.length}）`, () => {
      showConfirm(
        '断开其他终端的连接？',
        `将断开 ${others.map((c) => c.tty).join('、')}，只保留拾忆内置终端。会话本身不受影响，其他窗口会回到普通 shell。`,
        async () => {
          await act({ action: 'detach-clients', ttys: others.map((c) => c.tty) });
        },
        '确认断开'
      );
    });
  }
  item(getOpenMode() === 'embedded' ? '在 iTerm 中打开（外置终端）' : '在内置终端打开', () => openOtherWay(w));
  item('设置别名', () => openRenameDialog(liveRenameKeys(w)[0], liveTitle(w)));
  item('终止会话', () => terminateRow(w), true);
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 10)}px`;
  menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 10)}px`;
  setTimeout(() => {
    document.addEventListener('click', closeRowMenu, { once: true });
    document.addEventListener('keydown', closeRowMenu, { once: true });
  }, 0);
}

let adopting = false;

function getOpenMode() {
  try { return localStorage.getItem('shiyi.openMode') === 'iterm' ? 'iterm' : 'embedded'; } catch { return 'embedded'; }
}

function setOpenMode(mode) {
  try { localStorage.setItem('shiyi.openMode', mode); } catch { /* 忽略 */ }
  renderLive();
  renderHistory();
}

// 运行中的会话：按偏好打开
function openRunningItem(w) {
  const embedded = getOpenMode() === 'embedded';
  if (w.tmux) {
    if (embedded) handleEmbeddedOpen(w.sessionName);
    else act({ action: 'tmux-attach', name: w.sessionName });
    return;
  }
  if (embedded) {
    if (w.session?.sessionId) { adoptRunningRow(w, false); return; }
    if (w.win) { act({ action: 'focus', win: w.win, tab: w.tab }); return; }
    toast('该会话无法在内置终端打开，可用 ⋯ 菜单操作', true);
    return;
  }
  if (w.win) { act({ action: 'focus', win: w.win, tab: w.tab }); return; }
  if (w.session?.sessionId) {
    act({ action: 'resume', sessionId: w.session.sessionId, cwd: w.session.cwd, tool: w.session.tool });
    return;
  }
  toast('该会话无法在 iTerm 打开，可用 ⋯ 菜单操作', true);
}

// 历史会话：按偏好打开
function openHistoryItem(s) {
  if (getOpenMode() === 'embedded') {
    adoptIntoEmbedded({
      tool: s.tool, sessionId: s.sessionId, cwd: s.cwd,
      name: customName([sessionKeyFor(s.tool, s.sessionId)], s.title),
    });
  } else {
    act({ action: 'resume', sessionId: s.sessionId, cwd: s.cwd, tool: s.tool });
  }
}

// 用"另一种方式"打开（偏好之外的路径）
function openOtherWay(w) {
  if (getOpenMode() === 'embedded') {
    // 当前偏好内置 → 改用 iTerm 打开
    if (w.tmux) { act({ action: 'tmux-attach', name: w.sessionName }); return; }
    if (w.win) { act({ action: 'focus', win: w.win, tab: w.tab }); return; }
    if (w.session?.sessionId) {
      act({ action: 'resume', sessionId: w.session.sessionId, cwd: w.session.cwd, tool: w.session.tool });
      return;
    }
    toast('该会话无法在 iTerm 打开', true);
    return;
  }
  // 当前偏好 iTerm → 改用内置终端打开
  if (w.tmux) { handleEmbeddedOpen(w.sessionName); return; }
  if (w.session?.sessionId) { adoptRunningRow(w, true); return; }
  toast('该会话缺少 ID，无法在内置终端打开', true);
}

async function adoptIntoEmbedded({ tool, sessionId, cwd, name, pid, terminate }) {
  if (adopting) return null;
  adopting = true;
  toast('正在切换到内置终端（原窗口将关闭，历史保留）…');
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'adopt-session', tool, sessionId, cwd, name, pid, terminate }),
    });
    const data = await res.json();
    if (!data.ok) {
      toast(`转入失败：${data.error || ''}`, true);
      return null;
    }
    toast(`已转入内置终端：${data.name}`);
    await refresh();
    openEmbeddedTmux(data.name);
    return data.name;
  } catch (e) {
    toast(`转入失败：${e.message}`, true);
    return null;
  } finally {
    adopting = false;
  }
}

const IDLE_MS = 30 * 60 * 1000;

async function releaseIdleSessions() {
  const now = Date.now();
  const idle = liveAll()
    .map((w) => ({ w, ts: w.session?.lastTs || w.createdMs || 0 }))
    .filter((x) => x.ts && now - x.ts > IDLE_MS);
  if (!idle.length) {
    toast('没有空闲超过 30 分钟的会话');
    return;
  }
  const mem = idle.reduce((sum, x) => sum + (x.w.memMB || 0), 0);
  const lines = idle.map((x) => `· ${liveTitle(x.w)}（${x.w.memMB || 0} MB）`).join('\n');
  showConfirm(
    `释放 ${idle.length} 个空闲会话？`,
    `预计释放约 ${mem} MB。会话记录完整保留，可随时从历史恢复：\n${lines}`,
    async () => {
      try {
        const res = await fetch('/api/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'terminate-many',
            items: idle.map((x) => ({
              mode: x.w.tmux ? 'tmux' : 'process',
              name: x.w.sessionName || '',
              pid: x.w.procPid || null,
            })),
          }),
        });
        const data = await res.json();
        toast(data.ok ? `已释放 ${data.terminated} 个会话` : '释放失败', !data.ok);
      } catch (e) {
        toast(`释放失败：${e.message}`, true);
      }
      await refresh();
    },
    '确认释放'
  );
}

function adoptRunningRow(w, needConfirm = true) {
  const s = w.session;
  if (!s?.sessionId) return toast('该会话缺少 ID，无法转入', true);
  if (w.running && w.procPid && needConfirm) {
    showConfirm(
      `在内置终端打开？`,
      `「${liveTitle(w)}」将在拾忆的内置终端中继续，原窗口随之关闭；对话历史与上下文完整保留，之后随时可以再切回 iTerm。`,
      async () => {
        await adoptIntoEmbedded({
          tool: s.tool, sessionId: s.sessionId, cwd: s.cwd,
          name: s.title, pid: w.procPid, terminate: true,
        });
      },
      '确认切换'
    );
    return;
  }
  adoptIntoEmbedded({
    tool: s.tool,
    sessionId: s.sessionId,
    cwd: s.cwd,
    name: s.title,
    pid: w.procPid,
    terminate: Boolean(w.running && w.procPid),
  });
}

function showSimpleMenu(anchor, items) {
  const existed = document.querySelector('.row-menu');
  closeRowMenu();
  if (existed) return;
  const menu = el('div', 'row-menu');
  for (const it of items) {
    if (it.sep) { menu.appendChild(el('div', 'row-menu-sep')); continue; }
    const b = el('button', `row-menu-item${it.danger ? ' danger' : ''}`, `${it.check ? '✓ ' : ''}${it.label}`);
    b.onclick = () => { closeRowMenu(); it.fn(); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 10)}px`;
  menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 10)}px`;
  setTimeout(() => {
    document.addEventListener('click', closeRowMenu, { once: true });
    document.addEventListener('keydown', closeRowMenu, { once: true });
  }, 0);
}

function baseHistory() {
  const runningIds = new Set(
    [
      ...(state.windows || []).map((w) => w.session?.sessionId),
      ...(state.tmuxSessions || []).map((t) => t.session?.sessionId),
    ].filter(Boolean)
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
    const level = ctxLevel(s);
    if (level !== 'ok') row.classList.add(`ctx-${level}`);
    const main = el('div', 'row-main');

    const line1 = el('div', 'row-title');
    line1.textContent = customName([sessionKeyFor(s.tool, s.sessionId)], s.title);
    const chip = toolChip(s);
    if (chip) line1.append(el('span', chip[0], chip[1]));
    const ctxChip = ctxBadge(s);
    if (ctxChip) line1.append(ctxChip);
    if (s.branch) line1.append(el('span', 'tag branch', s.branch));
    main.appendChild(line1);

    const meta = el('div', 'row-meta');
    meta.append(el('span', 'chip path', s.dirName));
    if (s.cwdMissing) meta.append(el('span', 'chip mem heavy', '目录已失效'));
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
    const resume = el('button', 'btn primary small', '打开');
    resume.title = `按偏好打开（${getOpenMode() === 'embedded' ? '内置终端' : 'iTerm'}）`;
    resume.onclick = () => openHistoryItem(s);
    const more = el('button', 'btn small more-btn', '⋯');
    more.title = '更多操作';
    more.onclick = (e) => showSimpleMenu(e.currentTarget, [
      {
        label: '复制恢复命令',
        fn: () => {
          const bin = s.tool === 'codex' ? 'codex' : 'claude';
          const cmd = s.cwd && !s.cwdMissing
            ? `cd '${s.cwd}' && ${bin} ${s.tool === 'codex' ? 'resume' : '--resume'} ${s.sessionId}`
            : `${bin} ${s.tool === 'codex' ? 'resume' : '--resume'} ${s.sessionId}`;
          navigator.clipboard?.writeText(cmd)
            .then(() => toast('已复制：' + cmd))
            .catch(() => toast('复制失败，请手动复制'));
        },
      },
      {
        label: '设置别名',
        fn: () => openRenameDialog(
          sessionKeyFor(s.tool, s.sessionId),
          customName([sessionKeyFor(s.tool, s.sessionId)], s.title)
        ),
      },
      ...(s.cwd ? [{
        label: '打开项目目录',
        fn: () => act({ action: 'open', reveal: true, path: s.cwd }),
      }] : []),
      {
        label: '在 iTerm 中打开（外置终端）',
        fn: () => act({ action: 'resume', sessionId: s.sessionId, cwd: s.cwd, tool: s.tool }),
      },
      { sep: true },
      {
        label: '删除会话',
        danger: true,
        fn: () => {
          const where = s.tool === 'codex' ? '~/.codex/trash-zyin' : '~/.claude/trash-zyin';
          showConfirm(
            `删除会话「${s.title}」？`,
            `会话文件会移到 ${where}（可手动找回），并从面板和恢复列表移除。此操作不可在面板内撤销。`,
            async () => {
              await act({ action: 'delete', tool: s.tool, sessionId: s.sessionId, path: s.path });
            },
            '确认删除'
          );
        },
      },
    ]);
    actions.append(resume, more);
    row.appendChild(actions);
    row.ondblclick = (e) => {
      if (e.target.closest('button')) return;
      openHistoryItem(s);
    };
    row.title = `双击打开（${getOpenMode() === 'embedded' ? '内置终端' : 'iTerm'}）`;
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

function translationFor(s) {
  const e = (state.skillTranslations || {})[s.path];
  if (!e) return null;
  const fresh = e.locked || (e.mtime === s.mtime && e.size === s.bytes);
  return fresh ? e : null;
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
    const tr = translationFor(s);
    line1.textContent = s.name;
    const toolCls = s.tool === 'codex' ? 'tool-codex' : s.tool === 'agents' ? 'tool-agents' : 'tool-claude';
    const toolText = s.tool === 'agents' ? '本地' : s.toolLabel;
    line1.append(el('span', `tag ${toolCls}`, toolText));
    line1.append(el('span', `tag scope-${s.scope}`, s.scope === 'project' ? '项目' : '全局'));
    if (tr) line1.append(el('span', 'tag', '译'));
    else if (showZh) line1.append(el('span', 'tag', '未译'));
    main.appendChild(line1);

    const descText = showZh && tr?.descZh ? tr.descZh : s.description;
    if (descText) {
      const desc = el('div', 'row-preview');
      desc.textContent = descText;
      main.appendChild(desc);
    }

    const meta = el('div', 'row-meta');
    if (s.scope === 'project' && s.projectName) meta.append(el('span', 'chip', s.projectName));
    meta.append(el('span', 'chip path', s.folder));
    meta.append(el('span', 'chip', `${fmtRel(s.mtime)}更新`));
    main.appendChild(meta);
    row.appendChild(main);

    const actions = el('div', 'row-actions');
    const editBtn = el('button', 'btn small', '编辑');
    editBtn.onclick = () => act({ action: 'open', reveal: false, path: s.path });
    const folderBtn = el('button', 'btn small', '文件夹');
    folderBtn.onclick = () => act({ action: 'open', reveal: true, path: s.folder });
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
        },
        '确认删除'
      );
    };
    const moreBtn = el('button', 'btn small more-btn', '⋯');
    moreBtn.title = '更多操作';
    moreBtn.onclick = (e) => showSimpleMenu(e.currentTarget, [
      { label: '重译描述', fn: () => retranslateSkill(s) },
      { label: '修正译文（锁定）', fn: () => openTransEditor(s, tr) },
      { label: '复制原文描述', fn: () => navigator.clipboard?.writeText(s.description || '').then(() => toast('已复制原文描述')).catch(() => toast('复制失败', true)) },
      { sep: true },
      { label: '删除技能', danger: true, fn: () => delBtn.onclick() },
    ]);
    actions.append(editBtn, folderBtn, moreBtn);
    row.appendChild(actions);
    SKILL_ROWS.appendChild(row);
  }
}

function configFiltered() {
  const q = CONFIG_SEARCH.value.trim().toLowerCase();
  const all = configView === 'settings' ? state.configFiles || [] : state[configView] || [];
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
  const all = configView === 'settings' ? state.configFiles || [] : state[configView] || [];
  const list = configFiltered();
  const titles = { rules: '规则库', mcp: 'MCP 服务器', agents: 'Agents', commands: '斜杠命令', hooks: 'Hooks（只读）', settings: '工具配置文件' };
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
      settings: '暂无配置文件',
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
    editBtn.onclick = () => {
      if (configView === 'settings') openConfigEditor(x.tool, x.label);
      else act({ action: 'open', reveal: false, path: file });
    };
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
          },
          '确认删除'
        );
      };
      actions.append(delBtn);
    } else if (configView !== 'settings') {
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
      } else if (payload.action === 'clear-skill-translations') {
        hideModal();
        toast('译文缓存已清除');
        refresh();
      } else if (payload.action === 'open-translation-cache') {
        toast('已在 Finder 中打开翻译缓存文件');
      } else if (payload.action === 'detach-clients') {
        hideModal();
        toast(`已断开 ${data.detached || 0} 个外部连接`);
        refresh();
      } else if (payload.action === 'terminate') {
        hideModal();
        toast('已终止会话');
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

// ---------- 终端工作台（xterm.js + tmux，多标签） ----------
function dbg(msg) {
  fetch('/api/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'dbg', msg }),
  }).catch(() => {});
}
window.addEventListener('error', (e) => dbg(`全局错误 ${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => dbg(`未处理Promise ${e.reason?.message || e.reason}`));

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function flushRecInput(rec) {
  if (!rec.buf || !rec.id) return;
  const data = rec.buf;
  rec.buf = '';
  fetch('/api/terminal-input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: rec.id, data: bytesToB64(new TextEncoder().encode(data)) }),
  }).catch(() => {});
}

function queueRecInput(rec, data) {
  if (!rec.id) return;
  rec.buf = (rec.buf || '') + data;
  if (!rec.timer) rec.timer = setInterval(() => flushRecInput(rec), 10);
}

function activeRec() {
  return termSessions.find((r) => r.name === activeTermName) || null;
}

function updateTermStatus() {
  const rec = activeRec();
  if (rec) {
    STATUS_LEFT.textContent = `tmux · ${rec.name} · ${rec.alive ? '已连接' : '已断开（后台仍运行）'}`;
    TERM_CLEAR.hidden = false;
    TERM_HISTORY.hidden = false;
  } else {
    STATUS_LEFT.textContent = '就绪';
    TERM_CLEAR.hidden = true;
    TERM_HISTORY.hidden = true;
  }
}

function enterHistoryMode() {
  const rec = activeRec();
  if (!rec || !rec.id) return;
  // 发送 tmux 前缀 Ctrl-b 再按 [ 进入 copy-mode，可滚轮/方向键翻历史
  rec.buf = (rec.buf || '') + '\u0002[';
  flushRecInput(rec);
  toast('已进入历史浏览：滚轮或方向键翻看，按 q 返回输入');
  rec.term.focus();
}

function clearActiveTerm() {
  const rec = activeRec();
  if (!rec) return;
  try { rec.term.clear(); } catch { /* 忽略 */ }
  try { rec.term.scrollToBottom(); } catch { /* 忽略 */ }
  rec.buf = (rec.buf || '') + '\u000c';
  flushRecInput(rec);
  rec.term.focus();
}

function renderTermTabs() {
  TERM_TABS.querySelectorAll('.term-tab').forEach((el) => el.remove());
  TERM_EMPTY.hidden = termSessions.length > 0;
  const hint = document.getElementById('tabsHint');
  if (hint) hint.hidden = termSessions.length > 0;
  for (const rec of termSessions) {
    const btn = document.createElement('button');
    btn.className = 'term-tab' + (rec.name === activeTermName ? ' active' : '');
    btn.type = 'button';
    const dot = document.createElement('i');
    dot.className = rec.alive ? 'tdot on' : 'tdot';
    const label = document.createElement('span');
    label.textContent = customName([`tmux:${rec.name}`], rec.name);
    const close = document.createElement('b');
    close.textContent = '×';
    close.title = '关闭视图（tmux 仍在后台）';
    close.onclick = (e) => { e.stopPropagation(); closeTermTab(rec.name); };
    btn.append(dot, label, close);
    btn.onclick = () => activateTerminal(rec.name);
    btn.ondblclick = (e) => {
      e.stopPropagation();
      openRenameDialog(`tmux:${rec.name}`, customName([`tmux:${rec.name}`], rec.name), 'alias');
    };
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const items = [];
      if (rec.cwd) items.push({ label: '打开会话目录', fn: () => act({ action: 'open', reveal: true, path: rec.cwd }) });
      items.push({ label: '设置显示别名', fn: () => openRenameDialog(`tmux:${rec.name}`, customName([`tmux:${rec.name}`], rec.name), 'alias') });
      showSimpleMenu(btn, items);
    };
    TERM_TABS.insertBefore(btn, hint);
  }
  const info = [];
  const btn = TERM_TABS.querySelector('.term-tab');
  if (btn) {
    const r = btn.getBoundingClientRect();
    const cs = getComputedStyle(btn);
    info.push(`tabRect=${Math.round(r.width)}x${Math.round(r.height)} display=${cs.display}`);
  } else {
    info.push('tabRect=无');
  }
  const tabsRect = TERM_TABS.getBoundingClientRect();
  const stageRect = TERM_STAGE.getBoundingClientRect();
  const wbRect = document.querySelector('.wb-terminal')?.getBoundingClientRect();
  info.push(`tabs=${Math.round(tabsRect.width)}x${Math.round(tabsRect.height)} stage=${Math.round(stageRect.width)}x${Math.round(stageRect.height)}`);
  if (wbRect) info.push(`wb=${Math.round(wbRect.width)}x${Math.round(wbRect.height)}`);
  dbg(`几何: ${info.join(' | ')}`);
  persistOpenTabs();
}

function persistOpenTabs() {
  try {
    localStorage.setItem('shiyi.openTabs', JSON.stringify(termSessions.map((r) => r.name)));
    localStorage.setItem('shiyi.activeTab', activeTermName || '');
  } catch { /* 忽略 */ }
}

async function restoreOpenTabs() {
  let names = [];
  let active = '';
  try {
    names = JSON.parse(localStorage.getItem('shiyi.openTabs') || '[]');
    active = localStorage.getItem('shiyi.activeTab') || '';
  } catch { /* 忽略 */ }
  if (!Array.isArray(names) || !names.length) return;
  const available = new Set((state.tmuxSessions || []).map((t) => t.name));
  for (const name of names.slice(0, 8)) {
    if (!available.has(name)) continue; // tmux 会话已不存在则跳过
    try {
      await openEmbeddedTmux(name);
      await new Promise((r) => setTimeout(r, 250));
    } catch { /* 单个失败不影响其他 */ }
  }
  if (active && termSessions.some((r) => r.name === active)) {
    activateTerminal(active);
  }
}

function activateTerminal(name) {
  const rec = termSessions.find((r) => r.name === name);
  if (!rec) return;
  activeTermName = name;
  for (const r of termSessions) {
    r.slot.style.display = r.name === name ? 'block' : 'none';
  }
  renderTermTabs();
  rec.term.focus();
  updateTermStatus();
  fitActiveTerminal();
}

function termTheme() {
  return {
    background: '#ffffff',
    foreground: '#1d2430',
    cursor: '#3455d1',
    cursorAccent: '#ffffff',
    selectionBackground: '#3455d1',
    selectionForeground: '#ffffff',
    black: '#24292e', red: '#c3312c', green: '#116b46', yellow: '#8a5b00',
    blue: '#3455d1', magenta: '#6f42c1', cyan: '#0b7285', white: '#eef0f4',
    brightBlack: '#57606a', brightRed: '#d9524c', brightGreen: '#1a8f5f',
    brightYellow: '#b07800', brightBlue: '#5b79e8', brightMagenta: '#8c63d9',
    brightCyan: '#149aa8', brightWhite: '#ffffff',
  };
}

async function openEmbeddedTmux(name) {
  dbg(`openEmbedded 开始 ${name}`);
  if (typeof Terminal === 'undefined') {
    toast('终端组件未加载，请强制刷新（⌘⇧R）', true);
    return;
  }
  toast(`正在连接 tmux · ${name} …`);
  STATUS_LEFT.textContent = `打开 ${name}：初始化…`;
  const exists = termSessions.find((r) => r.name === name);
  if (exists) { activateTerminal(name); STATUS_LEFT.textContent = `tmux · ${name} · 已打开已有视图`; return; }

  const rec = {
    name,
    id: null,
    alive: false,
    buf: '',
    timer: null,
    reader: null,
    slot: null,
    term: null,
    cwd: '',
  };
  const meta = (state.tmuxSessions || []).find((t) => t.name === name);
  rec.cwd = meta?.cwd || meta?.session?.cwd || '';
  rec.slot = document.createElement('div');
  rec.slot.className = 'term-slot';
  rec.slot.style.display = 'block';
  TERM_STAGE.appendChild(rec.slot);
  const term = new Terminal({
    fontFamily: '"SF Mono", Menlo, Monaco, monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    macOptionClickForcesSelection: true,
    theme: termTheme(),
  });
  rec.term = term;
  try {
    if (typeof CanvasAddon !== 'undefined') {
      term.loadAddon(new CanvasAddon.CanvasAddon());
    }
  } catch { /* 忽略，回退 DOM 渲染 */ }
  try {
    term.open(rec.slot);
    dbg('xterm.open 成功');
  } catch (e) {
    dbg(`xterm.open 异常 ${e.message}`);
    rec.slot.remove();
    toast(`终端初始化失败：${e.message}`, true);
    return;
  }
  STATUS_LEFT.textContent = `打开 ${name}：终端组件已创建`;
  termSessions.push(rec);
  activeTermName = name;
  renderTermTabs();
  dbg('renderTermTabs 完成');
  activateTerminal(name);
  dbg('activateTerminal 完成');
  STATUS_LEFT.textContent = `打开 ${name}：标签已就绪，正在 attach…`;
  term.onData((d) => {
    queueRecInput(rec, d);
  });
  // 文本统一由全局的 input/compositionend 处理器接管（见文件末尾）
  try {
    if (rec.term.textarea) rec.term.textarea.__rec = rec;
  } catch { /* 忽略 */ }
  try {
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      // 输入法组合过程中交给 xterm 正常处理
      if (e.isComposing || e.keyCode === 229) return true;
      // Shift+PageUp/PageDown 滚动本地缓冲（不会被 TUI 抢占）
      if (e.shiftKey && (e.key === 'PageUp' || e.key === 'PageDown')) {
        e.preventDefault();
        rec.term.scrollPages(e.key === 'PageUp' ? -1 : 1);
        return false;
      }
      if (e.type === 'keydown' && (e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'c') {
          const sel = term.getSelection();
          if (sel) {
            e.preventDefault();
            navigator.clipboard?.writeText(sel).catch(() => {});
            return false;
          }
        }
        if (k === 'v') {
          e.preventDefault();
          navigator.clipboard?.readText().then((t) => {
            if (t) { rec.buf = (rec.buf || '') + t; flushRecInput(rec); }
          }).catch(() => {});
          return false;
        }
      }
      return true;
    });
  } catch { /* 兼容旧版忽略 */ }
  // Shift + 滚轮：强制滚动终端本地缓冲（绕过 TUI 的鼠标接管）
  rec.slot.addEventListener('wheel', (ev) => {
    if (!ev.shiftKey) return;
    ev.preventDefault();
    rec.term.scrollLines(Math.sign(ev.deltaY) * 3);
  }, { passive: false });
  fitActiveTerminal();

  try {
    dbg('请求 terminal-open');
    const res = await fetch('/api/terminal-open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    dbg(`terminal-open 返回 ${JSON.stringify(data).slice(0, 120)}`);
    if (!data.ok || !data.id) {
      rec.term.write(`\r\n[打开失败] ${data.error || '未知错误'}`);
      updateTermStatus();
      return;
    }
    rec.id = data.id;
    rec.alive = true;
    // 会话建立后立刻把当前窗口的真实行列同步给 PTY/tmux（关键：避免 tmux 仍停留在 100×34）
    setTimeout(() => { try { fitActiveTerminal(); } catch { /* 忽略 */ } }, 150);
    updateTermStatus();
    STATUS_LEFT.textContent = `tmux · ${name} · 已连接`;
    setTimeout(() => { try { rec.term.scrollToBottom(); } catch { /* 忽略 */ } }, 350);
    dbg('已连接，等待 tmux 画面');
    connectTermStream(rec);
  } catch (e) {
    dbg(`terminal-open 异常 ${e.message}`);
    rec.term.write(`\r\n[连接失败] ${e.message}`);
    STATUS_LEFT.textContent = `打开 ${name} 失败：${e.message}`;
  }
}

function handleEmbeddedOpen(name) {
  try {
    openEmbeddedTmux(name).catch((e) => toast(`打开内置终端失败：${e.message}`, true));
  } catch (e) {
    toast(`打开内置终端失败：${e.message}`, true);
  }
}

async function connectTermStream(rec) {
  try {
    const res = await fetch(`/api/terminal-stream/${encodeURIComponent(rec.id)}`);
    if (!res.ok || !res.body) { rec.alive = false; updateTermStatus(); return; }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let payload = '';
        let closed = false;
        for (const line of block.split('\n')) {
          if (line.startsWith('data: ')) payload += line.slice(6);
          if (line.startsWith('event: close')) closed = true;
        }
        if (closed) {
          rec.alive = false;
          rec.term.write('\r\n\x1b[0m[会话已断开，tmux 仍在后台；可点标签重新打开]');
          updateTermStatus();
          renderTermTabs();
          return;
        }
        if (payload) {
          try {
            const raw = atob(payload);
            const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
            rec.term.write(bytes);
          } catch { /* 忽略坏帧 */ }
        }
      }
    }
    rec.alive = false;
    updateTermStatus();
  } catch {
    rec.alive = false;
    updateTermStatus();
  }
}

function fitActiveTerminal() {
  const rec = activeRec();
  if (!rec || rec.slot.clientWidth === 0) return;
  let cw = 8.0;
  let ch = 15.6;
  try {
    const dim = rec.term._core?._renderService?.dimensions?.css?.cell;
    if (dim && dim.width > 1 && dim.height > 1) {
      cw = dim.width;
      ch = dim.height;
    }
  } catch { /* 使用回退估算 */ }
  let availW = rec.slot.clientWidth;
  let availH = rec.slot.clientHeight;
  try {
    const cs = getComputedStyle(rec.term.element);
    availW -= parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
    availH -= parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0');
  } catch { /* 忽略 */ }
  const cols = Math.max(20, Math.floor(availW / cw));
  const rows = Math.max(5, Math.floor(availH / ch));
  try {
    rec.term.resize(cols, rows);
    STATUS_RIGHT.textContent = `${cols}×${rows} · ⌥拖动选择复制 · ⌘L 列表 · ⌘1-9 切标签`;
  } catch { /* 忽略 */ }
  try {
    const slot = rec.slot.getBoundingClientRect();
    const el = rec.term.element?.getBoundingClientRect();
    const screen = rec.term.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
    const canvas = rec.term.element?.querySelector('canvas')?.getBoundingClientRect();
    dbg(`终端几何 slot=${Math.round(slot.width)}x${Math.round(slot.height)} xtermEl=${el ? `${Math.round(el.width)}x${Math.round(el.height)}` : '-'} screen=${screen ? `${Math.round(screen.width)}x${Math.round(screen.height)}` : '-'} canvas=${canvas ? `${Math.round(canvas.width)}x${Math.round(canvas.height)}` : '-'} cols=${cols} rows=${rows}`);
  } catch { /* 忽略 */ }
  if (rec.id) {
    fetch('/api/terminal-input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rec.id, data: '', resize: { cols, rows } }),
    }).catch(() => {});
  }
}

function scheduleFit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(fitActiveTerminal, 120);
}

function closeTermTab(name) {
  const idx = termSessions.findIndex((r) => r.name === name);
  if (idx < 0) return;
  const rec = termSessions[idx];
  if (rec.timer) clearInterval(rec.timer);
  if (rec.id) {
    fetch('/api/terminal-close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rec.id }),
    }).catch(() => {});
  }
  try { rec.reader?.cancel(); } catch { /* 忽略 */ }
  try { rec.term.dispose(); } catch { /* 忽略 */ }
  rec.slot.remove();
  termSessions.splice(idx, 1);
  if (activeTermName === name) {
    activeTermName = termSessions.length ? termSessions[0].name : null;
  }
  renderTermTabs();
  if (activeTermName) activateTerminal(activeTermName);
  updateTermStatus();
}

function setDrawer(open) {
  drawerOpen = open;
  WB_DRAWER.classList.toggle('open', open);
  WB_DRAWER.setAttribute('aria-hidden', String(!open));
  RAIL_TOGGLE.setAttribute('aria-pressed', String(open));
  scheduleFit();
}

function updateDrawerLayout() {
  const panels = document.querySelectorAll('.mini-panel');
  const historyCollapsed = panels[1]?.classList.contains('collapsed');
  WB_DRAWER.classList.toggle('history-collapsed', Boolean(historyCollapsed));
}

function openNewSession() {
  const home = state.homeDir || '';
  let last = '';
  try { last = localStorage.getItem('shiyi.lastDir') || ''; } catch { /* 忽略 */ }
  const dirs = [...new Set([home, last, ...(state.sessions || []).map((s) => s.cwd)].filter(Boolean))];
  NEW_DIR.innerHTML = '';
  for (const d of dirs.slice(0, 60)) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    NEW_DIR.appendChild(opt);
  }
  NEW_DIR.value = last || home || dirs[0] || '';
  NEW_NAME.value = '';
  updatePermSelect();
  NEW_BACKDROP.hidden = false;
  NEW_NAME.focus();
}

function updatePermSelect() {
  const perms = {
    bash: [],
    claude: [
      ['', '默认权限'],
      ['--permission-mode bypassPermissions', 'bypassPermissions（全自动，谨慎）'],
    ],
    codex: [
      ['', '默认权限'],
      ['--yolo', '--yolo（自动批准，谨慎）'],
    ],
  };
  const list = perms[newTool] || [];
  NEW_PERM.innerHTML = '';
  for (const [value, label] of list) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    NEW_PERM.appendChild(opt);
  }
  NEW_PERM_WRAP.hidden = list.length === 0;
}

async function createNewSession() {
  const dir = NEW_DIR.value;
  if (!dir) return toast('请选择工作目录', true);
  let name = NEW_NAME.value.trim();
  if (!name) name = `shiyi-${Date.now().toString(36)}`;
  dbg(`创建会话 tool=${newTool} dir=${dir} name=${name} perm=${NEW_PERM.value}`);
  NEW_CREATE.disabled = true;
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tmux-new', name, dir, tool: newTool, perm: NEW_PERM.value }),
    });
    const data = await res.json();
    dbg(`创建返回 ${JSON.stringify(data).slice(0, 160)}`);
    if (!data.ok) {
      toast(`创建失败：${data.error || ''}`, true);
      return;
    }
    NEW_BACKDROP.hidden = true;
    const finalName = data.name || name;
    try { localStorage.setItem('shiyi.lastDir', dir); } catch { /* 忽略 */ }
    toast(`已创建 ${finalName}，正在打开…`);
    await refresh();
    openEmbeddedTmux(finalName);
  } catch (e) {
    toast(`创建失败：${e.message}`, true);
  } finally {
    NEW_CREATE.disabled = false;
  }
}

async function browseDir() {
  DIR_BROWSE.disabled = true;
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pick-dir' }),
    });
    const data = await res.json();
    if (data.ok && !data.canceled && data.dir) {
      dbg(`浏览目录选中 ${data.dir}`);
      const existing = [...NEW_DIR.options].some((o) => o.value === data.dir);
      if (!existing) {
        const opt = document.createElement('option');
        opt.value = data.dir;
        opt.textContent = data.dir;
        NEW_DIR.appendChild(opt);
      }
      NEW_DIR.value = data.dir;
    }
  } catch (e) {
    toast(`选择目录失败：${e.message}`, true);
  } finally {
    DIR_BROWSE.disabled = false;
  }
}

function openTransEditor(skill, tr) {
  transCurrent = skill;
  TRANS_TITLE.textContent = `修正译文 · ${skill.name}`;
  TRANS_NAME.value = skill.name;
  TRANS_NAME.disabled = true;
  TRANS_DESC.value = tr?.descZh || '';
  TRANS_BACKDROP.hidden = false;
  TRANS_NAME.focus();
}

async function saveTransEditor() {
  if (!transCurrent) return;
  TRANS_SAVE.disabled = true;
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set-skill-translation',
        path: transCurrent.path,
        nameZh: transCurrent.name,
        descZh: TRANS_DESC.value.trim(),
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      toast(`保存失败：${data.error || ''}`, true);
      return;
    }
    TRANS_BACKDROP.hidden = true;
    toast('译文已保存并锁定');
    await refresh();
  } catch (e) {
    toast(`保存失败：${e.message}`, true);
  } finally {
    TRANS_SAVE.disabled = false;
  }
}

async function translateMissingSkills() {
  toast('正在翻译缺失项…');
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'translate-skills', force: false }),
    });
    const data = await res.json();
    if (!data.ok) toast(`翻译失败：${data.error || ''}`, true);
    else toast(`已翻译 ${data.translated} 项（共 ${data.total}）`);
    await refresh();
  } catch (e) {
    toast(`翻译失败：${e.message}`, true);
  }
}

function toggleSkillLang() {
  showZh = !showZh;
  try { localStorage.setItem('shiyi.skillLang', showZh ? 'zh' : 'en'); } catch { /* 忽略 */ }
  renderSkills();
  toast(showZh ? '已切换为中文描述' : '已切换为英文原文');
}

async function forceTranslateAll() {
  toast('正在重新翻译全部技能（较慢）…');
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'translate-skills', force: true }),
    });
    const data = await res.json();
    if (!data.ok) toast(`翻译失败：${data.error || ''}`, true);
    else toast(`已重新翻译 ${data.translated} 项`);
    await refresh();
  } catch (e) {
    toast(`翻译失败：${e.message}`, true);
  }
}

async function retranslateSkill(skill) {
  toast(`正在重译 ${skill.name}…`);
  try {
    const res = await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'translate-skill', path: skill.path, force: true }),
    });
    const data = await res.json();
    if (!data.ok) toast(`重译失败：${data.error || ''}`, true);
    else toast('已重新翻译');
    await refresh();
  } catch (e) {
    toast(`重译失败：${e.message}`, true);
  }
}

async function openConfigEditor(tool, label) {
  try {
    const res = await fetch(`/api/config-file?tool=${encodeURIComponent(tool)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      toast(`读取失败：${data.error || ''}`, true);
      return;
    }
    cfgCurrent = { tool, label, path: data.path };
    CFG_TITLE.textContent = `编辑 ${label}`;
    CFG_TEXT.value = data.content;
    renderCfgPreview();
    CFG_BACKDROP.hidden = false;
    CFG_TEXT.focus();
  } catch (e) {
    toast(`读取失败：${e.message}`, true);
  }
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tokSpan(cls, text) {
  return `<span class="${cls}">${escHtml(text)}</span>`;
}

function highlightJson(src) {
  const out = [];
  const reWord = /[A-Za-z0-9_\-+.]+/y;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"') {
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        if (src[j] === '"' && src[j - 1] !== '\\') { closed = true; j += 1; break; }
        j += 1;
      }
      out.push(tokSpan('tok-str', src.slice(i, closed ? j : j)));
      i = closed ? j : src.length;
      continue;
    }
    if (/[A-Za-z0-9_\-+.]/.test(ch)) {
      reWord.lastIndex = i;
      const m = reWord.exec(src);
      if (m) {
        const word = m[0];
        if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(word)) out.push(tokSpan('tok-num', word));
        else if (word === 'true' || word === 'false' || word === 'null') out.push(tokSpan('tok-lit', word));
        else out.push(escHtml(word));
        i = m.index + word.length;
        continue;
      }
    }
    out.push(escHtml(ch));
    i += 1;
  }
  return out.join('');
}

function highlightToml(src) {
  const out = [];
  for (const raw of src.split('\n')) {
    const line = raw.trimEnd();
    if (/^\s*#/.test(line)) {
      out.push(tokSpan('tok-com', raw) + '\n');
      continue;
    }
    if (/^\s*\[[^\]]*\]\s*(#.*)?$/.test(line)) {
      const m = line.match(/^(\s*\[[^\]]*\])(\s*#.*)?$/);
      if (m) out.push(tokSpan('tok-sec', m[1]) + (m[2] ? tokSpan('tok-com', m[2]) : '') + '\n');
      else out.push(escHtml(raw) + '\n');
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0) {
      const key = line.slice(0, eq).trim();
      let rest = line.slice(eq + 1).trim();
      const hash = rest.indexOf('#');
      let comment = '';
      if (hash >= 0) {
        const quoteBefore = rest.slice(0, hash).split('"').length % 2 === 0;
        if (!quoteBefore) { comment = rest.slice(hash); rest = rest.slice(0, hash).trimEnd(); }
      }
      out.push(tokSpan('tok-key', line.slice(0, eq)));
      out.push(' = ');
      if (rest.startsWith('"') || rest.startsWith("'")) {
        out.push(tokSpan('tok-str', rest.split(/#/)[0]));
      } else {
        const words = rest.split(/\s+/);
        for (let w = 0; w < words.length; w++) {
          const word = words[w];
          if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(word)) out.push(tokSpan('tok-num', word));
          else if (word === 'true' || word === 'false') out.push(tokSpan('tok-lit', word));
          else out.push(escHtml(word));
          if (w < words.length - 1) out.push(' ');
        }
      }
      if (comment) out.push(' ' + tokSpan('tok-com', comment));
      out.push('\n');
      continue;
    }
    out.push(escHtml(raw) + '\n');
  }
  return out.join('');
}

function renderCfgPreview() {
  const src = CFG_TEXT.value;
  CFG_PRE.innerHTML = cfgCurrent?.tool === 'claude' ? highlightJson(src) : highlightToml(src);
  CFG_PRE.scrollTop = CFG_TEXT.scrollTop;
}

async function saveConfigEditor() {
  if (!cfgCurrent) return;
  CFG_SAVE.disabled = true;
  try {
    const res = await fetch('/api/config-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: cfgCurrent.tool, content: CFG_TEXT.value }),
    });
    const data = await res.json();
    if (!data.ok) {
      toast(`保存失败：${data.error || ''}`, true);
      return;
    }
    CFG_BACKDROP.hidden = true;
    toast('已保存（原文件已备份）');
    await refresh();
  } catch (e) {
    toast(`保存失败：${e.message}`, true);
  } finally {
    CFG_SAVE.disabled = false;
  }
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

function showConfirm(title, text, onOk, okLabel = '确认') {
  MODAL_TITLE.textContent = title;
  MODAL_TEXT.textContent = text;
  MODAL_OK.textContent = okLabel;
  MODAL_COMMAND.hidden = true;
  MODAL_COPY.hidden = true;
  MODAL_OK.hidden = false;
  MODAL_CLOSE.textContent = '取消';
  MODAL_BACKDROP.hidden = false;
  MODAL_OK.onclick = async () => {
    if (MODAL_OK.disabled) return;
    MODAL_OK.disabled = true;
    hideModal();
    try {
      await onOk();
    } finally {
      MODAL_OK.disabled = false;
    }
  };
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
  renderTermTabs();
  checkCtxWarnings([
    ...(state.windows || []).map((w) => sessionMetaById(w.session?.sessionId)),
    ...(state.tmuxSessions || []).map((t) => sessionMetaById(t.session?.sessionId)),
  ].filter(Boolean));
  const runningCount = liveAll().length;
  const histCount = baseHistory().length;
  TAB_SESS_COUNT.textContent = String(runningCount + histCount);
  TAB_SESSIONS.title = `运行 ${runningCount} · 历史 ${histCount}`;
  TAB_SKILL_COUNT.textContent = (state.skills || []).length;
  TAB_CONFIG_COUNT.textContent =
    (state.rules || []).length + (state.mcp || []).length +
    (state.agents || []).length + (state.commands || []).length + (state.hooks || []).length;
  REFRESH.textContent = `更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
  if (state.demo && !window.__demoOpened) {
    window.__demoOpened = true;
    window.__tabsRestored = true;
    setTimeout(() => openEmbeddedTmux('shiyi-demo'), 300);
  }
  if (!state.demo && !window.__tabsRestored) {
    window.__tabsRestored = true;
    setTimeout(() => { restoreOpenTabs().catch(() => {}); }, 500);
  }
}

TAB_SESSIONS.addEventListener('click', () => activateTab('sessions'));
TAB_SKILLS.addEventListener('click', () => activateTab('skills'));
TAB_CONFIG.addEventListener('click', () => activateTab('config'));
for (const head of document.querySelectorAll('.mini-head')) {
  head.addEventListener('click', (e) => {
    if (e.target.closest('input, select, button, .count')) return;
    head.closest('.mini-panel').classList.toggle('collapsed');
    updateDrawerLayout();
    scheduleFit();
  });
}
for (const btn of document.querySelectorAll('[data-search]')) {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = btn.closest('.mini-panel');
    const box = panel.querySelector('.mini-search');
    const show = box.hidden;
    box.hidden = !show;
    btn.setAttribute('aria-expanded', String(show));
    if (show) {
      requestAnimationFrame(() => { const inp = box.querySelector('input,select'); inp?.focus(); });
    }
    scheduleFit();
  });
}
RAIL_TOGGLE.addEventListener('click', () => setDrawer(!drawerOpen));
function openDrawerMenu(anchor) {
  const embedded = getOpenMode() === 'embedded';
  showSimpleMenu(anchor, [
    { label: '打开方式：内置终端', check: embedded, fn: () => { setOpenMode('embedded'); toast('「打开」将使用内置终端'); } },
    { label: '打开方式：iTerm 窗口', check: !embedded, fn: () => { setOpenMode('iterm'); toast('「打开」将使用 iTerm'); } },
    { sep: true },
    { label: '释放空闲内存（>30 分钟）', fn: () => releaseIdleSessions() },
    { label: '收起会话列表 ⌘L', fn: () => setDrawer(false) },
  ]);
}
DRAWER_MORE.addEventListener('click', (e) => openDrawerMenu(e.currentTarget));
MEM_TOTAL.addEventListener('click', (e) => openDrawerMenu(e.currentTarget));
// 抽屉宽度拖拽
function applyDrawerWidth(px) {
  const w = Math.max(240, Math.min(760, Math.round(px)));
  WB_DRAWER.style.setProperty('--drawer-w', `${w}px`);
  return w;
}
try {
  const saved = parseFloat(localStorage.getItem('shiyi.drawerW') || '');
  if (saved) applyDrawerWidth(saved);
} catch { /* 忽略 */ }
DRAWER_RESIZER.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startW = WB_DRAWER.getBoundingClientRect().width;
  WB_DRAWER.classList.add('resizing');
  document.body.classList.add('resizing-drawer');
  const onMove = (ev) => {
    applyDrawerWidth(startW + (ev.clientX - startX));
    scheduleFit();
  };
  const onUp = () => {
    WB_DRAWER.classList.remove('resizing');
    document.body.classList.remove('resizing-drawer');
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    try { localStorage.setItem('shiyi.drawerW', String(Math.round(WB_DRAWER.getBoundingClientRect().width))); } catch { /* 忽略 */ }
    scheduleFit();
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
});
TERM_NEW.addEventListener('click', openNewSession);
TERM_CLEAR.addEventListener('click', clearActiveTerm);
TERM_HISTORY.addEventListener('click', enterHistoryMode);
SKILL_MORE.addEventListener('click', (e) => {
  showSimpleMenu(e.currentTarget, [
    { label: '自动翻译缺失项', fn: () => translateMissingSkills() },
    { label: '全部重新翻译', fn: () => forceTranslateAll() },
    { sep: true },
    { label: showZh ? '显示英文原文' : '显示中文描述', check: showZh, fn: toggleSkillLang },
    { label: '打开翻译缓存文件', fn: () => act({ action: 'open-translation-cache' }) },
    {
      label: '清除译文缓存',
      danger: true,
      fn: () => showConfirm('清除全部译文缓存？', '只是删除本地翻译缓存，技能文件不受影响；下次可重新翻译。', async () => {
        await act({ action: 'clear-skill-translations' });
      }, '确认清除'),
    },
  ]);
});
FOCUS_TOGGLE.addEventListener('click', () => setFocusMode(!focusMode));
// 终端文本统一通道：输入法提交与普通输入都从这里走，避免与 xterm 重复发送
function sendComposedText(rec, data, ev) {
  if (data) {
    queueRecInput(rec, data);
    flushRecInput(rec);
    try { rec.term.scrollToBottom(); } catch { /* 忽略 */ }
  }
  try { ev.target.value = ''; } catch { /* 忽略 */ }
  ev.preventDefault();
  ev.stopImmediatePropagation();
}
document.addEventListener('input', (ev) => {
  const rec = ev.target && ev.target.__rec;
  if (!rec || ev.isComposing) return;
  sendComposedText(rec, ev.data, ev);
}, true);
document.addEventListener('compositionend', (ev) => {
  const rec = ev.target && ev.target.__rec;
  if (!rec) return;
  sendComposedText(rec, ev.data, ev);
}, true);
document.addEventListener('mousemove', (e) => {
  if (!focusMode) return;
  if (e.clientY < 8) document.body.classList.add('top-hover');
  else if (e.clientY > 60) document.body.classList.remove('top-hover');
});
TRANS_CANCEL.addEventListener('click', () => { TRANS_BACKDROP.hidden = true; });
TRANS_SAVE.addEventListener('click', saveTransEditor);
RENAME_CANCEL.addEventListener('click', () => { RENAME_BACKDROP.hidden = true; });
RENAME_SAVE.addEventListener('click', saveRenameDialog);
RENAME_INPUT.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveRenameDialog(); } });
document.getElementById('drawerNew').addEventListener('click', openNewSession);
document.getElementById('emptyNew').addEventListener('click', openNewSession);
DIR_BROWSE.addEventListener('click', browseDir);
NEW_CANCEL.addEventListener('click', () => { NEW_BACKDROP.hidden = true; });
NEW_CREATE.addEventListener('click', createNewSession);
CFG_CANCEL.addEventListener('click', () => { CFG_BACKDROP.hidden = true; });
CFG_SAVE.addEventListener('click', saveConfigEditor);
CFG_TEXT.addEventListener('input', renderCfgPreview);
CFG_TEXT.addEventListener('scroll', () => {
  CFG_PRE.scrollTop = CFG_TEXT.scrollTop;
  CFG_PRE.scrollLeft = CFG_TEXT.scrollLeft;
});
NEW_NAME.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createNewSession(); } });
for (const btn of NEW_TOOL_BTNS) {
  btn.addEventListener('click', () => {
    newTool = btn.dataset.newtool;
    for (const b of NEW_TOOL_BTNS) b.classList.toggle('active', b === btn);
    updatePermSelect();
  });
}
if (window.ResizeObserver) {
  new ResizeObserver(scheduleFit).observe(TERM_STAGE);
}
let resizeDbgTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeDbgTimer);
  resizeDbgTimer = setTimeout(() => {
    const body = document.body.getBoundingClientRect();
    const page = document.getElementById('pageMain')?.getBoundingClientRect();
    const wb = document.querySelector('.wb-terminal')?.getBoundingClientRect();
    const wbw = document.querySelector('.workbench')?.getBoundingClientRect();
    const pageStyle = page ? getComputedStyle(document.getElementById('pageMain')) : null;
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
    dbg(`尺寸 body=${Math.round(body.width)}x${Math.round(body.height)} tab=${document.body.dataset.tab} pageMain=${page ? `${Math.round(page.width)}x${Math.round(page.height)}` : '-'} pageMax=${pageStyle?.maxWidth} pageMargin=${pageStyle?.margin} topbar=${topbar ? Math.round(topbar.width) : '-'} wb=${wb ? `${Math.round(wb.width)}x${Math.round(wb.height)}` : '-'} workbench=${wbw ? `${Math.round(wbw.width)}x${Math.round(wbw.height)}` : '-'}`);
  }, 350);
});
document.addEventListener('keydown', (e) => {
  if (!e.metaKey && !e.ctrlKey) return;
  const key = e.key.toLowerCase();
  if (key === 'f' && e.shiftKey) { e.preventDefault(); setFocusMode(!focusMode); return; }
  if (key === 'l') { e.preventDefault(); setDrawer(!drawerOpen); return; }
  if (key === 'k' && !e.shiftKey) { e.preventDefault(); setDrawer(false); return; }
  if (/^[1-9]$/.test(key) && !e.shiftKey) {
    const n = Number(key) - 1;
    if (termSessions[n]) { e.preventDefault(); activateTerminal(termSessions[n].name); }
  }
});
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
activateTab(location.hash.replace('#', '') || (() => { try { return localStorage.getItem('shiyi.tab'); } catch { return null; } })() || 'sessions');
if (location.hash === '#mcp') {
  activateTab('config');
  configView = 'mcp';
  for (const b of CONFIG_VIEW_BTNS) b.classList.toggle('active', b.dataset.cview === 'mcp');
  renderConfig();
}
window.addEventListener('hashchange', () => activateTab(location.hash.replace('#', '')));
setInterval(refresh, 5000);
setInterval(() => { renderLive(); renderHistory(); renderSkills(); renderConfig(); }, 30000);
