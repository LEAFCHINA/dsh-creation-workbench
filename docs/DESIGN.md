# Design notes — local ComfyUI workflow mode

This document records the data model and RPC contract of the ComfyUI backend, so
the client and host halves can evolve independently.

## Data model

Settings gain one field:

```
comfyBaseUrl: 'http://127.0.0.1:8188'   // '' = not configured
```

Workflows are stored separately from settings, in `<DATA_DIR>/workflows.json`:

```jsonc
{
  "version": 1,
  "workflows": [
    {
      "id": "wf_1a2b3c4d",
      "name": "SDXL text-to-image",
      "createdAt": "ISO",
      "updatedAt": "ISO",
      "json": { "3": { "class_type": "KSampler", "inputs": { } } },  // API-format workflow
      "params": [
        {
          "key": "p_1",
          "nodeId": "6",
          "inputName": "text",
          "label": "prompt",
          "type": "text",              // text | int | float | bool | select
          "options": [],
          "min": null, "max": null, "step": null,
          "default": "",
          "role": "prompt",            // prompt = receives the composer text
          "randomize": false           // numeric: new random value per run (seeds)
        }
      ]
    }
  ]
}
```

Limits: 50 workflows, 2 MB per workflow JSON, 60 params per workflow.

## RPC operations

| op | params | returns |
|---|---|---|
| `comfy.status` | `{}` | `{ ok, baseUrl, version?, devices?, error? }` |
| `comfy.workflow.list` | `{}` | `{ workflows: [{ id, name, paramCount, params, createdAt, updatedAt }] }` |
| `comfy.workflow.get` | `{ id }` | `{ workflow: { id, name, json, params, ... } }` |
| `comfy.workflow.inspect` | `{ json, baseUrl? }` | `{ nodes, outputs, suggestedParams, warnings }` |
| `comfy.workflow.save` | `{ id?, name, json?, params? }` | `{ workflow }` (no raw json) |
| `comfy.workflow.delete` | `{ id }` | `{ ok: true }` |

Errors use the existing `ApiError` shape: `{ ok:false, error, code }` with a
user-readable Chinese message.

## Execution

1. Resolve the workflow by id; validate and coerce `workflowParams` against the
   param specs (clamp numbers, validate select options, fill defaults).
2. Deep-copy the stored graph and write the values into `graph[nodeId].inputs`.
3. For every param with `role: "prompt"`, write the composer prompt text.
4. Randomize numeric params: by default when the spec has `randomize: true`, but
   the client may override it per generation through
   `params.workflowRandomize = { [paramKey]: boolean }`. Drawn values are
   collected and returned to the client (`job.get.randomValues`, plus
   `workflowId`) so the composer can display the number that was used.
5. `n`: if the workflow exposes `batch_size`, queue once with that value;
   otherwise queue `n` times. The client only offers a count selector when
   `batch_size` is exposed, and sends `n = 1` otherwise.
6. `POST /prompt` → poll `GET /history/<prompt_id>` (800 ms) → fetch every image
   in `outputs[*].images` through `GET /view?...` → return bytes.
7. Cancellation posts the prompt id to `POST /queue { delete: [...] }`.

ComfyUI is local, so these requests bypass the configured proxy. Polling,
`/prompt` and image downloads all honour the job's `AbortSignal`.

## Job visibility (v1.2.6)

- `job.get` additionally returns `stage` (`queued` / `running` / `done`),
  `queuePosition` (1-based position in ComfyUI's pending list, when known) and
  `queueRunning` / `queuePending` counts, written by a `/queue` probe during
  generation.
- `comfy.queue` returns the current `/queue` snapshot (never throws; `ok:false`
  on failure).
- `job.list` returns every non-terminal job across conversations (with
  `workspaceId`, `conversationId`, `displayName`, `prompt` preview), powering
  the toolbar task panel.

## Client behaviour

- The `comfy:<workflowId>` prefix in `params.model` is authoritative; a stale
  `params.workflowId` is ignored (and logged) instead of selecting an older
  workflow.
- Each workflow remembers its own composer state (`params.workflowCache`, keyed
  by workflow id). Switching workflows restores that workflow's values,
  randomize flags and 张数 instead of carrying the previous workflow's state
  across — param keys (`p_1`, `p_2`, …) are identical in every workflow.
- The saved `params` array order is the composer row order. The workflow editor
  exposes it as a drag-and-drop preview (with ↑↓ fallbacks) and saves the
  resulting order.

- Model value `comfy:<workflowId>`; the dialect resolver maps it to `comfyui`.
- ComfyUI dialect hides the API-only parameter selectors (size / aspect /
  resolution / quality) and shows a second, wrapping row of the exposed params.
- Parameters marked `role: prompt` are not rendered as controls — the composer
  textarea feeds them.
- If a workflow has no prompt binding, the composer shows a warning that opens
  the settings dialog; the workflow editor's `main prompt → node` selector
  makes the binding explicit.
