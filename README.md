# 拾忆（Shiyi）

> 把散落在 Claude Code / Codex 里的会话与技能，一处拾回。

拾忆是一个**本地优先**的 macOS 桌面工具：实时查看终端里正在运行的 AI 编码会话、检索全部历史会话并一键恢复，同时统一管理两套工具链的技能、规则、MCP、Agent、命令与 Hooks。

数据全部留在本机，不依赖任何云端服务。

## 功能

- **会话**
  - 实时映射 iTerm 窗口 ↔ 正在运行的 Claude Code / Codex 会话，一键聚焦
  - 全量历史检索：标题 / 内容 / 目录 / 工具，按目录筛选
  - 一键恢复：优先在 iTerm 新标签打开，失败自动降级到 Terminal.app 或复制命令
  - 删除会话：移入本地回收目录，可恢复
- **技能**
  - 全局 / 项目两级浏览，来源标签（Claude Code / Codex / 本地）
  - 编辑、定位文件夹、删除到回收
- **配置**
  - 规则库：`CLAUDE.md` / `AGENTS.md`（用户全局 + 项目）
  - MCP 服务器：来源、命令/地址、env 项数（密钥不回显）、**连通性检测**
  - Agent 角色、斜杠命令、Hooks 只读总览

## 快速开始

### 方式一：开发模式（浏览器面板）

```bash
# 1. 安装可选依赖（iTerm 一键恢复；纯网页使用可跳过）
bash scripts/setup.sh

# 2. 启动服务
cd app
node server.mjs
```

打开 <http://127.0.0.1:8787>。

### 方式二：打包为 macOS 应用

```bash
bash scripts/setup.sh        # 首次需要
bash app/macos/build_app.sh  # 产物在 app/macos/.build/拾忆.app
open "app/macos/.build/拾忆.app"
```

## 依赖与要求

- macOS 12+（App 壳基于 Swift + WebKit；命令行模式仅需 Node.js 18+）
- Node.js（内置模块，无 npm 运行时依赖）
- 可选：iTerm2，并在 `Settings → General → Magic` 勾选 **Enable Python API**（提供一键在 iTerm 新标签恢复会话的能力）
- 会话恢复兼容任意通过 Anthropic 兼容端点接入的模型（Claude、DeepSeek 等），配置继承自你本机的 Claude Code / Codex

## 目录结构

```text
.
├── app/                    # 应用本体
│   ├── server.mjs          # 本地 HTTP 服务（零依赖 Node）
│   ├── lib/                # 会话 / 技能 / 规则 / MCP 扫描与检测
│   ├── public/             # 前端单页（Tab 式管理界面）
│   ├── macos/              # macOS 原生壳（Swift + WebKit）
│   └── package.json
├── docs/
│   ├── architecture.md     # 架构与数据源说明
│   └── requirements.md     # 早期产品需求稿（存档）
└── scripts/
    ├── setup.sh                    # 本地依赖安装
    └── migrate-codex-path.mjs      # 目录改名后迁移 Codex 会话路径
```

## 目录改名后怎么办

如果移动了项目所在的绝对路径（例如 `ZYin` → `Shiyi`）：

1. 在 `app/path-aliases.json`（不入库，参考 `app/path-aliases.example.json`）里登记 `old → new` 映射，面板会立即按新路径显示与恢复历史会话；
2. 退出所有相关 Codex 会话后，运行物理迁移（把会话文件里记录的旧路径改写为新路径）：

   ```bash
   node scripts/migrate-codex-path.mjs /旧/绝对/路径 /新/绝对/路径
   # 先加 --dry 预检
   ```

> 正在运行的 Codex 会话会持有会话文件句柄，迁移前必须先退出，避免数据损坏。

## 隐私与安全

- 服务只监听 `127.0.0.1`，所有数据（会话记录、配置）只在本机读写
- MCP 配置中的环境变量/密钥只在进程内使用，绝不回传到界面
- 删除操作统一采用"移入本地回收目录"而非物理删除，可手动找回

## License

[MIT](./LICENSE)
