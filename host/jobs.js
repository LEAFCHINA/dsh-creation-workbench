/**
 * Generation job manager (CONTRACT.md §5.6).
 *
 * Jobs are memory-only and live on globalThis.__dshImageWorkbench.jobs so a
 * hot-reloaded host module keeps running generations alive. Upstream calls are
 * aborted on cancel/timeout; every terminal state is written back into the
 * conversation JSON (turn status/images/error/finishedAt).
 */

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const store = await import(`./store.js?rev=${encodeURIComponent(REV)}`)
const provider = await import(`./provider.js?rev=${encodeURIComponent(REV)}`)
const costs = await import(`./costs.js?rev=${encodeURIComponent(REV)}`)

const {
  ApiError,
  nowIso,
  truncate,
  isPlainObject,
  normalizeJobTimeoutMs,
  JOB_TIMEOUT_DEFAULT_MS,
  JOB_TIMEOUT_GRACE_MS,
  CANCEL_GRACE_MS,
} = util

/** Default per-job timeout; the effective value comes from settings.jobTimeoutMs. */
export const JOB_TIMEOUT_MS = JOB_TIMEOUT_DEFAULT_MS
export const MAX_CONCURRENCY = 2
/** Stale-running-job sweeper (CONTRACT 补丁 v1.1 §5). */
export const WATCHDOG_INTERVAL_MS = 15000

const STATE = store.STATE
const TERMINAL = new Set(['done', 'error', 'cancelled'])

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

function runningCount() {
  let count = 0
  for (const job of STATE.jobs.values()) {
    if (job.status === 'running') count += 1
  }
  return count
}

function queuedJobs() {
  const list = []
  for (const job of STATE.jobs.values()) {
    if (job.status === 'queued' && !job.started && !job.cancelRequested) list.push(job)
  }
  list.sort((a, b) => (a.seq || 0) - (b.seq || 0))
  return list
}

/** Keep the in-memory job table bounded (terminal jobs are only for polling). */
function pruneJobs() {
  if (STATE.jobs.size <= 300) return
  const removable = []
  for (const job of STATE.jobs.values()) {
    if (TERMINAL.has(job.status)) removable.push(job)
  }
  removable.sort((a, b) => String(a.finishedAt || a.createdAt || '').localeCompare(String(b.finishedAt || b.createdAt || '')))
  while (STATE.jobs.size > 240 && removable.length > 0) {
    const job = removable.shift()
    STATE.jobs.delete(job.jobId)
  }
}

function kick() {
  while (runningCount() < MAX_CONCURRENCY) {
    const next = queuedJobs()[0]
    if (!next) return
    next.started = true
    next.status = 'running'
    next.startedAt = nowIso()
    next.progress = Math.max(next.progress || 0, 0.05)
    void runJob(next)
  }
}

/* ------------------------------------------------------------------ */
/* Public views / control                                              */
/* ------------------------------------------------------------------ */

function jobView(job) {
  const view = {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    turnId: job.turnId,
  }
  // v1.2.4: expose the ComfyUI values drawn for randomized params so the
  // composer can show the new number once the turn completes.
  if (isPlainObject(job.params)) {
    if (typeof job.params.workflowId === 'string' && job.params.workflowId) {
      view.workflowId = job.params.workflowId
    }
    view.model = String(job.params.model || '')
    view.displayName = String(job.params.displayName || '')
    if (
      isPlainObject(job.params.workflowRandomValues) &&
      Object.keys(job.params.workflowRandomValues).length > 0
    ) {
      view.randomValues = { ...job.params.workflowRandomValues }
    }
  }
  // v1.2.6: ComfyUI queue position / stage for the progress line + task panel.
  if (isPlainObject(job.queue)) {
    if (typeof job.queue.state === 'string' && job.queue.state) view.stage = job.queue.state
    if (typeof job.queue.position === 'number' && job.queue.position > 0) {
      view.queuePosition = job.queue.position
    }
    view.queueRunning = Number(job.queue.runningCount) || 0
    view.queuePending = Number(job.queue.pendingCount) || 0
  } else if (job.status === 'queued') {
    view.stage = 'queued'
  }
  // v1.2.7: per-task start time so the UI counts from when THIS task actually
  // began executing instead of timing every queued task from enqueue.
  view.startedAt = job.startedAt || null
  // v2.5: timing breakdown (queue wait / provider run / provider detail).
  if (isPlainObject(job.timing)) view.timing = { ...job.timing }
  if (job.error) {
    view.error = job.error
    if (job.errorCode) view.code = job.errorCode
  }
  return view
}

export function getJobView(jobId) {
  if (typeof jobId !== 'string' || jobId.length === 0) {
    throw new ApiError('任务 ID 无效', 'INVALID_REQUEST', 400)
  }
  const job = STATE.jobs.get(jobId)
  if (!job) throw new ApiError('任务不存在或已结束，请刷新会话', 'INVALID_REQUEST', 404)
  return jobView(job)
}

export function cancelJob(jobId) {
  if (typeof jobId !== 'string' || jobId.length === 0) {
    throw new ApiError('任务 ID 无效', 'INVALID_REQUEST', 400)
  }
  const job = STATE.jobs.get(jobId)
  if (!job) throw new ApiError('任务不存在或已结束，请刷新会话', 'INVALID_REQUEST', 404)
  if (TERMINAL.has(job.status)) return { ok: true }
  job.cancelRequested = true
  if (job.status === 'queued') {
    // Never started: finalize right away, no upstream call to abort.
    void finalizeCancelled(job)
  } else {
    try {
      job.controller.abort()
    } catch {
      // ignore
    }
    // CONTRACT 补丁 v1.1 §5: if the upstream ignores the abort (stalled body),
    // force-finalize as cancelled after a 5s grace period.
    if (!job.cancelGraceTimer) {
      job.cancelGraceTimer = setTimeout(() => {
        job.cancelGraceTimer = null
        if (!job.finalized) void finalizeCancelled(job)
      }, CANCEL_GRACE_MS)
      try {
        job.cancelGraceTimer.unref?.()
      } catch {
        // ignore
      }
    }
  }
  return { ok: true }
}

/**
 * v1.2.6: active jobs across ALL conversations, for the cross-session task
 * panel. Terminal jobs are omitted — the conversation itself is their record.
 */
export function listJobs() {
  const items = []
  for (const job of STATE.jobs.values()) {
    if (TERMINAL.has(job.status)) continue
    const view = jobView(job)
    view.workspaceId = job.workspaceId
    view.conversationId = job.conversationId
    view.createdAt = job.createdAt
    view.prompt = truncate(String(job.prompt || ''), 80)
    items.push(view)
  }
  items.sort((left, right) => {
    const a = Date.parse(String(left.createdAt || ''))
    const b = Date.parse(String(right.createdAt || ''))
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b
    return String(left.jobId).localeCompare(String(right.jobId))
  })
  return {
    jobs: items,
    running: items.filter((item) => item.status === 'running').length,
    queued: items.filter((item) => item.status === 'queued').length,
  }
}

/** Allocate a job id up-front so `generate` can persist turn.jobId before responding. */
export function newJobId() {
  let jobId = util.newId('job')
  while (STATE.jobs.has(jobId)) jobId = util.newId('job')
  return jobId
}

/**
 * CONTRACT 补丁 v1.1 §5: stop a turn by id. In-memory job → cancel it; an
 * orphan running turn (previous process / lost job) → reconcile to cancelled.
 */
export async function abortTurn({ workspaceId, conversationId, turnId }) {
  if (!util.isId(workspaceId, 'ws')) throw new ApiError('工作区 ID 无效', 'INVALID_REQUEST', 400)
  if (!util.isId(conversationId, 'conv')) throw new ApiError('会话 ID 无效', 'INVALID_REQUEST', 400)
  if (!util.isId(turnId, 'turn')) throw new ApiError('生成任务 ID 无效', 'INVALID_REQUEST', 400)
  let target = null
  for (const job of STATE.jobs.values()) {
    if (job.turnId === turnId && job.conversationId === conversationId) {
      target = job
      break
    }
  }
  if (target && !TERMINAL.has(target.status)) {
    cancelJob(target.jobId)
    return { ok: true, cancelled: true, reconciled: false }
  }
  // Orphan path: no live job owns this turn (old process / restarted plugin).
  const conv = await store.getConversation(workspaceId, conversationId)
  const turn = (conv.turns || []).find((item) => item && item.id === turnId)
  if (!turn) throw new ApiError('该会话中不存在此生成任务（可能已被删除）', 'INVALID_REQUEST', 404)
  if (turn.status !== 'running') return { ok: true, cancelled: false, reconciled: false }
  const finishedAt = nowIso()
  await store.finalizeTurn(workspaceId, conversationId, turnId, {
    status: 'cancelled',
    error: '已中断生成',
    images: [],
    finishedAt,
  })
  try {
    void store.logHost(`turn.abort orphan reconciled ${conversationId}/${turnId} -> cancelled`).catch(() => {})
  } catch {
    // ignore
  }
  return { ok: true, cancelled: false, reconciled: true }
}

/**
 * Create a queued job for an already-persisted running turn. Returns jobId.
 * `jobId` is pre-allocated by `generate` so turn.jobId is persisted before the
 * response (CONTRACT 补丁 v1.1 §5).
 */
export function enqueueGeneration({ workspaceId, conversationId, turn, params, prompt, refsMeta, jobId: providedJobId, maskId }) {
  let jobId = typeof providedJobId === 'string' && providedJobId ? providedJobId : newJobId()
  while (STATE.jobs.has(jobId)) jobId = newJobId()
  const job = {
    jobId,
    workspaceId,
    conversationId,
    turnId: turn.id,
    params,
    prompt,
    refsMeta: Array.isArray(refsMeta) ? refsMeta : [],
    maskId: typeof maskId === 'string' && maskId ? maskId : '',
    status: 'queued',
    progress: 0,
    error: null,
    errorCode: null,
    // v1.2.6: live ComfyUI queue state ({state,'queued'|'running'|'done',
    // position, runningCount, pendingCount}) written by the generation probe.
    queue: null,
    seq: ++STATE.seq,
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    timeoutMs: JOB_TIMEOUT_DEFAULT_MS,
    controller: new AbortController(),
    cancelRequested: false,
    cancelGraceTimer: null,
    timedOut: false,
    started: false,
    finalized: false,
  }
  STATE.jobs.set(jobId, job)
  pruneJobs()
  kick()
  return jobId
}

/* ------------------------------------------------------------------ */
/* Finalization                                                        */
/* ------------------------------------------------------------------ */

/**
 * Terminal-state ordering (CONTRACT §5.6 + client polling contract):
 *   1. claim the job synchronously (prevents double finalize from the
 *      cancel + runner race),
 *   2. persist the turn's terminal state into the conversation JSON,
 *   3. only THEN publish the terminal job status observed by `job.get`.
 * A client that reacts to a terminal `job.get` by immediately calling
 * `conversation.get` therefore always reads the already-finalized turn
 * (previously done/error/cancelled could be observed while the turn was
 * still 'running'). The same ordering holds for cancellation.
 */
function clearJobTimers(job) {
  if (job.cancelGraceTimer) {
    try {
      clearTimeout(job.cancelGraceTimer)
    } catch {
      // ignore
    }
    job.cancelGraceTimer = null
  }
}

function claimFinalize(job) {
  if (job.finalized) return false
  job.finalized = true
  clearJobTimers(job)
  return true
}

function publishFinalize(job, { status, error = null, code = null, finishedAt, progress }) {
  job.status = status
  job.error = error
  job.errorCode = code
  job.finishedAt = finishedAt
  if (typeof progress === 'number') job.progress = progress
}

async function patchTurn(job, patch) {
  try {
    await store.finalizeTurn(job.workspaceId, job.conversationId, job.turnId, patch)
  } catch (error) {
    // The conversation may have been deleted while the job was running.
    try {
      await store.logHost(`job ${job.jobId}: cannot persist turn ${job.turnId}: ${String(error?.message || error)}`)
    } catch {
      // ignore
    }
  }
}

function imageDimsOf(images) {
  const first = Array.isArray(images) ? images.find((image) => image && Number(image.w) > 0 && Number(image.h) > 0) : null
  return first ? { w: Number(first.w), h: Number(first.h) } : null
}

/** CONTRACT 补丁 v1.4 §A4 / v1.8 §3: append the cost ledger row before publishing terminal state. */
async function recordJobCost(job, status, imageCount, imageDims) {
  try {
    await costs.recordJobTerminal({
      model: job.params?.model || '',
      dialect: job.dialect || '',
      status,
      n: job.params?.n || 0,
      images: imageCount,
      params: job.params,
      imageDims,
      workspaceId: job.workspaceId,
      conversationId: job.conversationId,
      turnId: job.turnId,
    })
  } catch {
    // Ledger must never block a job's terminal state.
  }
}

async function finalizeDone(job, images, dialect) {
  if (!claimFinalize(job)) return
  const finishedAt = nowIso()
  job.dialect = dialect || job.dialect || null
  await patchTurn(job, { status: 'done', error: null, images, finishedAt })
  await recordJobCost(job, 'done', Array.isArray(images) ? images.length : 0, imageDimsOf(images))
  publishFinalize(job, { status: 'done', error: null, code: null, finishedAt, progress: 1 })
}

async function finalizeError(job, error) {
  if (!claimFinalize(job)) return
  let message
  let code = 'PROVIDER'
  if (error && error.name === 'ApiError' && typeof error.code === 'string') {
    message = String(error.message || error)
    code = error.code
  } else if (error && error.name === 'AbortError') {
    message = '生成被中断，请重试'
    code = 'TIMEOUT'
  } else {
    message = `生成失败：${truncate(String(error?.message || error || '未知错误'), 200)}`
    code = 'PROVIDER'
  }
  const finishedAt = nowIso()
  await patchTurn(job, { status: 'error', error: message, images: [], finishedAt })
  await recordJobCost(job, 'error', 0)
  publishFinalize(job, { status: 'error', error: message, code, finishedAt })
}

function jobTimeoutSeconds(job) {
  return Math.max(1, Math.round(normalizeJobTimeoutMs(job && job.timeoutMs) / 1000))
}

async function finalizeTimeout(job) {
  if (!claimFinalize(job)) return
  // CONTRACT 补丁 v1.1: the message must reflect the ACTUAL configured seconds
  // (settings.jobTimeoutMs), never a hardcoded default.
  const message = `生成超时（${jobTimeoutSeconds(job)} 秒），可调大设置中的生成超时后重试`
  const finishedAt = nowIso()
  await patchTurn(job, { status: 'error', error: message, images: [], finishedAt })
  await recordJobCost(job, 'error', 0)
  publishFinalize(job, { status: 'error', error: message, code: 'TIMEOUT', finishedAt })
}

async function finalizeCancelled(job) {
  if (!claimFinalize(job)) return
  const message = '已取消生成（如等待过久，可调大设置中的生成超时）'
  const finishedAt = nowIso()
  await patchTurn(job, { status: 'cancelled', error: message, images: [], finishedAt })
  await recordJobCost(job, 'cancelled', 0)
  publishFinalize(job, { status: 'cancelled', error: message, code: null, finishedAt })
}

/* ------------------------------------------------------------------ */
/* Job runner                                                          */
/* ------------------------------------------------------------------ */

async function saveResultImages(job, generatedImages) {
  const total = generatedImages.length
  const images = []
  for (let index = 0; index < total; index += 1) {
    if (job.cancelRequested || job.timedOut) break
    const item = generatedImages[index]
    const imageId = await store.newImageId()
    const ext = util.extForMime(item.mime)
    // CONTRACT 补丁 v1.2 §2.5: readable file names prefer displayName
    // (ComfyUI workflow name) over the raw model id.
    const nameSource = String(job.params.displayName || job.params.model || 'image')
    const modelPart = nameSource
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || 'image'
    const name = `${modelPart}-${index + 1}.${ext}`
    const saved = await store.saveGeneratedImage(job.workspaceId, job.conversationId, imageId, item.bytes, {
      name,
      mime: item.mime,
      w: item.w,
      h: item.h,
    })
    images.push({
      id: imageId,
      turnId: job.turnId,
      url: store.fileUrl(imageId),
      localPath: saved.file,
      name,
      mime: item.mime,
      w: item.w,
      h: item.h,
      bytes: item.bytes.length,
      createdAt: nowIso(),
      prompt: job.prompt,
      model: job.params.model,
      params: job.params,
      refs: job.refsMeta,
    })
    job.progress = Math.min(0.95, 0.5 + 0.45 * ((index + 1) / Math.max(1, total)))
  }
  return images
}

async function discardImages(images) {
  for (const image of images) {
    try {
      await store.deleteImageFile(image.id)
    } catch {
      // ignore
    }
  }
}

async function runJob(job) {
  let timer = null
  try {
    if (job.cancelRequested) {
      await finalizeCancelled(job)
      return
    }

    const settings = await store.readSettingsRaw()
    // v1.2.7: local ComfyUI jobs have NO overall timeout — a first run can
    // spend minutes loading a different UNet/LoRA, and the old 300s cap killed
    // perfectly healthy runs. They are cancelled manually instead.
    job.dialect = provider.resolveDialect(job.params.model, settings.models)
    const comfyLocal = job.dialect === 'comfyui'
    if (comfyLocal) {
      job.timeoutMs = 0
    } else {
      // CONTRACT 补丁 v1.1 §2/§6: API generations keep the configured timeout,
      // applied both to the job abort timer and to the provider request layer.
      const jobTimeoutMs = normalizeJobTimeoutMs(settings.jobTimeoutMs)
      job.timeoutMs = jobTimeoutMs
      timer = setTimeout(() => {
        job.timedOut = true
        try {
          job.controller.abort()
        } catch {
          // ignore
        }
      }, jobTimeoutMs)
    }

    // CONTRACT 补丁 v1.2 §2.5: the ComfyUI dialect never resolves the
    // third-party API config (no API key / baseUrl is required for it).
    const config = comfyLocal ? null : store.resolveProviderConfig(settings)

    const refs = []
    for (const meta of job.refsMeta) {
      if (job.cancelRequested || job.timedOut) break
      const loaded = await store.loadRefById(meta.id, '参考图')
      refs.push({ bytes: loaded.bytes, mime: loaded.meta.mime, name: loaded.meta.name })
    }
    // CONTRACT 补丁 v1.4 §C: load the PNG mask for inpainting.
    let mask = null
    if (job.maskId) {
      const loadedMask = await store.loadRefById(job.maskId, '蒙版')
      if (loadedMask.meta.mime !== 'image/png') {
        throw new ApiError('蒙版必须是 PNG 图片（带透明通道）', 'INVALID_REQUEST', 400)
      }
      mask = { bytes: loadedMask.bytes, mime: 'image/png', meta: loadedMask.meta }
    }
    if (job.cancelRequested) {
      await finalizeCancelled(job)
      return
    }
    if (job.timedOut) {
      await finalizeTimeout(job)
      return
    }

    job.progress = 0.1
    // v2.5: timing breakdown so "why is it slow" can be answered from the log:
    // queue wait (enqueue → start), provider call, and the provider's own detail.
    const runStartedAt = Date.now()
    const result = await provider.generateImages({
      config,
      settings,
      params: job.params,
      prompt: job.prompt,
      refs,
      mask,
      signal: job.controller.signal,
      onProgress: (progress) => {
        if (job.finalized) return
        const value = Number(progress)
        if (!Number.isFinite(value)) return
        job.progress = Math.min(0.95, Math.max(job.progress || 0, value))
      },
      // v1.2.6: ComfyUI queue probe → surfaced as stage/queuePosition in the
      // job view, so the composer and the cross-session task panel can show
      // "排队第 N 位" instead of an opaque spinner.
      onQueue: (info) => {
        if (job.finalized || !isPlainObject(info)) return
        job.queue = {
          state: String(info.state || ''),
          position: typeof info.position === 'number' ? info.position : null,
          runningCount: Number(info.runningCount) || 0,
          pendingCount: Number(info.pendingCount) || 0,
        }
        if (info.state === 'running' && job.progress < 0.45) job.progress = 0.45
      },
    })

    const runMs = Date.now() - runStartedAt
    const queuedMs = job.startedAt ? Math.max(0, runStartedAt - Date.parse(job.startedAt)) : 0
    const providerTiming = isPlainObject(result && result.timing) ? result.timing : null
    job.timing = {
      queuedMs,
      runMs,
      ...(providerTiming
        ? {
            execMs: Number(providerTiming.execMs) || 0,
            downloadMs: Number(providerTiming.downloadMs) || 0,
            runs: Number(providerTiming.runs) || 0,
          }
        : {}),
    }
    void store
      .logHost(
        `timing job=${job.jobId} dialect=${job.dialect || '?'} queue=${queuedMs}ms run=${runMs}ms${
          providerTiming
            ? ` exec=${job.timing.execMs}ms download=${job.timing.downloadMs}ms runs=${job.timing.runs}`
            : ''
        }`,
      )
      .catch(() => {})

    if (job.cancelRequested) {
      await finalizeCancelled(job)
      return
    }
    if (job.timedOut) {
      await finalizeTimeout(job)
      return
    }

    const images = await saveResultImages(job, result.images)
    if (job.cancelRequested || job.timedOut) {
      await discardImages(images)
      if (job.cancelRequested) await finalizeCancelled(job)
      else await finalizeTimeout(job)
      return
    }

    await finalizeDone(job, images, result.dialect)
  } catch (error) {
    if (job.finalized) return
    if (job.cancelRequested) {
      await finalizeCancelled(job)
      return
    }
    if (job.timedOut) {
      await finalizeTimeout(job)
      return
    }
    await finalizeError(job, error)
  } finally {
    if (timer) clearTimeout(timer)
    try {
      await store.logHost(
        `job ${job.jobId} ${job.status} turn=${job.turnId} dialect=${job.dialect || '-'} ${
          job.error ? `error="${truncate(job.error, 160)}"` : `images=${job.progress === 1 ? 'ok' : '-'}`
        }`,
      )
    } catch {
      // ignore
    }
    kick()
  }
}

/* ------------------------------------------------------------------ */
/* Startup recovery (§5.6): running turns from a previous process       */
/* ------------------------------------------------------------------ */

export async function ensureRecovered() {
  if (STATE.recovered) return
  if (STATE.recovering) {
    try {
      await STATE.recovering
    } catch {
      // ignore
    }
    return
  }
  STATE.recovering = (async () => {
    try {
      const activeTurnIds = new Set()
      for (const job of STATE.jobs.values()) {
        if (job.status === 'queued' || job.status === 'running') activeTurnIds.add(job.turnId)
      }
      const updated = await store.markInterruptedTurns(activeTurnIds)
      if (updated > 0) {
        await store.logHost(`startup recovery: marked ${updated} conversation file(s) with interrupted turns`)
      }
    } catch {
      // never block a request on recovery
    } finally {
      STATE.recovered = true
      STATE.recovering = null
    }
  })()
  try {
    await STATE.recovering
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* Watchdog (CONTRACT 补丁 v1.1 §5)                                    */
/* ------------------------------------------------------------------ */

/**
 * Reap running jobs that outlived jobTimeoutMs + 30s. Needed because an
 * upstream can stall the response body indefinitely; the per-job timer aborts
 * it, but if the job was created by an older build (or the abort path failed)
 * this sweeper guarantees a deterministic terminal state.
 */
export function watchdogPass() {
  const now = Date.now()
  for (const job of STATE.jobs.values()) {
    if (job.status !== 'running' || job.finalized || !job.startedAt) continue
    // v1.2.7: 0 = no overall timeout (local ComfyUI jobs).
    if (!(Number(job.timeoutMs) > 0)) continue
    const timeoutMs = normalizeJobTimeoutMs(job.timeoutMs)
    const startedAt = Date.parse(job.startedAt)
    if (!Number.isFinite(startedAt)) continue
    const ageMs = now - startedAt
    if (ageMs <= timeoutMs + JOB_TIMEOUT_GRACE_MS) continue
    job.timedOut = true
    try {
      job.controller.abort()
    } catch {
      // ignore
    }
    void finalizeTimeout(job)
    try {
      void store
        .logHost(
          `watchdog: force-timeout job ${job.jobId} turn=${job.turnId} age=${Math.round(ageMs / 1000)}s timeout=${Math.round(timeoutMs / 1000)}s`,
        )
        .catch(() => {})
    } catch {
      // ignore
    }
  }
}

// Immediate pass on module load: reaps jobs left stuck by the old build as soon
// as a patched host module is hot-loaded (CONTRACT 补丁 v1.1 §5/§7).
try {
  watchdogPass()
} catch {
  // never block module load
}

// One process-wide interval: STATE (globalThis) survives module hot reloads.
if (!STATE.watchdogTimer) {
  STATE.watchdogTimer = setInterval(() => {
    try {
      watchdogPass()
    } catch {
      // ignore
    }
  }, WATCHDOG_INTERVAL_MS)
  try {
    STATE.watchdogTimer.unref?.()
  } catch {
    // ignore
  }
}
