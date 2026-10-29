# workbuddy-godot-expert

WorkBuddy **专家（Expert）**：一个「游戏制作人」人格，自带 Godot MCP 依赖——召唤它，就能用自然语言在 Godot 4.7 里做游戏。

和 DSH 的 Agent 预设是同一个概念：

| DSH | 这里 |
|---|---|
| Agent 预设 `game-creator` | 专家 `godot-game-expert` |
| persona | `agents/godot-game-expert.md` 的正文 |
| 预设内挂 MCP | `plugin.json` 的 `dependencies.mcpServers` |
| 预设选择器 | 专家市场 → 召唤 |

## 依赖

| 依赖 | 谁准备 | 说明 |
|---|---|---|
| **Godot 4.7+** | 你自己装 | 4.7.2 已验证 |
| **uv（`uvx`）** | 你自己装 | 后端是 PyPI 的 `godot-ai==4.2.3`，首次运行会下载约 73 个依赖，需联网 |
| **Node.js** | WorkBuddy 托管 | `.mcp.json` 已声明 `runtime: {type:"node", version:"22"}` |
| **WorkBuddy 5.0.0+** | — | 专家与托管 Node 的要求 |

包内**不含 Godot 引擎**，只含 Godot AI 编辑器插件（`vendor/godot_ai`，约 2.1 MB）。

## 安装

```powershell
git clone https://github.com/banbixieyang/workbuddy-godot-expert
cd workbuddy-godot-expert
node install.mjs --godot "D:\Godot\Godot_v4.7.2-stable_mono_win64.exe"
```

重启 WorkBuddy 后，左侧「专家 · 技能 · 连接器」→ 专家 → 我的专家，找到 **游戏制作人**，点「召唤专家」。第一次会弹「Godot 编辑器」连接引导，连一次即可。

## 它能做什么

- 建项目：`godot_new_project` —— 建目录、写 `project.godot`、装 Godot AI 插件、起后端、打开编辑器；
- 搭场景：`scene_manage`、`node_create`、`node_set_property`、`scene_get_hierarchy`；
- 写代码：`script_create`、`script_patch`、`script_attach`；
- 连信号、做 UI、调资源：`signal_manage`、`ui_manage`、`resource_manage`；
- 保存与验证：`scene_save`、`project_run`、`logs_read`、`project_manage(op="stop")`。

共 49 个工具（Godot AI 47 + 本项目 2）。

## 人格与技能

- `agents/godot-game-expert.md`：系统提示词——先读后写、小批量改、必须落盘、运行验证、Godot 4 语法要求。
- `skills/godot-game-maker/SKILL.md`：工具用法与工作流（会话选择、常用工具表、失败处理）。

## 安装脚本做了什么

`install.mjs` 把专家包复制到 `~/.workbuddy/plugins/cache/local-godot/godot-game-expert/<version>/`，在本地市场 `local-godot` 注册、写 `installed_plugins.json`、在 `settings.json` 的 `enabledPlugins` 里启用，并把 `--godot` 路径写进 `godot-path.txt`。改动前备份三个 JSON。

卸载：`node install.mjs --uninstall`。

## 已知限制

- 专家调用 `godot_new_project` 后要等 10–30 秒编辑器才注册会话，人格里已写明“先等、再 `session_manage`”。
- 一个 WorkBuddy 连接器只配一个 MCP Server；多项目同时打开时靠 `session_activate` 选目标。
- 首次运行需要联网拉 `godot-ai` 依赖。

## 许可

MIT。内置的 Godot AI Addon 亦为 MIT，见 `vendor/godot_ai/LICENSE`。
