# 拾忆 · 开发文档

> 面向后续开发者 / AI 会话。目标：读完这一份就能继续迭代。

## 1. 产品定位

本地优先的 macOS 桌面工具，把散落在 Claude Code 与 Codex 里的**会话、技能、配置**集中管理，
并提供基于 tmux 的**内置终端**工作台。无账号、无云同步，只监听 `127.0.0.1`。

## 2. 技术架构

```
┌──────────────────────────────────────────────┐
│ macOS 应用壳（Swift + WKWebView，app/macos）  │
│  · 菜单（含编辑菜单，保证 ⌘C/⌘V）             │
│  · 启动内嵌 Node 服务（登录 shell 解析 node）  │
│  · 退出时停止服务                              │
└───────────────────┬──────────────────────────┘
                    │ http://127.0.0.1:8787
┌───────────────────▼──────────────────────────┐
│ app/server.mjs（Node，仅内置模块）             │
│  · 静态资源（app/public）                      │
│  · /api/state  聚合状态                        │
│  · /api/action 所有操作                        │
│  · /api/terminal-* 内置终端（SSE + base64）    │
│  · /api/config-file、/api/config-save          │
└───┬──────────┬──────────┬──────────┬─────────┘
    │          │          │          │
 sessions   skills    registry   tmux/termproxy/terminal
（会话）    （技能）   （配置）    （终端与进程）
```

### 后端模块职责

| 模块 | 职责 | 关键点 |
|---|---|---|
| `lib/sessions.mjs` | 扫描 Claude/Codex 会话、路径别名、删除到回收 | Claude 标题取**首个 aiTitle**（避免随话题改名）；路径别名见 `app/path-aliases.json` |
| `lib/skills.mjs` | 技能扫描（全局 + 项目），范围识别 | 只认含 `SKILL.md` 的目录 |
| `lib/registry.mjs` | 规则 / MCP / Agent / 命令 / Hooks 扫描；MCP 连通性检测 | MCP 检测走 stdio initialize 握手或 HTTP POST |
| `lib/translations.mjs` | 技能描述中文翻译（缓存 + 手动锁定） | 只译 description，名称保持英文；按 mtime/size 失效；DeepSeek 分 12 条一批 |
| `lib/names.mjs` | 会话显示别名 | `~/.shiyi/session-names.json` |
| `lib/tmux.mjs` | tmux 会话/窗格探测、名称规范化、真实改名 | 会话识别用 `pane_start_command`；`tmuxBin()` 自动探测路径；默认 `mouse off` |
| `lib/termproxy.mjs` | 内置终端会话管理（attach/输入/resize/关闭/SSE） | 每个终端一个 python PTY 桥；退出时 `closeAllTerminals()` |
| `lib/terminal.mjs` | iTerm/Terminal 自动化、运行进程识别、内存、终止 | Claude 用 `~/.claude/sessions/<pid>.json` 精确映射；Codex 用打开的 rollout 文件；`terminateProcess` 杀整棵进程树 |
| `lib/configfiles.mjs` | Claude settings.json / Codex config.toml 读写 | 保存前校验 JSON + 自动备份 `.bak-<ts>` |

### 前端结构（`app/public`）

- `index.html`：单行顶栏（Logo + 拾忆 + 副标 + Tabs + 状态）、会话工作台、技能库、配置中心、各类弹层
- `app.js`：
  - Tab 切换、抽屉（可拖拽调宽、可折叠）、会话/历史渲染
  - 打开方式偏好（`shiyi.openMode`：`embedded` | `iterm`）
  - 内置终端：xterm + canvas 渲染器、多标签、标签别名、自动恢复上次标签
  - 技能翻译 UI、配置文件编辑器（语法高亮）、各类确认弹窗（按钮文案按动作区分）
- `style.css`：明亮主题 + 专注模式（`⌘⇧F`）

## 3. 关键数据流

### 3.1 会话识别（最容易踩坑）

1. **Claude Code**：读 `~/.claude/sessions/<pid>.json` 得到 PID→sessionId，精确匹配；
   进程若持有 transcript 文件则进一步校验
2. **Codex**：进程通过 `lsof` 暴露正在写入的 `rollout-*.jsonl`
3. **兜底**：按 `工具 + cwd` 取最新会话（同目录多会话时可能不准，仅作最后手段）
4. **tmux 内进程**：用 `pane_pid` 的**父子链**匹配（Codex 的 node 包装进程 → 原生二进制）
5. **历史排除**：运行中的会话（窗口或 tmux）不再出现在历史列表

### 3.2 内置终端

```
浏览器 xterm ──SSE(base64)── Node ▲ ──stdio── python pty_bridge.py ──PTY── tmux attach ── 会话
                    │                                  ▲
                    └──── POST /api/terminal-input ─────┘（输入/resize）
```

- resize：Node 写控制文件 → 向 python 发 `SIGWINCH` → python `ioctl(TIOCSWINSZ)`
- 退出应用：`SIGTERM` → `closeAllTerminals()` 清理 PTY 桥；**tmux 会话保留**

### 3.3 打开方式

- 全局偏好 `localStorage: shiyi.openMode`（`embedded` 默认 / `iterm`）
- 主按钮与双击统一走 `openRunningItem()` / `openHistoryItem()`
- `⋯` 菜单只提供"另一种方式打开"（在 iTerm 中打开 / 在内置终端打开）

## 4. API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 会话、窗口、tmux、技能、规则、MCP、Agents、命令、Hooks、配置文件、翻译、别名、内存 |
| POST | `/api/action` | 见下 |
| POST | `/api/terminal-open` | 打开内置终端（tmux attach） |
| POST | `/api/terminal-input` | 输入 / resize（base64） |
| POST | `/api/terminal-close` | 关闭终端视图 |
| GET | `/api/terminal-stream/:id` | SSE 终端输出 |
| GET | `/api/config-file?tool=claude\|codex` | 读取配置文件 |
| POST | `/api/config-save` | 保存配置文件（校验 + 备份） |

`/api/action` 的 `action` 取值：
`focus`、`resume`、`open`、`delete`、`delete-skill`、`delete-rule`、`terminate`、
`terminate-many`、`detach-clients`、`tmux-new`、`tmux-rename`、`tmux-attach`、
`adopt-session`、`pick-dir`、`mcp-check`、`translate-skills`、`translate-skill`、
`set-skill-translation`、`clear-skill-translations`、`open-translation-cache`、
`set-session-name`、`dbg`

## 5. 本地存储（均不入库）

| 路径 | 用途 |
|---|---|
| `~/.shiyi/session-names.json` | 会话显示别名 |
| `~/.shiyi/skill-translations.json` | 技能翻译缓存（含 locked 手动修正） |
| `app/path-aliases.json` | 目录改名映射（示例见 `path-aliases.example.json`） |
| `/tmp/zyin-app.log` | 应用日志 |
| `/tmp/zyin-app-server.log` | 服务日志 |

## 6. 构建与发布

```bash
bash app/macos/build_app.sh          # → app/macos/.build/拾忆.app（arm64，minos 12.0）
otool -l app/macos/.build/拾忆.app/Contents/MacOS/ShiyiSessions | grep minos   # 应显示 12.0
```

发布包要求：

1. `rsync` 时排除 `Contents/Resources/server/venv-iterm/`
2. 附 `docs/安装说明.md`
3. 确认包内无 `/Users/<name>` 路径
4. `gh release create vX.Y.Z <zip> <sha256>`（代理见下）

本机 GitHub 走代理：`export https_proxy=http://127.0.0.1:1087`（仓库 git config 已配 `http.proxy`）。

## 7. 已知坑与约束（改动前必读）

1. **WKWebView 键位映射**：`Shift+/` 等特殊字符可能丢失 → 已改为"可打印字符直通"；
   修改键盘处理时不要破坏这一逻辑
2. **xterm 透明背景**：`allowTransparency` + Canvas 渲染器会让选中变黑，禁止开启
3. **`hidden` vs `display`**：自定义 `display` 会覆盖 `hidden`，必须补 `[hidden]` 规则
4. **抽屉 `:first-child`**：抽屉第一个子元素是拖拽手柄，选择器要用
   `section.mini-panel:first-of-type`
5. **tmux `mouse on`**：滚轮会进入 copy-mode 吞掉键盘；默认 `off`，
   "历史"按钮显式进入 copy-mode 并提示按 `q` 退出
6. **多客户端 attach**：同一 tmux 会话被 iTerm 与拾忆同时连接时，视图状态（含 copy-mode）
   共享，容易出现"只有这个会话卡/不能输入"；运行行会显示"连接方"徽标并提供"断开其他连接"
7. **构建目标**：务必 `-target arm64-apple-macos12.0`，否则 macOS 26 等系统会拒绝启动
8. **不要写死本机路径**；发布包不得包含本机映射与 venv

## 8. 版本脉络

- v1.0.0 首个发布（会话/技能/配置/内置终端）
- v1.0.1 修复 macOS 兼容（部署目标 27 → 12）
- v1.0.2 tmux 自动探测、创建前依赖检查、错误提示可读性
- v1.0.3 去除本机路径、默认目录改为用户主目录
- v1.0.4 顶栏单行 + 专注模式、抽屉交互、默认目录记忆
- v1.0.5 会话角标改为总数（运行 + 历史）
- v1.0.6 内存显示与释放空闲会话、多连接方治理、终端默认不接管滚轮
- v1.0.7 终端输入单通道重构（修复中文输入法重复输入）、上下文占用徽标
- v1.0.8 上下文交接流程（自动弹窗 / `/compact` / 开新会话 + 交接摘要）、图标换薄荷汽水配色

## 9. 待办 / 可继续方向

- [ ] 内置 Node 运行时（目标机零依赖）
- [ ] 应用内"环境自检"面板（Node / tmux / CLI / iTerm API 一键检查）
- [ ] 会话操作的撤销（回收目录恢复入口可视化）
- [ ] MCP 配置的可视化编辑（当前只提供原始文件编辑）
- [ ] 空闲会话策略（阈值可配置；不做自动终止）
