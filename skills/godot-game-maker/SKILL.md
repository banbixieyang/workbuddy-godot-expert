# Godot 游戏制作

用这套工具直接操作**本机已打开的 Godot 4.7 编辑器**：它改的是真实的场景树和磁盘上的 `.tscn` / `.gd`，不是生成代码片段。

## 还没有项目？直接建

- **新项目**：`godot_new_project(path, name?, width?, height?)` —— 建目录、写 `project.godot`、装好 Godot AI 插件、确保后端在跑、打开编辑器。返回 `editorPid`。
- **已有项目**：`godot_open_project(path)` —— 确保后端并打开编辑器。

两个工具都会启动编辑器但**不等它注册会话**，所以调用后等 10–30 秒，再用 `session_manage(op="list")` 确认新会话出现，然后 `session_activate` 选中它。不要用 Bash 手工拼 `project.godot`。

## 开工前先确认会话

编辑器可能同时开了多个项目，工具默认作用于「活动会话」。

1. `session_manage(op="list")` —— 看有哪些会话（`session_id`、`project_path`、`current_scene`、`readiness`）。
2. 多于一个，或不是目标项目：`session_activate(session_id="...")`。
3. 列表为空 → 先用 `godot_new_project` / `godot_open_project`；仍然没有就告诉用户用 Godot 打开项目并启用 Godot AI 插件。

## 标准工作流

1. **先读**：`editor_state`、`scene_get_hierarchy`、需要改的脚本用 `filesystem_manage(op="read_text")` 或 `script_manage` 读取。不要凭猜测改。
2. **小批量写**：一次只做一组相关变更（建节点 / 写脚本 / 连信号 / 调属性），写完立刻回读确认。
3. **落盘**：`scene_save`（或 `scene_manage(op="save_as", params={path})`）。节点和属性的修改只在编辑器内存里，不保存就丢。
4. **验证**：`project_run` → `logs_read(source="editor"|"game")` 看报错 → `project_manage(op="stop")`。有错先修，不要把带错的工程当完成。

## 常用工具

| 目的 | 工具 |
|---|---|
| 新建 / 打开场景 | `scene_manage(op="create"/"get_roots"/"save_as")`、`scene_open` |
| 场景树 | `scene_get_hierarchy`、`node_find` |
| 建节点 / 改属性 | `node_create`、`node_set_property`、`node_get_properties`、`node_manage` |
| 脚本 | `script_create`、`script_patch`、`script_attach` |
| 保存 | `scene_save` |
| 运行 / 停止 | `project_run(mode="main"/"current")`、`project_manage(op="stop")` |
| 日志 / 截图 | `logs_read`、`editor_screenshot` |
| 信号 / UI / 资源 | `signal_manage`、`ui_manage`、`resource_manage`、`theme_manage` |
| 设置主场景 | `project_manage(op="set_main_scene", params={path})` |
| 批量 | `batch_execute`（多个相关变更一次提交，减少往返） |

路径规则：场景与脚本用 `res://`；节点路径是相对场景根的，例如 `/Main/Player`，不是 `/root/Main/Player`。

## 写 GDScript 的硬要求

- Godot 4 语法：`@onready`、`@export`、`@tool`、`signal`、`await`、`func _ready() -> void`。
- 不要用 Godot 3 写法：`yield`、裸 `onready`、`export var`。
- 类型标注尽量写全，`script_create` 会做解析校验并返回 `diagnostics`；有诊断先修再继续。

## 交互与手感

做「玩家可以左右移动」这类需求时，除了脚本，还要记得：

- 节点结构（`CharacterBody2D` + `CollisionShape2D` + `Sprite2D`）；
- 输入映射（`input_map_manage`，默认模板里通常已有 `ui_left` / `ui_right`，可直接用）；
- 碰撞层与 `move_and_slide()`；
- 重生点、终点判定、胜利界面。

## 失败处理

- 工具报 `EDITED_SCENE_MISMATCH`：当前编辑的场景和预期不一致，先 `scene_manage(op="get_roots")` 确认。
- 运行后 `logs_read` 有 GDScript 报错：读报错行、改脚本、再跑一次；不要连续盲改。
- 编辑器无响应 / 会话消失：让用户检查 Godot 是否还开着，重新 `session_manage(op="list")`。
- 任何一步拿不到预期结果，**如实说明卡在哪**，不要编造成功。
