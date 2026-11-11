# Changelog

First public release: **1.2.2**.

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
