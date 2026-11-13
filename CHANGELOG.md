# Changelog

First public release: **1.2.2**.

## 2.3.5

- **Fix: 「DSH 模型返回了空结果」on real photos.** Reasoning-capable models can
  spend the whole output budget on reasoning and emit no text. The DSH channel now
  asks for the smallest reasoning effort the model advertises, starts with a
  4096-token budget and automatically retries once with 8192 when the first answer
  is empty or truncated. Empty results now explain the cause (reasoning-only /
  budget exhausted) instead of a bare “请重试”.
- Each DSH agent call writes one `agent dsh …` line to `logs/host.log`
  (model, latency, finish reason, chars, reasoning chars, available efforts) for
  future diagnosis.


## 2.3.4

- **Fix: DSH agent calls failed on providers that require session affinity**
  (`opencode-go` returned `MissingSessionID` / `x-opencode-session`). The DSH
  channel now passes a stable pseudo `sessionId` with each call, which those
  providers use for routing.


## 2.3.3

- **Fix: image reverse-engineering did not work with the DSH model channel.** The
  DSH channel rejected every image with “text only”, even though most DSH models
  are vision-capable. Images are now stored through the host attachment service
  (`ctx.get('attachments').admitPromptContent`) and sent as a real `image`
  content block, so 「反推提示词」 works with DSH models — no API key needed.
- **Clearer model capability reporting**: the DSH model picker marks
  vision-capable models with 「支持图片」 and explains why an image was refused,
  suggesting a vision model on the same provider.
- **Fix: a template's 附加上下文 (content) was never sent to the agent.** Agent
  templates use the content as extra rules/reference material appended to the
  system prompt (labelled 「附加上下文 / 规则（会一起发给 Agent）」 in the editor).
- New error codes: `AGENT_MODEL_TEXT_ONLY`, `AGENT_ATTACHMENT_UNAVAILABLE`,
  `AGENT_IMAGE_REJECTED`.


## 2.3.2 — bilingual documentation

- **Bilingual docs**: `README.md` is now the Chinese README and `README.en.md` the
  English one, with a language switcher at the top of both.
- **New step-by-step usage guides**: `docs/USAGE.md` (中文) and
  `docs/USAGE.en.md` (English) cover installation, both backends, the ComfyUI
  workflow parameter editor, workspaces/drafts, prompt templates, ✨ agent
  templates (API + DSH channels), the task panel, files, a full settings
  reference and a troubleshooting FAQ.
- Docs are now shipped in the npm package (`files` includes `README.en.md` and `docs`).


## 2.3.1

- **DSH host model channel for ✨ Agent templates**: choose 「DSH 模型」 as the
  agent source, pick a provider/model (loaded live from the host via
  `ctx.llm.listModels()`), and generate prompt text without configuring an API
  key. The call uses DSH's `prepareCall` → `stream` protocol with a 180 s
  timeout; text input only (image reverse-engineering still needs the Agent API).
- New RPC `agent.models` returns the DSH providers/models for the settings UI.
- Agent settings now remember `agentDshProvider` / `agentDshModel`.


## 2.3.0 — ✨ Agent templates

- **Agent templates**: a template can now be a ✨ Agent template with its own
  system prompt, user template (`{{input}}`), allowed input types
  (文字 / 图片) and output format (单一提示词 / 提示词+负面词). Content is optional.
- **Composer agent mode**: typing `@` and picking an agent template switches the
  composer into agent mode (colored border + panel). Type an idea and/or paste
  or attach an image (反推提示词) → 「生成提示词」→ the result appears in an
  editable card → 「确认插入」 puts it into the composer.
- **Agent model settings** in the 模板 tab: OpenAI-compatible base URL / key /
  model (falls back to the image API settings), plus a 「测试连接」 probe that
  reports whether the DSH host exposes a model service. DSH-model channel is
  detected but not yet adapted (use the Agent API for now).
- Host RPCs: `agent.run`, `agent.probe`; template records gain `kind`/`agent`.


## 2.2.1

- **Fix: activity tabs did nothing** — the workbench did not pass
  `onSelectTab`/`activeTab` down to the sidebar, so clicking 资产库/模板/工作流 was a
  no-op. The props are wired now.
- **Tab bar redesign** — 2×2 grid with nowrap labels (no more vertical
  "工作 区" wrapping), compact rounded buttons with a clear active state.


## 2.2.0 — prompt templates

- **New 模板 tab**: create / edit / delete reusable prompt templates with a
  category, optional workflow-category binding, automatic `{{变量}}` detection
  (with per-variable defaults) and a live preview. Templates are stored in
  `<DATA_DIR>/templates.json`.
- **`@` picker in the composer**: typing `@` opens a searchable template menu
  (↑↓/Enter/Esc). Templates with variables open a small fill-in form before the
  rendered text is inserted; usage counts are tracked. `@` replaces the old
  reference-image hint; reference images are still added via the + button / paste.
- **存为模板**: save the current composer text as a template in one click (also
  available from the @ menu).
- **Home centering fix** — the workspace greeting/intent picker now renders
  centered at full width.
- 资产库 tab remains a placeholder (v2.4).


## 2.1.0 — activity tabs, workspace home, workflow categories

- **Activity tabs**: the sidebar now has 工作区 / 资产库 / 模板 / 工作流 tabs, and
  the main area follows the active tab (工作区 canvas keeps its state while other
  tabs are open).
- **Workspace home**: an empty conversation shows a time-aware greeting with
  「编辑 / 生成」; 生成 expands into 生成图片 / 视频 / 声音 / 模型, picks the newest
  workflow of that category (or the first API model for 图片) and focuses the
  composer. Direct typing still works as before.
- **Workflow categories**: workflows carry a `category` (编辑 / 生图 / 生视频 /
  生音频 / 生模型 or a custom name). The workflow editor has a category selector
  (with a suggested category inferred from output nodes), the composer dropdown
  is grouped by category, and the new 工作流 tab lists workflows grouped by
  category with use / edit / delete actions.
- 资产库 and 模板 tabs are placeholders in this version (v2.2 / v2.4).


## 2.0.0 — rename to AI 创作工作台 / dsh-creation-workbench

The plugin is now positioned as a personal **creation** workbench (image generation
today; image editing and video generation next), so package, repository, client
module id, API prefix and display name were renamed together:

- package / GitHub / npm: `dsh-image-workbench` → **`dsh-creation-workbench`**
- display name: 「AI 生图工作台」 → **「AI 创作工作台」**
- client module id + host API prefix: `dsh-image-workbench` → `dsh-creation-workbench`
- plugin row id in `cordis.patch.yml`: `image-workbench` → `creation-workbench`
- **data migration**: on first start the old data directory
  (`~/.dsh/dsh-image-workbench`) is copied to `~/.dsh/dsh-creation-workbench`;
  the legacy directory is kept, so old absolute image paths keep resolving.
  Composer drafts / per-conversation params read the old localStorage key once
  and are then written under the new one.
- Old GitHub URLs redirect automatically; the npm package name is new (2.0.0),
  so existing 1.2.x installs must be removed and reinstalled.
- Tests moved into the repository (`test/`) and now run in CI (`npm test`).


## 1.2.7

- **Local ComfyUI jobs no longer hit the 300 s generation timeout.** A first run
  that loads a different UNet/LoRA can take minutes; local workflow jobs now run
  without an overall timeout (cancel them from the canvas or the task panel).
  Third-party API jobs keep the configurable timeout.
- **Composer state is per conversation**, not just the prompt: model / workflow,
  exposed params, randomize flags and 张数 are saved and restored when switching
  conversations, so workflow B can no longer leak into workflow A's chat.
- **Per-task timers.** A task waiting behind another shows “排队中” (queue
  position) instead of counting up from enqueue; running tasks count from their
  own start time, and the task panel shows each running task's elapsed time.
- Local ComfyUI runs no longer display a “300 s 超时” cap in the elapsed label.

## 1.2.6

- **Queue-aware progress for ComfyUI runs.** The host now probes ComfyUI's
  `/queue` while a prompt is pending and exposes `stage` / `queuePosition` on
  `job.get`; the composer shows “排队第 N 位 / 执行中 xx%” instead of an opaque
  spinner.
- **Cross-session task panel.** A new toolbar entry (「任务」) lists every
  running/queued job across all conversations, with workflow name, conversation,
  progress and a cancel button. Backed by the new host `job.list` RPC, so it
  survives page reloads.
- **New RPCs:** `comfy.queue` (live queue snapshot) and `job.list` (active jobs).
- **Per-conversation composer drafts.** Switching conversations now saves the
  current input and restores the target conversation's draft (persisted in
  localStorage), so text can no longer be sent into the wrong conversation.
- ComfyUI mode no longer advertises reference-image affordances: the “+”
  button is disabled and the placeholder no longer mentions “@ 添加参考图”.

## 1.2.5

- **Fix: switching between ComfyUI workflows could run the wrong workflow.** The
  host preferred a `params.workflowId` value over the `comfy:<id>` model prefix,
  so a stale id from a previous selection silently asked ComfyUI for the old
  workflow. The model prefix is now authoritative (the stale value is logged
  and ignored).
- **Fix: per-workflow composer state leaked across workflows.** Param keys are
  `p_1`, `p_2`, … in every workflow, so switching from workflow A to B carried
  A's values, randomize flags and 张数 into B. Each workflow now remembers its
  own state (`params.workflowCache`) and switching restores it; a workflow
  without `batch_size` always sends `n = 1`.
- **New: parameter order preview with drag-and-drop** in the workflow editor.
  Selected params appear as chips in their composer order; drag them (or use
  ↑↓) to reorder, ✕ to uncheck. The saved order is the order the composer uses.

## 1.2.4

- Composer: the **张数** selector is now tied to the workflow's exposed
  `batch_size` input. A workflow without it runs exactly one prompt per send
  and the selector is hidden (one run = one image), instead of appearing to
  offer a count that had no workflow parameter behind it.
- Numeric workflow params now have a **随机** checkbox right beside the number
  in the composer param row, so a seed can be randomized per generation without
  opening the workflow editor. The host honours the per-generation override
  (`workflowRandomize`), reports the values actually drawn
  (`job.get.randomValues`), and the composer updates the displayed number after
  each completed run.

## 1.2.3

- Fix: the client bundle registered itself under the old module id
  `@local/dsh-creation-workbench` while the package is now named
  `dsh-creation-workbench`. DSH keys client plugins by package name, so the entry
  could not activate at boot and the bundle was executed twice
  (`client-modules: duplicate factory registration`), which aborted the web boot.
  The module id now matches the package name.
- `npm run check` now fails when the client bundle id and the package name
  differ, so a rename cannot silently reintroduce the boot failure.
  (For the same reason, install `v1.2.3` or later from git — not the `1.2.2`
  commit before this fix.)

## 1.2.2

- Fix: re-editing a saved workflow no longer re-ticks suggested parameters that were explicitly unchecked in an earlier edit round.
- Prompt binding is now an explicit single-choice: the workflow editor has a **main prompt → node** selector. Saving forces the bound text input to `role: prompt` and includes it in the saved params.
- Host `inspect` suggests an **empty** `PrimitiveString*` / `Text*` input as the prompt candidate, so workflows that keep the prompt in a primitive string (e.g. MiniMax H3) bind automatically.
- The composer shows a clickable warning when the selected workflow has no prompt binding.
- Sidebar status shows `已配置 ComfyUI` when only local workflows are configured.

## 1.2.1

- Fix: the parameter editor compressed every node card to near-zero height (flex + `overflow:hidden`), which made the editor look like overlapping rows and unusable.
- The editor is now a two-pane picker: node list on the left (search, natural node ordering, selected counts, output-node badges), inputs of the selected node on the right.
- Added **select suggested params** and **clear selection** actions.

## 1.2.0

- New local **ComfyUI workflow** backend: server address + connectivity test, API-format JSON import, parameter exposure, workflow selection in the composer, dynamic parameter row that wraps, `/prompt → /history → /view` execution, images saved through the existing image-directory setting.
- Local ComfyUI requests bypass the proxy; failures are reported with readable messages.
- The existing third-party API backend is unchanged.
