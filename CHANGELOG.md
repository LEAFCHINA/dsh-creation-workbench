# Changelog

First public release: **1.2.2**.

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
  `@local/dsh-image-workbench` while the package is now named
  `dsh-image-workbench`. DSH keys client plugins by package name, so the entry
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
