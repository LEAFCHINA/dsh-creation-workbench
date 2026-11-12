/**
 * Host implementation of the AI image workbench plugin.
 *
 * Entry contract (do not change without updating index.js):
 *   export async function handle(req, res, env)
 *     env = { ctx, prefix: '/dsh-creation-workbench/', hostBuild, log }
 *
 * Routes (registered by index.js as exact paths):
 *   GET  <prefix>ping   -> { ok:true, data:{ build, hostBuild, dataDir, at } }
 *   POST <prefix>rpc    -> { op, ...params } => { ok:true, data } | { ok:false, error, code? }
 *   GET  <prefix>file   -> raw image bytes by id (never a path)
 *
 * The module is re-imported on every HTTP request with a fresh `?rev=` query,
 * so helper modules are imported through the same revision and all mutable
 * state lives on globalThis.__dshImageWorkbench (see store.js).
 */

import { promises as fs } from 'node:fs'

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const store = await import(`./store.js?rev=${encodeURIComponent(REV)}`)
const provider = await import(`./provider.js?rev=${encodeURIComponent(REV)}`)
const jobs = await import(`./jobs.js?rev=${encodeURIComponent(REV)}`)
const comfy = await import(`./comfy.js?rev=${encodeURIComponent(REV)}`)
const proxyTransport = await import(`./proxy.js?rev=${encodeURIComponent(REV)}`)
const localfs = await import(`./localfs.js?rev=${encodeURIComponent(REV)}`)
const costs = await import(`./costs.js?rev=${encodeURIComponent(REV)}`)
const agentTool = await import(`./tool.js?rev=${encodeURIComponent(REV)}`)

const { ApiError, sendJson, readJsonBody, nowIso, isPlainObject, isId, truncate } = util

export const HOST_BUILD = '2026-11-13-host-24'

/** Upload RPCs carry base64 image data (20MB → ~27MB JSON). */
const MAX_RPC_BYTES = 48 * 1024 * 1024
/** Reference images per generation (CONTRACT §5.4: xAI edits accept at most 5). */
const MAX_REFS = 5

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

function isApiError(error) {
  return Boolean(error) && error.name === 'ApiError' && typeof error.status === 'number' && typeof error.code === 'string'
}

function errorResponse(error, env) {
  if (isApiError(error)) {
    return { status: error.status, payload: { ok: false, error: error.message, code: error.code } }
  }
  const message = String(error?.message || error || '未知错误')
  try {
    env?.log?.(`rpc failed: ${String(error?.stack || message)}`)
  } catch {
    // ignore
  }
  void store.logHost(`rpc failed: ${String(error?.stack || message)}`).catch(() => {})
  return {
    status: 500,
    payload: { ok: false, error: `服务器内部错误：${truncate(message, 300)}` },
  }
}

/* ------------------------------------------------------------------ */
/* Same-origin / auth fence                                            */
/* ------------------------------------------------------------------ */

function looksLikeBrowserRequest(req) {
  const headers = req.headers || {}
  if (headers.origin) return true
  if (headers.cookie) return true
  // Note: `sec-fetch-mode` alone is also sent by Node's fetch/undici, so only
  // the browser-only markers count here.
  if (headers['sec-fetch-site'] || headers['sec-fetch-dest']) return true
  return false
}

/**
 * CONTRACT.md §4.4: ask DSH Connection for its Host/Origin + browser-auth
 * verdict (undefined = allowed). Local tools/scripts talk to the loopback API
 * without browser headers, so an *unauthenticated* (401) verdict is only
 * enforced for browser-shaped requests — otherwise the documented HTTP API
 * would be unusable from curl/e2e. A 403 (untrusted Host/Origin) is always
 * enforced.
 */
async function requestRejectionStatus(env, req) {
  let verdict
  try {
    const ctx = env?.ctx
    const connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
    const check = connection?.requestRejection
    if (typeof check === 'function') {
      verdict = check.call(connection, req)
      if (verdict && typeof verdict.then === 'function') verdict = await verdict
    }
  } catch {
    verdict = undefined
  }
  if (verdict === undefined || verdict === null || verdict === false) return null
  let status = 403
  if (typeof verdict === 'number') status = verdict
  else if (typeof verdict === 'object' && typeof verdict.status === 'number') status = verdict.status
  if (status === 401 && !looksLikeBrowserRequest(req)) return null
  return status
}

async function checkAccess(env, req, res) {
  const status = await requestRejectionStatus(env, req)
  if (!status) return true
  sendJson(res, status, {
    ok: false,
    error: status === 401 ? '未授权：请从 DSH 界面重新打开本插件' : '仅允许来自本机 DSH 界面的请求',
  })
  return false
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

function serverInfo(env) {
  return { build: HOST_BUILD, hostBuild: String(env?.hostBuild || '') }
}

async function handlePing(req, res, env) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: '仅支持 GET 请求' })
    return
  }
  const data = {
    build: HOST_BUILD,
    hostBuild: String(env?.hostBuild || ''),
    dataDir: store.dataDir(),
    at: nowIso(),
  }
  if (req.method === 'HEAD') {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end()
    return
  }
  sendJson(res, 200, { ok: true, data })
}

async function handleFile(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { ok: false, error: '仅支持 GET 请求' })
    return
  }
  const imageId = url.searchParams.get('id') || ''
  if (!isId(imageId, 'img') && !isId(imageId, 'up')) {
    sendJson(res, 404, { ok: false, error: '图片不存在或已被删除' })
    return
  }
  const entry = await store.lookupImageFile(imageId)
  if (!entry) {
    sendJson(res, 404, { ok: false, error: '图片不存在或已被删除' })
    return
  }
  let bytes
  try {
    bytes = await fs.readFile(entry.path)
  } catch {
    await store.unregisterImage(imageId)
    sendJson(res, 404, { ok: false, error: '图片不存在或已被删除' })
    return
  }
  const mime = entry.mime || util.detectMime(bytes) || 'application/octet-stream'
  res.statusCode = 200
  res.setHeader('content-type', mime)
  res.setHeader('content-length', bytes.length)
  res.setHeader('cache-control', 'private, max-age=31536000, immutable')
  res.setHeader('x-content-type-options', 'nosniff')
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(bytes)
}

/* ------------------------------------------------------------------ */
/* RPC                                                                 */
/* ------------------------------------------------------------------ */

async function dispatchOp(payload, env) {
  const op = payload?.op
  if (typeof op !== 'string' || op.length === 0) throw new ApiError('缺少操作名（op）', 'INVALID_REQUEST', 400)

  switch (op) {
    /* ---------------- bootstrap / settings ---------------- */
    case 'bootstrap':
      return store.loadBootstrap(serverInfo(env))

    case 'settings.get': {
      const raw = await store.readSettingsRaw()
      return store.safeSettings(raw)
    }

    case 'settings.set':
      return store.applySettings(payload)

    /* ---------------- workspaces ---------------- */
    case 'workspace.create':
      return store.createWorkspace(payload.name)

    case 'workspace.rename':
      await store.renameWorkspace(payload.id, payload.name)
      return { ok: true }

    case 'workspace.delete':
      return store.deleteWorkspace(payload.id)

    /* ---------------- conversations ---------------- */
    case 'conversation.create':
      return store.createConversation(payload.workspaceId, payload.title)

    case 'conversation.get':
      return store.getConversation(payload.workspaceId, payload.conversationId)

    case 'conversation.rename':
      await store.renameConversation(payload.conversationId, payload.title, payload.workspaceId)
      return { ok: true }

    case 'conversation.delete':
      return store.deleteConversation(payload.conversationId, payload.workspaceId)

    /* ---------------- images ---------------- */
    case 'image.delete': {
      if (!isId(payload.workspaceId, 'ws')) throw new ApiError('工作区 ID 无效', 'INVALID_REQUEST', 400)
      if (!isId(payload.conversationId, 'conv')) throw new ApiError('会话 ID 无效', 'INVALID_REQUEST', 400)
      if (!isId(payload.imageId, 'img')) throw new ApiError('图片 ID 无效', 'INVALID_REQUEST', 400)
      const result = await store.removeImage(payload.workspaceId, payload.conversationId, payload.imageId)
      return { conversation: result.conv }
    }

    /* CONTRACT 补丁 v1.3: delete a non-running turn (error/cancelled/done). */
    case 'turn.delete': {
      if (!isId(payload.workspaceId, 'ws')) throw new ApiError('工作区 ID 无效', 'INVALID_REQUEST', 400)
      if (!isId(payload.conversationId, 'conv')) throw new ApiError('会话 ID 无效', 'INVALID_REQUEST', 400)
      if (!isId(payload.turnId, 'turn')) throw new ApiError('生成任务 ID 无效', 'INVALID_REQUEST', 400)
      const conversation = await store.deleteTurn(payload.workspaceId, payload.conversationId, payload.turnId)
      return { conversation }
    }

    case 'ref.fromImage': {
      if (!isId(payload.imageId, 'img') && !isId(payload.imageId, 'up')) {
        throw new ApiError('图片 ID 无效', 'INVALID_REQUEST', 400)
      }
      if (payload.workspaceId !== undefined) {
        if (!isId(payload.workspaceId, 'ws')) throw new ApiError('工作区 ID 无效', 'INVALID_REQUEST', 400)
      }
      if (payload.conversationId !== undefined) {
        if (!isId(payload.conversationId, 'conv')) throw new ApiError('会话 ID 无效', 'INVALID_REQUEST', 400)
      }
      return { ref: await store.refFromImage(payload.imageId) }
    }

    case 'upload':
      return { ref: await store.saveUpload(payload) }

    /* ---------------- client diagnostics ---------------- */
    case 'client.log': {
      const level = String(payload.level || 'info').slice(0, 20)
      const message = String(payload.message == null ? '' : payload.message)
      await store.logClient(level, message)
      try {
        env?.log?.(`client[${level}] ${truncate(message, 2000)}`)
      } catch {
        // ignore
      }
      return { ok: true }
    }

    case 'client.ready': {
      const info = isPlainObject(payload.info) ? payload.info : {}
      await store.logClient('info', `client.ready ${JSON.stringify(info).slice(0, 2000)}`)
      try {
        env?.log?.(`client ready: ${JSON.stringify(info).slice(0, 500)}`)
      } catch {
        // ignore
      }
      return { ok: true }
    }

    /* ---------------- generation ---------------- */
    case 'generate':
      return handleGenerateOp(payload)

    case 'job.get':
      return jobs.getJobView(payload.jobId)

    case 'job.cancel':
      return jobs.cancelJob(payload.jobId)

    /* v1.2.6: active jobs across all conversations (cross-session task panel). */
    case 'job.list':
      return jobs.listJobs()

    /* CONTRACT 补丁 v1.1 §5: stop a turn by id (in-memory job or orphan). */
    case 'turn.abort': {
      if (!isId(payload.workspaceId, 'ws')) throw new ApiError('工作区 ID 无效', 'INVALID_REQUEST', 400)
      if (!isId(payload.conversationId, 'conv')) throw new ApiError('会话 ID 无效', 'INVALID_REQUEST', 400)
      if (!isId(payload.turnId, 'turn')) throw new ApiError('生成任务 ID 无效', 'INVALID_REQUEST', 400)
      return jobs.abortTurn({
        workspaceId: payload.workspaceId,
        conversationId: payload.conversationId,
        turnId: payload.turnId,
      })
    }

    case 'models.list': {
      const settings = await store.readSettingsRaw()
      return provider.listModels(settings)
    }

    case 'provider.test': {
      const settings = await store.readSettingsRaw()
      return provider.testProvider(settings)
    }

    /* ---------------- CONTRACT 补丁 v1.2 §3: local ComfyUI workflows ---------------- */
    case 'comfy.status': {
      const settings = await store.readSettingsRaw()
      return comfy.comfyStatus(settings)
    }

    /* v1.2.6: live ComfyUI queue snapshot (running/pending prompt ids). */
    case 'comfy.queue': {
      const settings = await store.readSettingsRaw()
      return comfy.readQueue(settings)
    }

    case 'comfy.workflow.list':
      return comfy.listWorkflows()

    case 'comfy.workflow.get':
      return comfy.getWorkflow(payload.id)

    case 'comfy.workflow.inspect': {
      const settings = await store.readSettingsRaw()
      const baseUrl = payload.baseUrl === undefined || payload.baseUrl === null
        ? settings.comfyBaseUrl
        : payload.baseUrl
      return comfy.inspectWorkflow({ json: payload.json, baseUrl })
    }

    case 'comfy.workflow.save':
      return comfy.saveWorkflow({
        id: payload.id,
        name: payload.name,
        category: payload.category,
        json: payload.json,
        params: payload.params,
      })

    case 'comfy.workflow.delete':
      return comfy.deleteWorkflow(payload.id)

    /* CONTRACT 补丁 v1.2 §4 / v1.10: read-only system proxy detection with
     * local-port scanning; the configured API host is used as CONNECT target. */
    case 'proxy.detect': {
      const settings = await store.readSettingsRaw()
      return proxyTransport.detectProxy({ baseUrl: settings.baseUrl })
    }

    /* ---------------- CONTRACT 补丁 v1.4 §A: local files + cost stats ---------------- */
    case 'folder.pick':
      return localfs.pickFolder({ title: payload.title, initial: payload.initial, testValue: payload.testValue })

    case 'folder.open':
      return localfs.openFolder({ path: payload.path })

    case 'file.open':
      return localfs.openImage({ imageId: payload.imageId })

    case 'file.reveal':
      return localfs.revealImage({ imageId: payload.imageId })

    case 'file.saveAs':
      return localfs.saveImageAs({ imageId: payload.imageId, dir: payload.dir })

    case 'stats.cost':
      return costs.costStats({ days: payload.days })

    default:
      throw new ApiError(`未知操作：${truncate(String(op), 80)}`, 'INVALID_REQUEST', 400)
  }
}

/* ------------------------------------------------------------------ */
/* generate                                                            */
/* ------------------------------------------------------------------ */

function normalizeGenParams(raw) {
  const params = {
    model: String(raw.model || '').trim(),
    n: Number(raw.n),
  }
  for (const field of ['size', 'quality', 'aspectRatio', 'resolution', 'background', 'outputFormat']) {
    const value = raw[field]
    if (typeof value === 'string' && value.trim().length > 0) params[field] = value.trim()
  }
  // CONTRACT 补丁 v1.2 §2.5: ComfyUI workflow selections travel as params.
  if (params.model.startsWith('comfy:')) {
    // v1.2.5: the model prefix is authoritative. A stale params.workflowId from
    // a previous workflow selection must never override the workflow the user
    // currently sees selected (that silently ran workflow A for workflow B).
    const modelWorkflowId = params.model.slice('comfy:'.length)
    const rawWorkflowId = typeof raw.workflowId === 'string' ? raw.workflowId.trim() : ''
    const workflowId = modelWorkflowId || rawWorkflowId
    if (!comfy.isWorkflowId(workflowId)) throw new ApiError('工作流 ID 无效', 'INVALID_REQUEST', 400)
    params.workflowId = workflowId
    if (rawWorkflowId && rawWorkflowId !== workflowId) {
      void store.logHost(
        `generate: stale workflowId param "${rawWorkflowId}" overridden by model "${params.model}"`,
      )
    }
    const workflowParams = {}
    const source = raw.workflowParams
    if (source !== undefined && source !== null) {
      if (!isPlainObject(source)) {
        throw new ApiError('工作流参数（workflowParams）必须是对象', 'INVALID_REQUEST', 400)
      }
      let count = 0
      for (const [key, value] of Object.entries(source)) {
        if (count >= 200) break
        const name = String(key || '').trim()
        if (!name) continue
        if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
          throw new ApiError(
            `工作流参数「${truncate(name, 60)}」的值必须是字符串、数字或布尔值`,
            'INVALID_REQUEST',
            400,
          )
        }
        workflowParams[name.slice(0, 100)] = value
        count += 1
      }
    }
    params.workflowParams = workflowParams
    // v1.2.4: per-generation randomize overrides for numeric workflow params
    // (the composer can toggle "随机" without editing the saved workflow).
    const randomizeSource = raw.workflowRandomize
    const workflowRandomize = {}
    if (randomizeSource !== undefined && randomizeSource !== null) {
      if (!isPlainObject(randomizeSource)) {
        throw new ApiError('随机参数设置（workflowRandomize）必须是对象', 'INVALID_REQUEST', 400)
      }
      let randomizeCount = 0
      for (const [key, value] of Object.entries(randomizeSource)) {
        if (randomizeCount >= 200) break
        const name = String(key || '').trim()
        if (!name) continue
        if (typeof value !== 'boolean') {
          throw new ApiError(
            `随机参数「${truncate(name, 60)}」的取值必须是布尔值`,
            'INVALID_REQUEST',
            400,
          )
        }
        workflowRandomize[name.slice(0, 100)] = value
        randomizeCount += 1
      }
    }
    params.workflowRandomize = workflowRandomize
    const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : ''
    if (displayName) params.displayName = displayName.slice(0, 200)
  }
  return params
}

async function handleGenerateOp(payload) {
  if (!isId(payload.workspaceId, 'ws')) throw new ApiError('工作区 ID 无效', 'INVALID_REQUEST', 400)
  if (!isId(payload.conversationId, 'conv')) throw new ApiError('会话 ID 无效', 'INVALID_REQUEST', 400)
  const prompt = util.assertNonEmptyString(payload.prompt, '提示词', { max: 8000 })

  const rawParams = isPlainObject(payload.params) ? payload.params : null
  if (!rawParams) throw new ApiError('生成参数（params）无效', 'INVALID_REQUEST', 400)
  const model = typeof rawParams.model === 'string' ? rawParams.model.trim() : ''
  if (!model) throw new ApiError('请选择生成模型', 'INVALID_REQUEST', 400)
  // CONTRACT 补丁 v1.2 §2.5: comfy:<workflowId> selects a local ComfyUI
  // workflow; the video-model rejection only applies to remote API models.
  const isComfy = model.startsWith('comfy:')
  // CONTRACT 补丁 v1.1 §4: video models are rejected before any upstream call.
  if (!isComfy && /video/i.test(model)) {
    throw new ApiError(
      `当前版本仅支持生图模型：${truncate(model, 80)} 是视频模型，请选择图片模型`,
      'INVALID_REQUEST',
      400,
    )
  }
  const n = rawParams.n === undefined || rawParams.n === null ? 1 : Number(rawParams.n)
  if (!Number.isInteger(n) || n < 1 || n > store.LIMITS.maxN) {
    throw new ApiError(`生成张数必须是 1 到 ${store.LIMITS.maxN} 之间的整数`, 'INVALID_REQUEST', 400)
  }
  const params = normalizeGenParams({ ...rawParams, model, n })

  // The conversation must exist before a turn is persisted into it.
  await store.getConversation(payload.workspaceId, payload.conversationId)

  const rawRefs = payload.refs === undefined || payload.refs === null ? [] : payload.refs
  if (!Array.isArray(rawRefs)) throw new ApiError('参考图列表（refs）必须是数组', 'INVALID_REQUEST', 400)
  // CONTRACT 补丁 v1.2 §2.5: v1 ComfyUI workflows do not accept reference images.
  if (isComfy && rawRefs.length > 0) {
    throw new ApiError('ComfyUI 工作流模式暂不支持参考图', 'INVALID_REQUEST', 400)
  }
  if (rawRefs.length > MAX_REFS) throw new ApiError(`参考图最多 ${MAX_REFS} 张`, 'INVALID_REQUEST', 400)
  const refsMeta = []
  const seenRefs = new Set()
  for (const item of rawRefs) {
    const refId = typeof item === 'string' ? item : isPlainObject(item) ? item.id : ''
    if (!isId(refId, 'img') && !isId(refId, 'up')) {
      throw new ApiError('参考图 ID 无效', 'INVALID_REQUEST', 400)
    }
    if (seenRefs.has(refId)) continue
    seenRefs.add(refId)
    refsMeta.push(await store.refMetaById(refId))
  }

  // CONTRACT 补丁 v1.4 §C: optional PNG mask for local inpainting (局部重绘).
  const settings = await store.readSettingsRaw()
  let maskMeta = null
  let maskId = ''
  const rawMaskId = payload.maskId
  if (isComfy && rawMaskId !== undefined && rawMaskId !== null && rawMaskId !== '') {
    // CONTRACT 补丁 v1.2 §2.5: v1 ComfyUI workflows do not support inpainting.
    throw new ApiError('ComfyUI 工作流模式暂不支持局部重绘', 'INVALID_REQUEST', 400)
  }
  if (rawMaskId !== undefined && rawMaskId !== null && rawMaskId !== '') {
    if (typeof rawMaskId !== 'string' || !isId(rawMaskId, 'up')) {
      throw new ApiError('蒙版 ID 无效（必须是上传的 PNG 图片 id）', 'INVALID_REQUEST', 400)
    }
    const loadedMask = await store.loadRefById(rawMaskId, '蒙版')
    if (loadedMask.meta.mime !== 'image/png') {
      throw new ApiError('蒙版必须是 PNG 图片（带透明通道）', 'INVALID_REQUEST', 400)
    }
    if (loadedMask.bytes.length > 50 * 1024 * 1024) {
      throw new ApiError('蒙版不能超过 50MB', 'INVALID_REQUEST', 413)
    }
    if (refsMeta.length === 0) {
      throw new ApiError('局部重绘需要至少一张参考图', 'INVALID_REQUEST', 400)
    }
    const firstRef = refsMeta[0]
    if (loadedMask.meta.w !== firstRef.w || loadedMask.meta.h !== firstRef.h) {
      throw new ApiError(
        `蒙版尺寸必须与参考图一致（参考图 ${firstRef.w}x${firstRef.h}，蒙版 ${loadedMask.meta.w}x${loadedMask.meta.h}）`,
        'INVALID_REQUEST',
        400,
      )
    }
    const dialect = provider.resolveDialect(model, settings.models)
    if (dialect !== 'openai-images') {
      throw new ApiError('该模型不支持局部重绘，请选择 OpenAI 图像模型', 'INVALID_REQUEST', 400)
    }
    maskMeta = loadedMask.meta
    maskId = rawMaskId
    params.mode = 'image_edit'
  }

  // CONTRACT 补丁 v1.1 §5: allocate jobId up-front, persist it on the running
  // turn BEFORE responding so a page reload can resume polling / cancel.
  const jobId = jobs.newJobId()
  const turn = {
    id: util.newId('turn'),
    jobId,
    createdAt: nowIso(),
    finishedAt: null,
    prompt,
    params,
    refs: refsMeta,
    mask: maskMeta,
    status: 'running',
    error: null,
    images: [],
  }
  // Persist the running turn BEFORE returning, per CONTRACT §5.6.
  await store.appendTurn(payload.workspaceId, payload.conversationId, turn)
  jobs.enqueueGeneration({
    workspaceId: payload.workspaceId,
    conversationId: payload.conversationId,
    turn,
    params,
    prompt,
    refsMeta,
    jobId,
    maskId,
  })
  return { turnId: turn.id, jobId, turn }
}

async function handleRpc(req, res, env) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: '仅支持 POST 请求' })
    return
  }
  let payload
  try {
    payload = await readJsonBody(req, MAX_RPC_BYTES)
  } catch (error) {
    const response = errorResponse(error, env)
    sendJson(res, response.status, response.payload)
    return
  }
  try {
    const data = await dispatchOp(payload, env)
    sendJson(res, 200, { ok: true, data })
  } catch (error) {
    const response = errorResponse(error, env)
    sendJson(res, response.status, response.payload)
  }
}

/* ------------------------------------------------------------------ */
/* Entry                                                               */
/* ------------------------------------------------------------------ */

export async function handle(req, res, env) {
  try {
    if (!(await checkAccess(env, req, res))) return
    try {
      // CONTRACT 补丁 v1.4 §B: register the agent tool lazily (index.js gives us
      // the plugin context, host/main.js has no apply hook of its own). The
      // version suffix forces the hot-reload in-place definition sync.
      agentTool.ensureRegistered(env?.ctx, `${HOST_BUILD}#tool-2`)
    } catch {
      // tool registration must never break HTTP routes
    }
    try {
      // CONTRACT §5.6: leftover running turns from a previous process become
      // errors on the first request after boot.
      await jobs.ensureRecovered()
    } catch {
      // recovery must never block a request
    }

    const url = new URL(req.url || '/', 'http://localhost')
    const prefix = env.prefix || '/dsh-creation-workbench/'
    const sub = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname.replace(/^\/+/, '')

    if (sub === 'ping') {
      await handlePing(req, res, env)
      return
    }
    if (sub === 'rpc') {
      await handleRpc(req, res, env)
      return
    }
    if (sub === 'file') {
      await handleFile(req, res, url)
      return
    }
    sendJson(res, 404, { ok: false, error: `未知接口：${truncate(sub, 80)}` })
  } catch (error) {
    const response = errorResponse(error, env)
    try {
      sendJson(res, response.status, response.payload)
    } catch {
      try {
        res.end()
      } catch {
        // ignore
      }
    }
  }
}
