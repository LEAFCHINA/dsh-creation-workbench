/**
 * Local ComfyUI workflow engine (COMFY-CONTRACT.md §2, v1.2).
 *
 * The third-party API path lives in provider.js; this module adds a second,
 * independent dialect (`comfyui`) whose upstream is a ComfyUI server that is
 * expected to run on the SAME machine:
 *
 *   GET  /system_stats          connectivity + version
 *   GET  /object_info           node metadata (combo options, numeric bounds)
 *   POST /prompt                { prompt: <API-format workflow>, client_id }
 *   GET  /history/<prompt_id>   poll until the prompt completed
 *   GET  /view?filename=…       download one produced image
 *   POST /queue                 { delete: [prompt_id] } (best-effort cancel)
 *
 * Every request is DIRECT (never through settings.proxyUrl / host/proxy.js)
 * and carries an AbortSignal, so a job cancel/timeout also interrupts polling.
 *
 * Workflows are stored in `<DATA_DIR>/workflows.json` (NOT settings.json) and
 * are read/written through store.readJsonFile / store.writeJsonAtomic with a
 * dedicated `workflows` lock.
 */

import path from 'node:path'

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const store = await import(`./store.js?rev=${encodeURIComponent(REV)}`)

const {
  ApiError,
  nowIso,
  truncate,
  isPlainObject,
  detectMime,
  imageSize,
  mimeForFileName,
  newUniqueId,
  assertNonEmptyString,
  normalizeJobTimeoutMs,
} = util

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** CONTRACT §3: wf ids are self-validated here, util.ID_RE stays untouched. */
export const WF_ID_RE = /^wf_[0-9a-f]{8}$/

export function isWorkflowId(value) {
  return typeof value === 'string' && WF_ID_RE.test(value)
}

export const WORKFLOWS_FILE = path.join(store.DATA_DIR, 'workflows.json')

export const COMFY_LIMITS = {
  maxWorkflows: 50,
  maxWorkflowBytes: 2 * 1024 * 1024,
  maxParams: 60,
}

const STATUS_TIMEOUT_MS = 10000
const OBJECT_INFO_TIMEOUT_MS = 30000
const QUEUE_TIMEOUT_MS = 8000
const QUEUE_PROBE_INTERVAL_MS = 1600
const POLL_INTERVAL_MS = 800
const OBJECT_INFO_TTL_MS = 5 * 60 * 1000
const MAX_SUGGESTED_PARAMS = 8
const MAX_TEXT_PARAM = 20000
const MAX_PARAM_OPTIONS = 200
const PARAM_TYPES = ['text', 'int', 'float', 'bool', 'select']
const IMAGE_OUTPUT_CLASSES = new Set(['SaveImage', 'PreviewImage'])
const VIDEO_OUTPUT_CLASSES = new Set(['VHS_VideoCombine'])

/** OBJECT_INFO cache survives host hot reloads through store.STATE. */
function objectInfoCache() {
  if (!(store.STATE.comfyObjectInfo instanceof Map)) store.STATE.comfyObjectInfo = new Map()
  return store.STATE.comfyObjectInfo
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function makeAbortError(message = '请求已中止') {
  const error = new Error(message)
  error.name = 'AbortError'
  error.aborted = true
  return error
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function networkReason(error) {
  const cause = error?.cause
  const code = String(cause?.code || error?.code || '').trim()
  const message = String(cause?.message || error?.message || error || '网络错误')
  return truncate(code ? `${code}：${message}` : message, 160)
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(makeAbortError())
      return
    }
    const cleanup = () => {
      clearTimeout(timer)
      try {
        signal?.removeEventListener('abort', onAbort)
      } catch {
        // ignore
      }
    }
    const onAbort = () => {
      cleanup()
      reject(makeAbortError())
    }
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    try {
      signal?.addEventListener('abort', onAbort, { once: true })
    } catch {
      // ignore
    }
  })
}

/* ------------------------------------------------------------------ */
/* ComfyUI HTTP client (direct fetch, always abortable)                */
/* ------------------------------------------------------------------ */

/**
 * One direct request to the ComfyUI base URL.
 *
 * Returns `{ ok, status, contentType, buffer, text, data }` for every HTTP
 * status; only transport-level failures throw. External aborts surface as an
 * `AbortError` (jobs.js maps that to the cancelled/timeout terminal states),
 * a connection failure becomes the CONTRACT §2.4 COMFY_UNREACHABLE ApiError.
 */
async function comfyRequest(baseUrl, { path: routePath, method = 'GET', body, signal, timeoutMs = 0 } = {}) {
  const url = `${baseUrl}${routePath}`
  const controller = new AbortController()
  let externalAborted = false
  let timedOut = false
  const onAbort = () => {
    externalAborted = true
    try {
      controller.abort()
    } catch {
      // ignore
    }
  }
  if (signal) {
    if (signal.aborted) onAbort()
    else {
      try {
        signal.addEventListener('abort', onAbort, { once: true })
      } catch {
        // ignore
      }
    }
  }
  const timer = timeoutMs > 0
    ? setTimeout(() => {
        timedOut = true
        try {
          controller.abort()
        } catch {
          // ignore
        }
      }, timeoutMs)
    : null
  try {
    const headers = { accept: 'application/json' }
    let payload
    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const response = await fetch(url, { method, headers, body: payload, signal: controller.signal })
    const buffer = Buffer.from(await response.arrayBuffer())
    const text = buffer.toString('utf8')
    let data = null
    if (text.length > 0) {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      contentType: String(response.headers?.get?.('content-type') || ''),
      buffer,
      text,
      data,
    }
  } catch (error) {
    if (externalAborted) throw makeAbortError()
    if (timedOut) throw makeAbortError(`请求 ComfyUI 超时（${Math.round(timeoutMs / 1000)} 秒）`)
    throw new ApiError(
      `无法连接本机 ComfyUI（${baseUrl}）：${networkReason(error)}，请确认 ComfyUI 已启动`,
      'COMFY_UNREACHABLE',
      502,
    )
  } finally {
    if (timer) clearTimeout(timer)
    if (signal) {
      try {
        signal.removeEventListener('abort', onAbort)
      } catch {
        // ignore
      }
    }
  }
}

function summarizeHttpFailure(result) {
  const message = result.data?.error?.message || result.data?.error || result.data?.message
  if (typeof message === 'string' && message.trim()) return `：${truncate(message.trim(), 200)}`
  const text = truncate(result.text || '', 200)
  return text ? `：${text}` : ''
}

/* ------------------------------------------------------------------ */
/* Connectivity probe (comfy.status)                                   */
/* ------------------------------------------------------------------ */

function sanitizeDevices(raw) {
  if (!Array.isArray(raw)) return []
  const devices = []
  for (const item of raw) {
    if (!isPlainObject(item)) continue
    devices.push({
      name: String(item.name == null ? '' : item.name),
      type: String(item.type == null ? '' : item.type),
      vram_total: finiteOrNull(item.vram_total) || 0,
    })
    if (devices.length >= 32) break
  }
  return devices
}

/** CONTRACT §2.2: never throws — returns `{ ok:false, error }` on failure. */
export async function comfyStatus(settings) {
  const baseUrl = store.normalizeComfyBaseUrl(settings?.comfyBaseUrl)
  if (!baseUrl) {
    return { ok: false, baseUrl: '', error: '尚未配置 ComfyUI 服务地址，请先在设置中填写' }
  }
  try {
    const result = await comfyRequest(baseUrl, { path: '/system_stats', timeoutMs: STATUS_TIMEOUT_MS })
    if (!result.ok) {
      return { ok: false, baseUrl, error: `ComfyUI 返回异常（HTTP ${result.status}）${summarizeHttpFailure(result)}` }
    }
    if (!isPlainObject(result.data)) {
      return { ok: false, baseUrl, error: 'ComfyUI 返回了无法解析的响应（/system_stats 不是 JSON 对象）' }
    }
    const system = isPlainObject(result.data.system) ? result.data.system : {}
    return {
      ok: true,
      baseUrl,
      version: String(system.comfyui_version == null ? '' : system.comfyui_version),
      devices: sanitizeDevices(result.data.devices),
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, baseUrl, error: `连接 ComfyUI 超时（${Math.round(STATUS_TIMEOUT_MS / 1000)} 秒）` }
    }
    return { ok: false, baseUrl, error: String(error?.message || error) }
  }
}

/* ------------------------------------------------------------------ */
/* /queue — live queue snapshot (v1.2.6)                               */
/* ------------------------------------------------------------------ */

/** ComfyUI queue rows are `[number, prompt_id, prompt, extra_data, …]`. */
function summarizeQueueList(list) {
  const out = []
  if (!Array.isArray(list)) return out
  for (const item of list) {
    if (!Array.isArray(item)) continue
    const promptId = typeof item[1] === 'string' ? item[1] : ''
    if (!promptId) continue
    out.push({ promptId, number: Number.isFinite(Number(item[0])) ? Number(item[0]) : null })
  }
  return out
}

/**
 * Read ComfyUI's current queue. Never throws — returns `{ ok:false, error }`.
 * Used by the `comfy.queue` RPC and by the in-generation probe that feeds
 * `job.get` with `stage` / `queuePosition`.
 */
export async function readQueue(settings) {
  const baseUrl = store.normalizeComfyBaseUrl(settings?.comfyBaseUrl)
  if (!baseUrl) return { ok: false, baseUrl: '', error: '尚未配置 ComfyUI 服务地址' }
  try {
    const result = await comfyRequest(baseUrl, { path: '/queue', timeoutMs: QUEUE_TIMEOUT_MS })
    if (!result.ok) {
      return { ok: false, baseUrl, error: `ComfyUI 返回异常（HTTP ${result.status}）` }
    }
    const data = isPlainObject(result.data) ? result.data : {}
    const running = summarizeQueueList(data.queue_running)
    const pending = summarizeQueueList(data.queue_pending)
    return {
      ok: true,
      baseUrl,
      running,
      pending,
      runningCount: running.length,
      pendingCount: pending.length,
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, baseUrl, error: '查询 ComfyUI 队列超时' }
    }
    return { ok: false, baseUrl, error: String(error?.message || error) }
  }
}

/* ------------------------------------------------------------------ */
/* /object_info (5-minute in-memory cache, trimmed per workflow)       */
/* ------------------------------------------------------------------ */

function trimObjectInfo(data, classTypes) {
  const trimmed = {}
  for (const classType of classTypes) {
    if (isPlainObject(data[classType])) trimmed[classType] = data[classType]
  }
  return trimmed
}

async function fetchObjectInfo(baseUrl, { signal } = {}) {
  const cache = objectInfoCache()
  const cached = cache.get(baseUrl)
  if (cached && Date.now() - cached.at < OBJECT_INFO_TTL_MS) return { ok: true, data: cached.data }
  const result = await comfyRequest(baseUrl, { path: '/object_info', signal, timeoutMs: OBJECT_INFO_TIMEOUT_MS })
  if (!result.ok) return { ok: false, error: `HTTP ${result.status}` }
  if (!isPlainObject(result.data)) return { ok: false, error: '响应不是 JSON 对象' }
  cache.set(baseUrl, { at: Date.now(), data: result.data })
  if (cache.size > 8) {
    const oldest = [...cache.entries()].sort((left, right) => left[1].at - right[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  return { ok: true, data: result.data }
}

/* ------------------------------------------------------------------ */
/* Workflow JSON parsing / validation                                  */
/* ------------------------------------------------------------------ */

/**
 * CONTRACT §2.3.1: the payload MUST be the API format exported by ComfyUI's
 * "Save (API Format)"; the regular UI format (top-level `nodes` array) is
 * rejected with a pointer to the right export action.
 */
function parseWorkflowJson(raw) {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      throw new ApiError('工作流 JSON 不是合法的 JSON 文本', 'INVALID_REQUEST', 400)
    }
  }
  if (!isPlainObject(value)) throw new ApiError('工作流 JSON 必须是一个对象', 'INVALID_REQUEST', 400)
  if (Array.isArray(value.nodes)) {
    throw new ApiError(
      '请用 ComfyUI 的「保存(API格式)」导出，而不是普通保存的界面格式',
      'INVALID_REQUEST',
      400,
    )
  }
  const nodeIds = Object.keys(value)
  if (nodeIds.length === 0) throw new ApiError('工作流 JSON 中没有节点', 'INVALID_REQUEST', 400)
  for (const nodeId of nodeIds) {
    const node = value[nodeId]
    if (
      !isPlainObject(node) ||
      typeof node.class_type !== 'string' ||
      !node.class_type.trim() ||
      !isPlainObject(node.inputs)
    ) {
      throw new ApiError(
        `工作流节点 ${truncate(nodeId, 40)} 不是 ComfyUI API 格式（需要 class_type 与 inputs）`,
        'INVALID_REQUEST',
        400,
      )
    }
  }
  return value
}

function assertWorkflowSize(json) {
  const bytes = Buffer.byteLength(JSON.stringify(json))
  if (bytes > COMFY_LIMITS.maxWorkflowBytes) {
    throw new ApiError(
      `工作流 JSON 不能超过 ${Math.round(COMFY_LIMITS.maxWorkflowBytes / 1024 / 1024)}MB`,
      'INVALID_REQUEST',
      413,
    )
  }
  return json
}

/* ------------------------------------------------------------------ */
/* Param spec normalization (shared by save / inspect / generate)      */
/* ------------------------------------------------------------------ */

function coerceNumber(raw, min, max) {
  const number = Number(raw)
  if (!Number.isFinite(number)) return null
  let value = number
  if (Number.isFinite(min)) value = Math.max(min, value)
  if (Number.isFinite(max)) value = Math.min(max, value)
  return value
}

/** Type-normalize one exposed param value (CONTRACT §2.4 step 2). */
function coerceParamValue(type, options, min, max, raw) {
  switch (type) {
    case 'int': {
      const value = coerceNumber(raw, min, max)
      return value === null ? 0 : Math.round(value)
    }
    case 'float': {
      const value = coerceNumber(raw, min, max)
      return value === null ? 0 : value
    }
    case 'bool':
      return raw === true || raw === 'true' || raw === 1 || raw === '1'
    case 'select': {
      const text = raw === undefined || raw === null ? '' : String(raw)
      const list = Array.isArray(options) ? options : []
      if (list.length === 0) return text
      if (list.includes(text)) return text
      const fallback = list[0]
      return typeof fallback === 'string' ? fallback : text
    }
    default:
      return raw === undefined || raw === null ? '' : String(raw).slice(0, MAX_TEXT_PARAM)
  }
}

function defaultParamValue(type, options, min, max, raw) {
  if (raw !== undefined && raw !== null) return coerceParamValue(type, options, min, max, raw)
  if (type === 'bool') return false
  if (type === 'int' || type === 'float') return Number.isFinite(min) ? min : 0
  if (type === 'select') return Array.isArray(options) && options.length > 0 ? String(options[0]) : ''
  return ''
}

/** Strict write-path validation of one exposed param (comfy.workflow.save). */
function normalizeParamSpec(raw, index) {
  const label = `第 ${index + 1} 个工作流参数`
  if (!isPlainObject(raw)) throw new ApiError(`${label}无效`, 'INVALID_REQUEST', 400)
  const key = typeof raw.key === 'string' ? raw.key.trim() : ''
  if (!key || key.length > 100 || !/^[A-Za-z0-9_.-]+$/.test(key)) {
    throw new ApiError(
      `${label}的 key 无效（仅支持字母、数字、下划线、点、连字符，最长 100 个字符）`,
      'INVALID_REQUEST',
      400,
    )
  }
  const nodeId = typeof raw.nodeId === 'string' ? raw.nodeId.trim() : String(raw.nodeId == null ? '' : raw.nodeId).trim()
  if (!nodeId || nodeId.length > 80) throw new ApiError(`${label}的节点 ID 无效`, 'INVALID_REQUEST', 400)
  const inputName = typeof raw.inputName === 'string'
    ? raw.inputName.trim()
    : String(raw.inputName == null ? '' : raw.inputName).trim()
  if (!inputName || inputName.length > 200) throw new ApiError(`${label}的输入名无效`, 'INVALID_REQUEST', 400)
  const type = PARAM_TYPES.includes(raw.type) ? raw.type : ''
  if (!type) throw new ApiError(`${label}的类型无效（支持 text/int/float/bool/select）`, 'INVALID_REQUEST', 400)
  const labelText = typeof raw.label === 'string' && raw.label.trim()
    ? raw.label.trim().slice(0, 100)
    : inputName
  const options = []
  if (type === 'select' && Array.isArray(raw.options)) {
    for (const item of raw.options) {
      if (typeof item !== 'string') continue
      const text = item.trim()
      if (!text || options.includes(text)) continue
      options.push(text.slice(0, 200))
      if (options.length >= MAX_PARAM_OPTIONS) break
    }
  }
  const min = finiteOrNull(raw.min)
  const max = finiteOrNull(raw.max)
  let step = finiteOrNull(raw.step)
  if (step !== null && step <= 0) step = null
  const role = raw.role === 'prompt' ? 'prompt' : 'normal'
  const randomize = raw.randomize === true && (type === 'int' || type === 'float')
  return {
    key,
    nodeId,
    inputName,
    label: labelText,
    type,
    options,
    min,
    max,
    step,
    default: defaultParamValue(type, options, min, max, raw.default),
    role,
    randomize,
  }
}

function normalizeParamsInput(raw) {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new ApiError('工作流参数（params）必须是数组', 'INVALID_REQUEST', 400)
  if (raw.length > COMFY_LIMITS.maxParams) {
    throw new ApiError(`工作流参数最多 ${COMFY_LIMITS.maxParams} 个`, 'INVALID_REQUEST', 400)
  }
  const seen = new Set()
  const params = []
  for (let index = 0; index < raw.length; index += 1) {
    const spec = normalizeParamSpec(raw[index], index)
    if (seen.has(spec.key)) {
      throw new ApiError(`工作流参数 key 重复：${truncate(spec.key, 60)}`, 'INVALID_REQUEST', 400)
    }
    seen.add(spec.key)
    params.push(spec)
  }
  return params
}

function cloneParams(params) {
  return (Array.isArray(params) ? params : []).map((spec) => ({ ...spec, options: [...spec.options] }))
}

/* ------------------------------------------------------------------ */
/* workflows.json store (CONTRACT §1.2)                                */
/* ------------------------------------------------------------------ */

function normalizeStoredWorkflow(item) {
  const createdAt = typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : nowIso()
  const updatedAt = typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : createdAt
  const name = typeof item.name === 'string' && item.name.trim()
    ? item.name.trim().slice(0, 100)
    : '未命名工作流'
  const params = []
  if (Array.isArray(item.params)) {
    for (const raw of item.params) {
      if (params.length >= COMFY_LIMITS.maxParams) break
      try {
        params.push(normalizeParamSpec(raw, params.length))
      } catch {
        // A hand-edited workflows.json may contain an invalid spec; drop it.
      }
    }
  }
  return { id: item.id, name, createdAt, updatedAt, json: item.json, params }
}

async function readWorkflowFile() {
  const raw = await store.readJsonFile(WORKFLOWS_FILE, null)
  if (!isPlainObject(raw) || !Array.isArray(raw.workflows)) return { version: 1, workflows: [] }
  const workflows = []
  for (const item of raw.workflows) {
    if (!isPlainObject(item) || !isWorkflowId(item.id) || !isPlainObject(item.json)) continue
    workflows.push(normalizeStoredWorkflow(item))
    if (workflows.length >= COMFY_LIMITS.maxWorkflows) break
  }
  return { version: 1, workflows }
}

async function writeWorkflowFile(data) {
  await store.writeJsonAtomic(WORKFLOWS_FILE, { version: 1, workflows: data.workflows })
}

/**
 * Summary shape shared by list/save: full param specs (for the composer's
 * dynamic controls) but NEVER the workflow JSON (CONTRACT §3 修订).
 */
function stripWorkflow(workflow) {
  return {
    id: workflow.id,
    name: workflow.name,
    paramCount: Array.isArray(workflow.params) ? workflow.params.length : 0,
    params: cloneParams(workflow.params),
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  }
}

async function findWorkflowById(id) {
  const data = await readWorkflowFile()
  return data.workflows.find((item) => item.id === id) || null
}

export async function listWorkflows() {
  const data = await readWorkflowFile()
  const workflows = data.workflows
    .map(stripWorkflow)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
  return { workflows }
}

export async function getWorkflow(id) {
  if (!isWorkflowId(id)) throw new ApiError('工作流 ID 无效', 'INVALID_REQUEST', 400)
  const found = await findWorkflowById(id)
  if (!found) throw new ApiError('工作流不存在或已删除', 'INVALID_REQUEST', 404)
  return {
    workflow: {
      id: found.id,
      name: found.name,
      createdAt: found.createdAt,
      updatedAt: found.updatedAt,
      json: found.json,
      params: cloneParams(found.params),
    },
  }
}

export async function saveWorkflow({ id, name, json, params } = {}) {
  const idProvided = id !== undefined && id !== null && id !== ''
  if (idProvided && !isWorkflowId(id)) throw new ApiError('工作流 ID 无效', 'INVALID_REQUEST', 400)
  const cleanName = assertNonEmptyString(name, '工作流名称', { max: 100 })
  const cleanJson = json === undefined || json === null ? null : assertWorkflowSize(parseWorkflowJson(json))
  const hasParams = params !== undefined && params !== null
  const cleanParams = hasParams ? normalizeParamsInput(params) : null
  return store.withLock('workflows', async () => {
    const data = await readWorkflowFile()
    const now = nowIso()
    if (idProvided) {
      const index = data.workflows.findIndex((item) => item.id === id)
      if (index < 0) throw new ApiError('工作流不存在或已删除', 'INVALID_REQUEST', 404)
      const current = data.workflows[index]
      // CONTRACT §3: `json` is only sent on create or explicit replace; an
      // absent json keeps the stored graph (params-only edit).
      const next = {
        ...current,
        name: cleanName,
        updatedAt: now,
        json: cleanJson || current.json,
        params: cleanParams || current.params,
      }
      data.workflows[index] = next
      await writeWorkflowFile(data)
      return { workflow: stripWorkflow(next) }
    }
    if (!cleanJson) throw new ApiError('创建工作流必须提供工作流 JSON', 'INVALID_REQUEST', 400)
    if (data.workflows.length >= COMFY_LIMITS.maxWorkflows) {
      throw new ApiError(
        `最多只能保存 ${COMFY_LIMITS.maxWorkflows} 个工作流，请先删除不用的工作流`,
        'INVALID_REQUEST',
        400,
      )
    }
    const workflowId = await newUniqueId('wf', (candidate) => data.workflows.some((item) => item.id === candidate))
    const workflow = {
      id: workflowId,
      name: cleanName,
      createdAt: now,
      updatedAt: now,
      json: cleanJson,
      params: cleanParams || [],
    }
    data.workflows.push(workflow)
    await writeWorkflowFile(data)
    return { workflow: stripWorkflow(workflow) }
  })
}

export async function deleteWorkflow(id) {
  if (!isWorkflowId(id)) throw new ApiError('工作流 ID 无效', 'INVALID_REQUEST', 400)
  return store.withLock('workflows', async () => {
    const data = await readWorkflowFile()
    const index = data.workflows.findIndex((item) => item.id === id)
    if (index < 0) throw new ApiError('工作流不存在或已删除', 'INVALID_REQUEST', 404)
    data.workflows.splice(index, 1)
    await writeWorkflowFile(data)
    return { ok: true }
  })
}

/* ------------------------------------------------------------------ */
/* inspectWorkflow (CONTRACT §2.3)                                     */
/* ------------------------------------------------------------------ */

function nodeInputSpec(nodeDef, inputName) {
  if (!isPlainObject(nodeDef)) return null
  const sections = [nodeDef.input?.required, nodeDef.input?.optional]
  for (const section of sections) {
    if (!isPlainObject(section)) continue
    if (Object.prototype.hasOwnProperty.call(section, inputName)) {
      const spec = section[inputName]
      return Array.isArray(spec) ? spec : [spec]
    }
  }
  return null
}

function comboOptionsOf(spec) {
  if (!Array.isArray(spec)) return []
  const typeSpec = spec[0]
  const opts = isPlainObject(spec[1]) ? spec[1] : {}
  const raw = Array.isArray(typeSpec)
    ? typeSpec
    : String(typeSpec == null ? '' : typeSpec) === 'COMBO' && Array.isArray(opts.options)
      ? opts.options
      : []
  const options = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    if (options.includes(item)) continue
    options.push(item)
    if (options.length >= MAX_PARAM_OPTIONS) break
  }
  return options
}

function numericBoundsOf(spec) {
  const opts = Array.isArray(spec) && isPlainObject(spec[1]) ? spec[1] : {}
  const min = finiteOrNull(opts.min)
  const max = finiteOrNull(opts.max)
  const step = finiteOrNull(opts.step === undefined ? opts.round : opts.step)
  return { min, max, step: step !== null && step > 0 ? step : null }
}

function inferInputValue(value, nodeDef, inputName) {
  if (typeof value === 'boolean') return { type: 'bool', min: null, max: null, step: null, options: [] }
  if (typeof value === 'number') {
    const spec = nodeInputSpec(nodeDef, inputName)
    const bounds = numericBoundsOf(spec)
    return { type: Number.isInteger(value) ? 'int' : 'float', ...bounds, options: [] }
  }
  if (typeof value === 'string') {
    const spec = nodeInputSpec(nodeDef, inputName)
    const options = comboOptionsOf(spec)
    if (options.length > 0) return { type: 'select', min: null, max: null, step: null, options }
    return { type: 'text', min: null, max: null, step: null, options: [] }
  }
  // Arrays (links) and null/objects are wiring or non-scalar values.
  return null
}

function resolveInspectBaseUrl(baseUrl) {
  if (baseUrl === undefined || baseUrl === null) return null
  return store.normalizeComfyBaseUrl(baseUrl)
}

async function inspectBaseUrlFromSettings() {
  try {
    const settings = await store.readSettingsRaw()
    return store.normalizeComfyBaseUrl(settings.comfyBaseUrl)
  } catch {
    return ''
  }
}

function outputKindsOf(classType, nodeDef) {
  const outputTypes = Array.isArray(nodeDef?.output) ? nodeDef.output.map((item) => String(item)) : []
  if (VIDEO_OUTPUT_CLASSES.has(classType)) return ['video']
  if (IMAGE_OUTPUT_CLASSES.has(classType) || outputTypes.includes('IMAGE')) return ['image']
  return []
}

export async function inspectWorkflow({ json, baseUrl } = {}) {
  const graph = parseWorkflowJson(json)
  const classTypes = new Set()
  for (const node of Object.values(graph)) {
    if (isPlainObject(node)) classTypes.add(node.class_type)
  }

  const warnings = []
  let objectInfo = null
  let inspectBase = resolveInspectBaseUrl(baseUrl)
  if (inspectBase === null) inspectBase = await inspectBaseUrlFromSettings()
  if (inspectBase) {
    try {
      const fetched = await fetchObjectInfo(inspectBase)
      if (fetched.ok) objectInfo = trimObjectInfo(fetched.data, classTypes)
      else warnings.push(`无法读取 ComfyUI 节点元数据（${fetched.error}），下拉选项与数值范围需手动填写`)
    } catch (error) {
      // CONTRACT §2.3.4: object_info is best-effort and must never fail inspect.
      warnings.push(
        `无法读取 ComfyUI 节点元数据（${truncate(String(error?.message || error), 160)}），下拉选项与数值范围需手动填写`,
      )
    }
  } else {
    warnings.push('未配置 ComfyUI 服务地址，无法读取节点元数据；下拉选项与数值范围需手动填写')
  }

  const nodes = []
  const outputs = []
  const candidates = []
  let hasVideoOutput = false

  for (const [nodeId, node] of Object.entries(graph)) {
    const classType = node.class_type
    const title = String(node._meta?.title || classType)
    const nodeDef = objectInfo ? objectInfo[classType] : null
    const inputs = []
    for (const [inputName, value] of Object.entries(node.inputs || {})) {
      const inferred = inferInputValue(value, nodeDef, inputName)
      if (!inferred) continue
      inputs.push({
        inputName,
        type: inferred.type,
        value,
        min: inferred.min,
        max: inferred.max,
        step: inferred.step,
        options: inferred.options,
      })
    }
    nodes.push({ nodeId, classType, title, inputs })

    const kinds = outputKindsOf(classType, nodeDef)
    if (kinds.length > 0) {
      outputs.push({ nodeId, classType, kinds })
      if (kinds.includes('video')) hasVideoOutput = true
    }

    for (const input of inputs) {
      const classLower = String(classType || '')
      const isTextEncode = /textencode/i.test(classLower)
      const isPrimitiveText = /^primitive(string|text)/i.test(classLower) || /^string/i.test(classLower)
      const emptyText = input.type === 'text' && String(input.value == null ? '' : input.value).trim() === ''
      // CONTRACT 补丁 v1.2.2: a workflow may carry its prompt in a
      // PrimitiveStringMultiline (empty by design) instead of a CLIPTextEncode.
      // Rank prompt candidates so the single best text input can be bound to the
      // composer box; non-empty primitive strings are usually system prompts.
      let promptRank = 99
      if (input.type === 'text') {
        if (isTextEncode && emptyText) promptRank = 0
        else if (isPrimitiveText && emptyText) promptRank = 1
        else if (isTextEncode) promptRank = 2
      }
      candidates.push({
        nodeId,
        input,
        order: candidates.length,
        promptRank,
        role: 'normal',
        randomize: (input.type === 'int' || input.type === 'float') && /seed/i.test(input.inputName),
      })
    }
  }

  // Bind exactly one prompt input (the best-ranked text input) to the composer.
  let promptCandidate = null
  for (const candidate of candidates) {
    if (candidate.promptRank >= 99) continue
    if (!promptCandidate || candidate.promptRank < promptCandidate.promptRank) promptCandidate = candidate
  }
  if (promptCandidate) promptCandidate.role = 'prompt'
  else warnings.push('未找到可自动绑定主提示词的文本输入；请在工作流参数编辑器中手动指定「主提示词」')

  // CONTRACT §2.3.5: at most 8 suggested params. Rank so the prompt input and
  // seed-like randomizable values are always offered before generic params.
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      priority: candidate.role === 'prompt' ? 0 : candidate.randomize ? 1 : 2,
    }))
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .slice(0, MAX_SUGGESTED_PARAMS)
  const suggestedParams = ranked.map((candidate, index) => ({
    key: `p_${index + 1}`,
    nodeId: candidate.nodeId,
    inputName: candidate.input.inputName,
    // CONTRACT §4.1: the client pre-fills labels with the input name; a prompt
    // input gets a readable default label.
    label: candidate.role === 'prompt' ? '提示词' : candidate.input.inputName,
    type: candidate.input.type,
    options: candidate.input.type === 'select' ? [...candidate.input.options] : [],
    min: candidate.input.min,
    max: candidate.input.max,
    step: candidate.input.step,
    default: candidate.role === 'prompt' ? '' : candidate.input.value,
    role: candidate.role,
    randomize: candidate.randomize,
  }))

  if (hasVideoOutput) {
    warnings.push('工作流包含视频输出节点（VHS_VideoCombine），当前版本不支持视频生成，只会尝试取图片输出')
  }
  if (outputs.length === 0) {
    warnings.push('未检测到图片输出节点（SaveImage / PreviewImage），生成时可能拿不到图片')
  }

  return { nodes, outputs, suggestedParams, warnings }
}

/* ------------------------------------------------------------------ */
/* Workflow params → graph values                                      */
/* ------------------------------------------------------------------ */

function randomParamValue(spec) {
  const min = finiteOrNull(spec.min)
  const max = finiteOrNull(spec.max)
  if (spec.type === 'int') {
    let low = min === null ? 0 : Math.ceil(min)
    let high = max === null ? Number.MAX_SAFE_INTEGER : Math.floor(max)
    low = Math.min(Math.max(low, Number.MIN_SAFE_INTEGER), Number.MAX_SAFE_INTEGER)
    high = Math.min(Math.max(high, Number.MIN_SAFE_INTEGER), Number.MAX_SAFE_INTEGER)
    if (high < low) high = low
    const span = high - low
    if (!Number.isSafeInteger(span) || span >= Number.MAX_SAFE_INTEGER) {
      return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    }
    return Math.floor(low + Math.random() * (span + 1))
  }
  const low = min === null ? 0 : min
  const high = max === null ? 1 : max
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return Number.isFinite(low) ? low : 0
  const value = low + Math.random() * (high - low)
  const step = finiteOrNull(spec.step)
  if (step !== null && step > 0) return Math.round(value / step) * step
  return Math.round(value * 1e6) / 1e6
}

/**
 * Write the resolved values into a copy of the stored API-format workflow.
 * `randomizeKeys` (optional) overrides the per-spec `randomize` flag for this
 * generation; `usedRandom` collects the values actually drawn so the composer
 * can show them after the run.
 */
function buildWorkflowGraph(template, specs, values, randomizeKeys, usedRandom) {
  const graph = JSON.parse(JSON.stringify(template))
  for (const spec of specs) {
    let value = values[spec.key]
    const shouldRandomize = randomizeKeys
      ? randomizeKeys.has(spec.key)
      : spec.randomize === true
    if (shouldRandomize) {
      value = randomParamValue(spec)
      if (usedRandom && typeof usedRandom === 'object') usedRandom[spec.key] = value
    }
    const node = graph[spec.nodeId]
    if (!isPlainObject(node) || !isPlainObject(node.inputs)) continue
    if (!Object.prototype.hasOwnProperty.call(node.inputs, spec.inputName)) continue
    node.inputs[spec.inputName] = value
  }
  return graph
}

function resolveWorkflowValues(specs, rawValues, prompt) {
  const input = isPlainObject(rawValues) ? rawValues : {}
  const values = {}
  const warnings = []
  const knownKeys = new Set()
  for (const spec of specs) {
    knownKeys.add(spec.key)
    if (spec.role === 'prompt') {
      values[spec.key] = String(prompt == null ? '' : prompt).slice(0, MAX_TEXT_PARAM)
      continue
    }
    const raw = Object.prototype.hasOwnProperty.call(input, spec.key) ? input[spec.key] : spec.default
    values[spec.key] = coerceParamValue(spec.type, spec.options, spec.min, spec.max, raw)
  }
  for (const key of Object.keys(input)) {
    if (!knownKeys.has(key)) warnings.push(`未知参数「${truncate(key, 60)}」已忽略`)
  }
  return { values, warnings }
}

/* ------------------------------------------------------------------ */
/* Prompt execution (submit → poll → view)                             */
/* ------------------------------------------------------------------ */

function safeJson(text) {
  if (typeof text !== 'string' || text.length === 0) return null
  try {
    const parsed = JSON.parse(text)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function describePromptRejection(result) {
  const payload = isPlainObject(result.data) ? result.data : safeJson(result.text)
  const parts = []
  const nodeErrors = payload?.node_errors
  if (isPlainObject(nodeErrors)) {
    for (const [nodeId, info] of Object.entries(nodeErrors)) {
      const classType = isPlainObject(info) ? String(info.class_type || '') : ''
      const nodeLabel = classType ? `节点 ${nodeId}（${classType}）` : `节点 ${nodeId}`
      const list = Array.isArray(info?.errors) ? info.errors : []
      const details = []
      for (const item of list) {
        if (!isPlainObject(item)) continue
        const message = item.message || item.type || '参数校验失败'
        const extra = item.details ? `：${item.details}` : ''
        details.push(`${message}${extra}`)
      }
      parts.push(`${nodeLabel}：${details.length > 0 ? details.join('；') : '参数校验失败'}`)
      if (parts.length >= 8) break
    }
  }
  const top = typeof payload?.error === 'string' ? payload.error : payload?.error?.message
  const summary = parts.length > 0 ? parts.join('；') : top || truncate(result.text || '', 300)
  return `ComfyUI 拒绝了工作流执行（HTTP ${result.status}）：${truncate(summary || '未知错误', 500)}`
}

async function submitPrompt(baseUrl, graph, clientId, { signal, timeoutMs }) {
  const result = await comfyRequest(baseUrl, {
    path: '/prompt',
    method: 'POST',
    body: { prompt: graph, client_id: clientId },
    signal,
    timeoutMs,
  })
  if (!result.ok) {
    if (result.status >= 400 && result.status < 500) {
      throw new ApiError(describePromptRejection(result), 'COMFY_NODE_ERROR', 400)
    }
    throw new ApiError(
      `ComfyUI 返回异常（HTTP ${result.status}）${summarizeHttpFailure(result)}`,
      'COMFY',
      502,
    )
  }
  const promptId = typeof result.data?.prompt_id === 'string' ? result.data.prompt_id : ''
  if (!promptId) {
    throw new ApiError('ComfyUI 未返回 prompt_id，请检查工作流是否有效', 'COMFY_NODE_ERROR', 400)
  }
  return promptId
}

function describeHistoryError(entry) {
  const status = isPlainObject(entry?.status) ? entry.status : {}
  const messages = Array.isArray(status.messages) ? status.messages : []
  const parts = []
  for (const item of messages) {
    if (!Array.isArray(item) || item.length < 2) continue
    const kind = String(item[0] || '')
    const body = isPlainObject(item[1]) ? item[1] : {}
    if (kind === 'execution_error') {
      const nodePart = body.node_id ? `节点 ${body.node_id}（${body.node_type || '?'}）` : '执行节点'
      parts.push(`${nodePart}：${body.exception_message || body.exception_type || '执行失败'}`)
    } else if (kind === 'execution_interrupted') {
      parts.push('执行被中断')
    }
    if (parts.length >= 8) break
  }
  const summary = parts.length > 0 ? parts.join('；') : String(status.status_str || '执行失败')
  return `ComfyUI 工作流执行失败：${truncate(summary, 500)}`
}

async function waitForHistory(baseUrl, promptId, { signal, timeoutMs, onProgress, onQueue }) {
  let runningNotified = false
  let lastQueueProbe = 0
  let lastQueueSignature = ''

  const probeQueue = async () => {
    if (typeof onQueue !== 'function') return
    const now = Date.now()
    if (now - lastQueueProbe < QUEUE_PROBE_INTERVAL_MS) return
    lastQueueProbe = now
    try {
      const result = await comfyRequest(baseUrl, { path: '/queue', timeoutMs: QUEUE_TIMEOUT_MS })
      if (!result.ok || !isPlainObject(result.data)) return
      const running = summarizeQueueList(result.data.queue_running)
      const pending = summarizeQueueList(result.data.queue_pending)
      const isRunning = running.some((item) => item.promptId === promptId)
      const pendingIndex = pending.findIndex((item) => item.promptId === promptId)
      const info = {
        state: isRunning ? 'running' : 'queued',
        position: pendingIndex >= 0 ? pendingIndex + 1 : null,
        runningCount: running.length,
        pendingCount: pending.length,
      }
      const signature = `${info.state}:${info.position}:${info.runningCount}:${info.pendingCount}`
      if (signature === lastQueueSignature) return
      lastQueueSignature = signature
      onQueue(info)
    } catch {
      // The queue probe is best effort: history polling is the source of truth.
    }
  }

  for (;;) {
    if (signal?.aborted) throw makeAbortError()
    const result = await comfyRequest(baseUrl, {
      path: `/history/${encodeURIComponent(promptId)}`,
      signal,
      timeoutMs,
    })
    if (!result.ok) {
      throw new ApiError(`查询 ComfyUI 任务状态失败（HTTP ${result.status}）`, 'COMFY', 502)
    }
    const payload = isPlainObject(result.data) ? result.data : {}
    const entry = payload[promptId]
    if (isPlainObject(entry)) {
      const status = isPlainObject(entry.status) ? entry.status : {}
      const statusStr = String(status.status_str || '')
      if (status.completed === true || statusStr === 'success') {
        if (typeof onQueue === 'function') {
          onQueue({ state: 'done', position: null, runningCount: 0, pendingCount: 0 })
        }
        return entry
      }
      if (statusStr === 'error') throw new ApiError(describeHistoryError(entry), 'COMFY_NODE_ERROR', 400)
      if (!runningNotified) {
        runningNotified = true
        if (onProgress) onProgress(0.6)
      }
    } else if (!runningNotified) {
      // An empty /history means the prompt is still queued/running.
      runningNotified = true
      if (onProgress) onProgress(0.6)
    }
    await probeQueue()
    await sleep(POLL_INTERVAL_MS, signal)
  }
}

function collectHistoryImages(entry) {
  const outputs = isPlainObject(entry?.outputs) ? entry.outputs : {}
  const nodeIds = Object.keys(outputs).sort((left, right) => {
    const leftNumber = Number(left)
    const rightNumber = Number(right)
    const leftFinite = Number.isFinite(leftNumber)
    const rightFinite = Number.isFinite(rightNumber)
    if (leftFinite && rightFinite) return leftNumber - rightNumber
    if (leftFinite) return -1
    if (rightFinite) return 1
    return left.localeCompare(right)
  })
  const items = []
  for (const nodeId of nodeIds) {
    const node = outputs[nodeId]
    if (!isPlainObject(node) || !Array.isArray(node.images)) continue
    for (const image of node.images) {
      if (!isPlainObject(image) || typeof image.filename !== 'string' || !image.filename) continue
      items.push({
        filename: image.filename,
        subfolder: typeof image.subfolder === 'string' ? image.subfolder : '',
        type: typeof image.type === 'string' && image.type ? image.type : 'output',
      })
    }
  }
  return items
}

async function downloadImage(baseUrl, item, { signal, timeoutMs }) {
  const query = new URLSearchParams()
  query.set('filename', item.filename)
  query.set('subfolder', item.subfolder)
  query.set('type', item.type)
  const result = await comfyRequest(baseUrl, {
    path: `/view?${query.toString()}`,
    signal,
    timeoutMs,
  })
  if (!result.ok) {
    throw new ApiError(`下载 ComfyUI 生成图片失败（HTTP ${result.status}）`, 'COMFY', 502)
  }
  const bytes = result.buffer
  if (!bytes || bytes.length === 0) {
    throw new ApiError('下载 ComfyUI 生成图片失败：空响应', 'COMFY', 502)
  }
  const mime = detectMime(bytes) || mimeForFileName(item.filename) || ''
  if (!mime.startsWith('image/')) return null
  const size = imageSize(bytes, mime)
  return { bytes, mime, w: size.w, h: size.h }
}

async function downloadImages(baseUrl, items, { signal, timeoutMs }) {
  const images = []
  for (const item of items) {
    if (signal?.aborted) throw makeAbortError()
    const image = await downloadImage(baseUrl, item, { signal, timeoutMs })
    if (image) images.push(image)
  }
  return images
}

/** CONTRACT §2.2: best-effort queue removal (POST /queue { delete: [...] }). */
async function cancelRemotePrompt(baseUrl, promptId) {
  try {
    await comfyRequest(baseUrl, {
      path: '/queue',
      method: 'POST',
      body: { delete: [promptId] },
      timeoutMs: 5000,
    })
  } catch {
    // Cancellation is best effort; the job layer already owns the terminal state.
  }
}

/* ------------------------------------------------------------------ */
/* generateImages (CONTRACT §2.4)                                      */
/* ------------------------------------------------------------------ */

function newClientId() {
  return `dsh-iw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeGenerationCount(value) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) return 1
  return Math.min(number, store.LIMITS.maxN)
}

/**
 * Execute one ComfyUI workflow and return the produced images.
 *
 * `params` (validated by main.js):
 *   { model:'comfy:wf_…', n, workflowId, workflowParams, displayName }
 * Returns `{ dialect:'comfyui', mode:'workflow', images:[{bytes,mime,w,h}] }`.
 */
export async function generateImages({ settings, params, prompt, refs, signal, onProgress, onQueue }) {
  const baseUrl = store.normalizeComfyBaseUrl(settings?.comfyBaseUrl)
  if (!baseUrl) throw new ApiError('尚未配置 ComfyUI 服务地址，请先在设置中填写', 'INVALID_REQUEST', 400)
  if (Array.isArray(refs) && refs.length > 0) {
    throw new ApiError('ComfyUI 工作流模式暂不支持参考图', 'INVALID_REQUEST', 400)
  }
  const rawParams = isPlainObject(params) ? params : {}
  const model = String(rawParams.model || '')
  // v1.2.5: the `comfy:<id>` model prefix wins over a stale workflowId param.
  const modelWorkflowId = model.startsWith('comfy:') ? model.slice('comfy:'.length) : ''
  const workflowId = modelWorkflowId ||
    (typeof rawParams.workflowId === 'string' && rawParams.workflowId.trim()
      ? rawParams.workflowId.trim()
      : '')
  if (!isWorkflowId(workflowId)) throw new ApiError('工作流 ID 无效', 'INVALID_REQUEST', 400)
  const workflow = await findWorkflowById(workflowId)
  if (!workflow) throw new ApiError('工作流不存在或已删除', 'INVALID_REQUEST', 400)

  // Jobs filename prefers displayName (CONTRACT §2.5); fall back to the stored
  // workflow name so locally-created workflows get a readable file name.
  const displayName = typeof rawParams.displayName === 'string' && rawParams.displayName.trim()
    ? rawParams.displayName.trim().slice(0, 200)
    : workflow.name
  if (isPlainObject(params)) params.displayName = displayName

  const specification = Array.isArray(workflow.params) ? workflow.params : []
  const count = normalizeGenerationCount(rawParams.n)
  const { values, warnings } = resolveWorkflowValues(specification, rawParams.workflowParams, prompt)

  // CONTRACT §2.4 step 6: a batch_size input makes one enqueue for n images.
  const batchSpec = specification.find(
    (spec) => spec && spec.inputName === 'batch_size' && (spec.type === 'int' || spec.type === 'float'),
  )
  if (batchSpec) values[batchSpec.key] = count
  const batches = batchSpec ? 1 : count

  // Warn once about exposed params that no longer match the stored graph.
  for (const spec of specification) {
    const node = isPlainObject(workflow.json) ? workflow.json[spec.nodeId] : null
    const exists =
      isPlainObject(node) &&
      isPlainObject(node.inputs) &&
      Object.prototype.hasOwnProperty.call(node.inputs, spec.inputName)
    if (!exists) {
      warnings.push(
        `参数「${spec.label || spec.inputName}」指向的节点 ${spec.nodeId}.${spec.inputName} 不存在，已跳过`,
      )
    }
  }

  // v1.2.4: per-generation randomize override from the composer. Numeric params
  // can be toggled there without editing the saved workflow; the override wins
  // over spec.randomize, and the values actually drawn are reported back so the
  // composer can display the new number after each run.
  const randomizeOverride = isPlainObject(rawParams.workflowRandomize)
    ? rawParams.workflowRandomize
    : null
  const randomizeKeys = new Set()
  for (const spec of specification) {
    if (!spec || (spec.type !== 'int' && spec.type !== 'float')) continue
    const override = randomizeOverride &&
      Object.prototype.hasOwnProperty.call(randomizeOverride, spec.key)
      ? randomizeOverride[spec.key]
      : undefined
    const effective = override === undefined ? spec.randomize === true : override === true
    if (effective) randomizeKeys.add(spec.key)
  }
  const usedRandom = {}

  const timeoutMs = normalizeJobTimeoutMs(settings?.jobTimeoutMs)
  const clientId = newClientId()
  const images = []
  try {
    for (let index = 0; index < batches; index += 1) {
      if (signal?.aborted) throw makeAbortError()
      const graph = buildWorkflowGraph(
        workflow.json,
        specification,
        values,
        randomizeKeys,
        usedRandom,
      )
      if (isPlainObject(params) && Object.keys(usedRandom).length > 0) {
        params.workflowRandomValues = { ...usedRandom }
      }
      if (onProgress) onProgress(0.1)
      const promptId = await submitPrompt(baseUrl, graph, clientId, { signal, timeoutMs })
      if (onProgress) onProgress(0.3)
      let historyEntry
      try {
        historyEntry = await waitForHistory(baseUrl, promptId, { signal, timeoutMs, onProgress, onQueue })
      } catch (error) {
        if (error?.name === 'AbortError') await cancelRemotePrompt(baseUrl, promptId)
        throw error
      }
      if (onProgress) onProgress(0.9)
      const items = collectHistoryImages(historyEntry)
      const batchImages = await downloadImages(baseUrl, items, { signal, timeoutMs })
      images.push(...batchImages)
    }
  } catch (error) {
    if (warnings.length > 0) void logComfyWarnings(workflowId, warnings)
    throw error
  }
  if (warnings.length > 0) void logComfyWarnings(workflowId, warnings)
  if (images.length === 0) {
    throw new ApiError(
      '工作流没有返回图片，请确认工作流包含 SaveImage / PreviewImage 节点并能正常执行',
      'COMFY_NODE_ERROR',
      400,
    )
  }
  return { dialect: 'comfyui', mode: 'workflow', images }
}

function logComfyWarnings(workflowId, warnings) {
  try {
    void store
      .logHost(`comfy workflow ${workflowId}: ${warnings.map((item) => truncate(item, 160)).join('；')}`)
      .catch(() => {})
  } catch {
    // logging must never break generation
  }
}
