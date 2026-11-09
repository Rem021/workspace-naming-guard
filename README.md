# Workspace Naming Guard (`workspace-naming-guard`)

**Zero-latency `Project｜Topic` workspace & Git worktree auto-namer for [Orca](https://onorca.dev/).**

![Workspace Naming Guard Cover](assets/cover.png)

---

## Why Workspace Naming Guard?

When running dozens or hundreds of parallel coding agents across multiple repositories in Orca, sidebar hygiene quickly breaks down:
1. **Random animal slugs**: Newly created folder workspaces and Git worktrees start with random names like `blobfish`, `seagrass`, or `codex/mojarra`.
2. **Disconnected chat & worktree names**: Orca names agent chat tabs and worktree branches independently, often leaving worktrees stuck on generic slugs or failing when background CLI branch-renaming hits rate/usage limits (`firstAgentMessageRenameError`).
3. **Subprocess Git-scan lag**: Naive polling scripts that shell out to `orca worktree list` trigger full Git status scans across every worktree on disk, causing multi-second UI stalls.

**Workspace Naming Guard** solves all three problems in a lightweight, zero-token `trusted-worker` plugin:
- **Stage 1 — Standby Assignment on Creation**: Listens to `workspace.created` and immediately assigns a deterministic standby display name (`<Project>｜待命工作区 <8-char hash>`) while clearing `pendingFirstAgentMessageRenameError`.
- **Stage 2 — Provisional First-Prompt Seed**: When an agent's tab title is still its prompt, extracts a clean provisional topic (`<= 24` chars) from it.
- **Stage 3 — Canonical Agent Summary & Manual Edit Guard**: Once the agent chat tab settles on a formal title, upgrades the workspace display name to `<Project>｜<Topic>`, normalizes CJK/ASCII spacing, enforces canonical project prefixes, and permanently yields if you ever rename the workspace manually.

---

## Architecture & Performance

![3-Stage Lifecycle](assets/screenshot-lifecycle.png)

- **Host API only**: the worker uses Orca's plugin host API (`workspace.list`, `workspace.readContext`, `agents.list`, `workspace.rename`), so every call is covered by the capabilities you approve on install (`workspace:read`, `workspace:write`, `agent:read`, `storage:own`). It does not read Orca's runtime token, connect to the runtime socket, read the session journal, or start any process.
- **Needs Orca with host API 1.5** (`workspace.rename`). On older builds the status bar says so and nothing is renamed.
- **New workspaces only**: it names workspaces created while it runs (from `workspace.created`), never a repository's main checkout or names you already have.
- **Focused workspace titles**: Orca reports the agents of the focused workspace, so a workspace takes its `<Project>｜<Topic>` name once you have focused it with an agent in it.
- **Write-Ahead Crash Safety**: Before each rename, the plugin records write-ahead intent in `orca.storage` (`state-v1`), verifies readback after mutation, and maintains a 1,000-entry ring buffer of rename history.
- **Zero LLM / Cloud Calls**: Pure deterministic string normalization. Never invokes an LLM, never consumes API tokens, never touches Git branches or filesystem directories, and never makes network requests.

---

## Installation

### From the Orca Community Marketplace
1. Open **Orca → Settings → Plugins**.
2. Ensure the community catalog (`https://github.com/stablyai/orca-community-plugins.git`, ref `main`) is added.
3. Search for **Workspace Naming Guard** (`rem021.workspace-naming-guard`) and click **Install**.

### From GitHub or CLI
```bash
orca plugin install https://github.com/Rem021/workspace-naming-guard.git
```

### Local Development
```bash
git clone https://github.com/Rem021/workspace-naming-guard.git
cd workspace-naming-guard
node --test *.test.mjs
orca plugin validate . --json
orca plugin dev load .
```

---

## Configuration (Environment Variables)

You can customize path boundaries and project prefix aliases via environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PROJECT_ALIASES_JSON` | Built-in map | JSON object mapping raw repository `displayName` values to canonical project prefixes (e.g. `'{"MyRepo":"CoreApp"}'`). |
| `AI_VOLUME_PATH` | `/Volumes/AI_Workspace` | Optional external volume root to include alongside `$HOME` in managed workspace path checks. |
| `ORCA_NAMING_READ_ONLY` | `0` | Set to `1` to run reconciliation in dry-run preview mode without mutating workspace names. |

---

## Commands & Status Bar

- **Status Bar Indicator (`✎ Naming Guard`)**: Shows real-time health in the Orca status bar. Clicking it runs `naming.preview`.
- **Command Palette (`Naming Guard: Preview Pending & Recent Renames`)**: Returns `{ pending, recent }` with any queued renames and the last 10 applied rename records.

---

##中文说明（Chinese Overview）

**Workspace Naming Guard** 是一款专为 Orca 打造的高性能工作区与 Git Worktree 自动命名插件：
1. **新建即刻归位**：监听 `workspace.created` 事件，将新建工作区的随机鱼名（如 `blobfish`、`seagrass`）规范化为 `项目名｜待命工作区 <短哈希>`。
2. **首条指令兜底提炼 + 标题自动升级**：当向智能体发送任务后，即使模型尚未生成会话摘要（或因 CLI 额度限制未能生成标题），也能从智能体标签页标题中的首条指令自动提炼暂定标题；待正式摘要生成后自动升级为 `项目名｜具体主题`。
3. **只用插件 Host API**：通过 `workspace.list`、`workspace.readContext`、`agents.list` 和 `workspace.rename`（需要 Orca Host API 1.5）读取与改名，全部受安装时授权的权限约束；不读取 Orca 运行时令牌、不连接运行时 Socket、不读会话日志、不启动任何进程。只接管插件运行期间新建的工作区；聚焦到工作区后按其智能体标题命名。
4. **尊重人工改名**：具备预写日志（Write-Ahead Intent）与读回校验；一旦检测到用户手动修改了已命名的工作区名称，插件永久停止接管该工作区。

---

## License

[MIT](LICENSE) © [Rem021](https://github.com/Rem021)
