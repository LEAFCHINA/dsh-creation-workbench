# AI Creation Workbench · Usage Guide

[中文](USAGE.md) ｜ **English**

A step-by-step manual. Back to [README](../README.en.md).

---

## Contents

1. [Install and update](#1-install-and-update)
2. [First run: configure a backend](#2-first-run-configure-a-backend)
   - [2.1 Third-party image API](#21-third-party-image-api)
   - [2.2 Local ComfyUI](#22-local-comfyui)
3. [Generate your first image](#3-generate-your-first-image)
4. [Importing a ComfyUI workflow (in depth)](#4-importing-a-comfyui-workflow-in-depth)
5. [Workspaces, conversations and drafts](#5-workspaces-conversations-and-drafts)
6. [Prompt templates](#6-prompt-templates)
7. [✨ Agent templates](#7-agent-templates-in-detail)
8. [Jobs, queueing, cancel and retry](#8-jobs-queueing-cancel-and-retry)
9. [Images and files](#9-images-and-files)
10. [Settings reference](#10-settings-reference)
11. [FAQ and troubleshooting](#11-faq-and-troubleshooting)

---

## 1. Install and update

### Install

Paste any of these specs into the DSH plugin page:

```sh
# GitHub (recommended, newest)
dsh plugin --profile web add github:LEAFCHINA/dsh-creation-workbench

# npm (once published)
dsh plugin --profile web add dsh-creation-workbench
```

Or use **Plugins → Add plugin → Install** and paste the package name, the GitHub spec, or the absolute path of a `.tgz` release.

After installing, **AI 创作工作台** appears in the left sidebar. Refresh the page if it does not.

### Update

```sh
dsh plugin --profile web remove dsh-creation-workbench
dsh plugin --profile web add github:LEAFCHINA/dsh-creation-workbench
```

> Upgrading from 1.x (old package name `dsh-image-workbench`): run `remove dsh-image-workbench` first, then install the new package. On first start the old data directory is copied to the new one automatically.

### Verify

Open the plugin → the status dot next to 「设置」 at the bottom should read **已配置** (configured) or **已配置 ComfyUI**.

---

## 2. First run: configure a backend

Open the workbench → **⚙ 设置** (Settings) at the bottom of the sidebar.

You can configure **both** backends and switch between them in the composer at any time.

### 2.1 Third-party image API

| Field | Notes | Example |
| --- | --- | --- |
| **API 地址** | Base URL up to `/v1`, without `/images/generations` | `https://api.openai.com/v1` |
| **API Key** | Stored in plain text locally in `settings.json`; the UI only shows a mask | `sk-...` |
| **Model list** | Add manually or press "pull from upstream" | `gpt-image-2`, `grok-imagine-image-2.0` |
| **接口方言** (dialect) | Controls the request format; the wrong one causes parameter errors | `openai-images` / `xai-image` / auto |
| **默认参数** | Default model, image count, aspect ratio, size, resolution, quality | — |

**Proxy**: if your API needs one, fill in the proxy field (it only affects this plugin's requests). The 「扫描」 button probes common local proxy ports.

Press **保存** (Save). The status dot turning green means connectivity is fine (you can also press 「检测」 to verify first).

### 2.2 Local ComfyUI

Prerequisite: ComfyUI is running locally (default `http://127.0.0.1:8188`).

1. Settings → **ComfyUI** section → **服务地址**: `http://127.0.0.1:8188` (**no** `/v1`).
2. Press **检测** (Test) → a version string means it is reachable.
3. Continue with [Importing a ComfyUI workflow](#4-importing-a-comfyui-workflow-in-depth).

> ComfyUI requests are **always direct** and never use the configured proxy.

---

## 3. Generate your first image

1. In the **工作区** (Workspaces) tab press **＋** to create a workspace, or use 「默认工作区」.
2. Press **＋ 新会话** (new conversation), or press 「生成」 on the home screen.
3. The home screen shows a greeting and two buttons:
   - **编辑** (Edit) — starts an editing flow (pre-selects an "edit" workflow)
   - **生成** (Generate) — expands to 生成图片 / 生成视频 / 生成声音 / 生成模型

   Picking a category auto-selects the **most recently used workflow** of that category (falling back to an API model for images) and focuses the composer.

   You can also **skip the buttons** and just type a prompt — the current mode is used.
4. The control bar under the composer:
   - **Model dropdown**: API models + ComfyUI workflows grouped by category (`工作流 · 生图`, …)
   - **张数** (image count): only shown when the workflow exposes `batch_size`, or in API mode
   - **Aspect / size / resolution / quality**: API mode only
   - **Workflow parameter row**: exposed params wrap onto new lines; numeric ones carry a 「随机」 toggle
5. Type a prompt → **Enter to send** (`Shift+Enter` for a newline).
6. Progress is shown while generating; when it finishes the image appears on the canvas and is saved to the output directory.

---

## 4. Importing a ComfyUI workflow (in depth)

This is the core feature: **turn a ComfyUI workflow's node inputs into composer controls**.

### 4.1 Export the API format from ComfyUI

1. Build your workflow in the ComfyUI UI.
2. Top-right menu → **Save (API format)**.
   > A normal "Save" produces the UI format, which this plugin **deliberately rejects** — the two formats are structurally different.
3. You get a `.json` file.

### 4.2 Import it into the plugin

1. Settings → ComfyUI section → **导入工作流** (Import workflow) → choose the `.json`.
2. The plugin parses the nodes and opens the **parameter editor**.

### 4.3 Using the parameter editor

The editor has **two panes**:

```
┌──────────────────┬────────────────────────────────────┐
│ Node list        │  Node details: tick the inputs      │
│ (searchable)     │  label / type / range / default     │
└──────────────────┴────────────────────────────────────┘
```

**Left pane**: every node in the workflow with its class type, searchable. Nodes marked 「输出」 are output nodes.

**Right pane**: after selecting a node, every exposable input is listed. Per input:

| Setting | Meaning |
| --- | --- |
| Checkbox | Whether it appears in the composer |
| **名称** | Label shown in the composer (e.g. 「步数」) |
| **类型** | text / int / float / bool / select |
| **最小 / 最大 / 步长** | Numeric bounds |
| **选项** | Options for select types (auto-filled from ComfyUI metadata) |
| **默认值** | Initial value |
| **随机** | Randomize this value on every run (usually for seeds) |
| **角色** | 「主提示词」 marks the input that receives the composer text |

**Prompt binding**: exactly one input must be marked as 「主提示词」. The plugin suggests one automatically (an empty TextEncode / PrimitiveString node). If nothing is bound the composer shows a clickable warning that takes you back to the editor — **text is never silently dropped**.

**Parameter order**: below the toolbar there is a 「对话框参数顺序」 (composer parameter order) preview where the selected params appear as chips:
- drag a chip to reorder
- or use its **↑ ↓** buttons
- **✕** removes that parameter

The order defines how the params are laid out in the composer.

### 4.4 Category

The editor has a **分类** (category) dropdown:

- Presets: **编辑 / 生图 / 生视频 / 生音频 / 生模型**
- **自定义…** (custom): any name, e.g. 「3D 场景」

The plugin **suggests** a category from the output nodes:
- `SaveImage` → image
- `VHS_VideoCombine` / video output → video
- audio output nodes → audio
- 3D / mesh output → model
- `LoadImage` / inpaint / img2img chains → edit

The suggestion is only a default; you can always change it.

### 4.5 Save and use

1. Fill in the **工作流名称** (name), pick the **分类**, press **保存**.
2. Back in the composer, the workflow appears in the model dropdown under `工作流 · <category>`.
3. Selecting it shows the exposed params under the composer — adjustable, randomizable.
4. Type a prompt and send.

> **Editing an existing workflow**: press 「编辑」 on its row in Settings, adjust params/order/category, save. Previously saved selections are preserved exactly — nothing gets re-checked by accident.

### 4.6 Managing workflows

The **工作流** tab groups every workflow by category. Each card offers:

- **使用** (Use) — switch the composer to that workflow and return to the workspace
- **编辑参数** (Edit params) — open the editor in Settings
- **删除** (Delete) — with confirmation

---

## 5. Workspaces, conversations and drafts

### Structure

```
Workspace (many)
└── Conversation (many per workspace)
    └── Generation (turn) → images
```

- The **＋** at the top creates a workspace; the **+** on a workspace row creates a conversation; 「⋯」 renames/deletes.
- Each conversation shows a relative timestamp.

### Per-conversation memory (important)

Switching conversations saves and restores, **independently per conversation**:

- ✅ the **unsent prompt** in the composer
- ✅ the selected **model / workflow**
- ✅ all **parameter values** and **randomize flags**
- ✅ the **image count**

So conversation A can use workflow A while conversation B uses workflow B without any cross-talk, and it survives a page refresh (stored in browser localStorage).

### Empty-conversation home

A new conversation (or one with no generations yet) shows:

```
早上好~ 现在想干什么呀？
   [ ✎ 编辑 ]   [ ✦ 生成 ]
```

The greeting changes with the time of day (早上好 / 中午好 / 下午好 / 晚上好 / 夜深了).

---

## 6. Prompt templates

Useful for reusing long prompt skeletons.

### 6.1 Create a template

1. Sidebar → **模板** (Templates) tab → the editor appears in the main area.
2. Fill in:

| Field | Notes |
| --- | --- |
| **模板名称** | e.g. 「复古胶片人像」 |
| **分类** | Free text such as 人像 / 产品 / 海报 (used for filtering) |
| **模板类型** | Text template / ✨ Agent template |
| **绑定工作流分类** | Optional; marks which workflow category this suits |
| **模板内容** | The prompt body; supports `{{variables}}` |
| **变量默认值** | Every `{{name}}` in the body gets a default-value field |
| **预览** | Live preview of the rendered text |

3. Press **保存模板** (Save).

### 6.2 Use it in the composer (`@`)

1. Type **`@`** in the composer → the template panel opens.
2. Keep typing to **search** (name / category / content).
3. **↑ ↓** to move, **Enter** to insert, **Esc** or click outside to close.
4. Templates with variables first show a small form; fill the values and press 「插入」.
5. The text is inserted at the `@` position (cursor), and the usage counter increments.

### 6.3 Save as template

Two entry points, same result:

- the **「存为模板」** button in the composer control bar
- **「＋ 把当前输入存为模板」** at the bottom of the `@` panel

Both pre-fill the template editor with the current composer text — just name it and save.

---

## 7. Agent templates in detail

An Agent template is not fixed text — it **asks a model to produce the prompt**. Typical uses: expand a one-liner, reverse-engineer a prompt from an image, translate/polish, generate negative prompts.

### 7.1 Configure the agent model first

At the top of the Templates tab there is an **「Agent 模型（✨ 模板使用）」** panel with two sources:

#### Source A: Agent API (OpenAI-compatible)

| Field | Notes |
| --- | --- |
| **Agent API 地址** | Up to `/v1`; **leave empty to reuse the image API URL** |
| **Agent API Key** | Leave empty to reuse the image API key; shows a mask when set |
| **Agent 模型** | e.g. `gpt-4o-mini`, `qwen-plus` |

Best for: **image reverse-engineering** (multimodal) or using an external model.

#### Source B: DSH model (no API key)

1. Switch the source to **「DSH 模型（实验）」**.
2. Press **刷新 DSH 模型** (Refresh) → reads the host's providers/models.
3. Pick a **Provider**, then a **Model** (e.g. `DeepSeek` → `DeepSeek-V4.1-Flash`).
4. Press **保存 Agent 设置**.

Best for: no key management, reusing the models already configured in DSH.
Image reverse-engineering works, but **pick a model marked 「支持图片」** (e.g. `DeepSeek-V4.1-Flash`); a text-only model tells you to switch when it receives an image.

Press **测试连接** (Test connection) to see which model services the host exposes.

### 7.2 Create an agent template

New template → set **模板类型** to **「✨ Agent 模板」**, then configure:

| Field | Notes | Example |
| --- | --- | --- |
| **Agent System Prompt** | Model identity and rules | `你是资深 AI 视觉提示词工程师，只输出提示词正文…` |
| **Agent 用户模板** | How user input is embedded; `{{input}}` is the placeholder | `根据以下输入生成最终提示词：{{input}}` |
| **输入类型** | Text / image (multi-select) | tick 图片 for reverse-engineering |
| **输出格式** | Single prompt / prompt + negative | — |
| **模型覆盖** | Optional per-template model override | empty = global agent model |

Saved templates are marked with **✨** in the list.

### 7.3 Use an agent template

1. Type **`@`** in the composer → pick the ✨ template.
2. The composer border changes colour and the agent panel appears:

```
✨ 反推提示词                    ×
┌─────────────────────────────┐
│ Describe your idea…         │
└─────────────────────────────┘
[选择图片] or paste an image
[ Cancel ]            [ Generate prompt ]
```

3. Type text, or press 「选择图片」 / **Ctrl+V** to paste an image (only if the template allows image input).
4. Press **生成提示词** (generate).
5. The result appears in an **editable card**:
   - edit the text directly
   - **[重新生成]** runs it again
   - **[确认插入]** inserts it into the composer (and leaves agent mode)
6. You still have to **press send** yourself — there is a deliberate confirmation step.

### 7.4 Suggested starter templates

| Name | Input | System prompt gist |
| --- | --- | --- |
| Prompt expander | text | Expand one sentence into subject/composition/light/material/style/mood |
| Reverse prompt | image | Analyse composition, light, colour, lens; output a ready-to-use prompt |
| Negative prompt | text | Output common defect negatives, comma separated |
| English polish | text | Translate a Chinese prompt into natural English, preserving meaning |

---

## 8. Jobs, queueing, cancel and retry

### Inside one conversation

- Running cards show **排队中 / 排队第 N 位 / 生成中 · xx%**
- The ⏹ button on a card cancels it
- Group headers also have a 「取消」 button
- Failed cards offer **重试** (retry) and **删除** (delete)

### Cross-session task panel

The **「任务」** button in the top bar (shows a count and highlights when busy):

- lists running/queued jobs from **all conversations**
- each row shows: workflow name, workspace › conversation, prompt preview, progress bar, current stage (queue position / elapsed seconds)
- jobs can be cancelled right there

> The data comes from the host process, so it **survives a page refresh**.

### Timing rules

- **Queued** jobs are not timed; they only show the queue position
- **Running** jobs are timed from the moment they actually start, independently
- Local ComfyUI jobs have **no overall timeout** (the first run may load a model for minutes); they show 「已用 Ns」

---

## 9. Images and files

### Where images go

Settings → **素材保存目录** (output directory), default `%USERPROFILE%\Pictures\dsh output`.

On-disk layout:

```
output dir/
└── workspace name/
    └── conversation name/
        └── <image id>.png
```

### Image actions

Click an image on the canvas → detail overlay:

- see prompt, model/workflow, parameters, seed, size, elapsed time
- **保存副本** (save a copy elsewhere)
- **打开目录**, **复制路径**
- **用作参考图** (use as reference image — API mode)
- **局部重绘** (inpaint — API mode; not supported in ComfyUI mode, you get a message)
- **删除**

Hovering a card also exposes quick actions.

---

## 10. Settings reference

| Setting | Where | Notes |
| --- | --- | --- |
| API URL / key | Settings → API | Third-party image service |
| Model list / dialect | Settings → API | Models and request format |
| Default params | Settings → API | Initial values for new conversations |
| Generation timeout (s) | Settings → API | **Third-party API only**; local ComfyUI is exempt |
| Proxy URL | Settings → Proxy | Affects this plugin's requests only |
| ComfyUI address | Settings → ComfyUI | `http://127.0.0.1:8188` |
| Workflow list | Settings → ComfyUI | Import / edit / delete |
| Output directory | Settings → Files | Where images are saved |
| Save-as directory | Settings → Files | Default target for "save a copy" |
| Model costs | Cost dashboard | Per-model/per-tier estimates |
| Agent model | Templates tab (top) | API or DSH model |
| Agent API key | Templates tab (top) | Write-only, masked echo |

---

## 11. FAQ and troubleshooting

### The plugin is missing from the sidebar / the page is blank

1. Make sure it is installed and enabled — `dsh-creation-workbench` should be listed on the plugins page.
2. Refresh the page (`Ctrl+R`).
3. Check the logs: `%USERPROFILE%\.dsh\dsh-creation-workbench\logs\client.log` and `host.log`.
4. If the log says `duplicate factory registration`, the client module id does not match the package name — reinstall the latest version.

### `生成超时（300 秒）`

Only **third-party API jobs** are subject to that timeout. If ComfyUI jobs still report it, the version is old — upgrade to 2.1.0+ (local jobs no longer have an overall timeout).

If API jobs are genuinely slow: Settings → generation timeout, increase it (max 600 s).

### ComfyUI test fails

- Confirm ComfyUI is running: open `http://127.0.0.1:8188` in a browser.
- The address must **not** include `/v1` or a trailing slash.
- The plugin **does not use the proxy**; if a system proxy intercepts localhost, add `127.0.0.1` to the direct/bypass list.

### "UI format" error on import

You exported the wrong format. Re-export from ComfyUI with **Save (API format)**.

### The workflow imports but the prompt is not applied

Check the **「主提示词」** binding in the editor. When nothing is bound the composer shows a warning button — click it and pick a text input as the main prompt.

### Results don't match the expected steps/size/seed

- Check that the parameter is ticked and the workflow saved.
- Different workflows use the same param keys (`p_1`, `p_2`, …) but values are stored **per conversation and per workflow**, so they do not leak.
- Randomized params show the value actually used after each run.

### The workflow changes when I switch conversations

Fixed in 2.1.0+ (per-conversation isolation). If it still happens, check that you are on 2.1.0 or newer.

### `@` does not open the template panel

- The `@` must be typed at the start of the input or after whitespace.
- If the template library is empty the panel tells you to create one in the Templates tab.
- `Esc` closes the panel.

### "No DSH model service available"

- Only **DSH Desktop** exposes the host model service.
- Make sure at least one model is configured and usable in DSH.
- Or switch the agent source back to **Agent API**.

### Agent image reverse-engineering not available

Read the error message:

- **"current DSH model does not accept image input"** → pick a DSH model marked **「支持图片」** (e.g. `DeepSeek-V4.1-Flash`), or switch the source to **Agent API** with a vision model (`gpt-4o-mini`, `qwen-vl-plus`, …).
- **"image could not be sent to the DSH model"** → the file is too large or unsupported; use a PNG / JPEG / WebP under 6 MB.
- **"no DSH model service available"** → only DSH Desktop exposes host models; otherwise switch back to Agent API.

### Duplicate/missing image files

Images are stored as `workspace/conversation/image-id`. Renaming a workspace or conversation affects only **new** images; old records keep absolute paths, so old images still open.

### Data migration (1.x → 2.x)

The first start writes a `.migrated-from-image-workbench` marker in the new directory. The old directory `%USERPROFILE%\.dsh\dsh-image-workbench` is **kept** (its absolute image paths are still referenced by old conversations). Once the new version is confirmed working, back it up and delete it if you like.

---

## Feedback

- Issues and suggestions: <https://github.com/LEAFCHINA/dsh-creation-workbench/issues>
- Version history: [CHANGELOG](../CHANGELOG.md)
