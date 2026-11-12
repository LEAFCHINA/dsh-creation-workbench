/**
 * Third-party image provider adapters (CONTRACT.md §5).
 *
 * Two dialects share one normalized result shape:
 *   - openai-images : /images/generations JSON, /images/edits multipart (JSON fallback)
 *   - xai-image     : /images/generations JSON (aspect_ratio/resolution),
 *                     /images/edits JSON (generations fallback)
 *
 * Only Node built-ins and globals (fetch/FormData/Blob) are used. Upstream
 * URLs returned as results are downloaded immediately and never persisted.
 */

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const store = await import(`./store.js?rev=${encodeURIComponent(REV)}`)
const proxy = await import(`./proxy.js?rev=${encodeURIComponent(REV)}`)
const comfy = await import(`./comfy.js?rev=${encodeURIComponent(REV)}`)

const {
  ApiError,
  truncate,
  isPlainObject,
  detectMime,
  imageSize,
  toDataUri,
  decodeBase64Payload,
} = util

export const OPENAI_QUALITIES = ['auto', 'low', 'medium', 'high']
export const XAI_QUALITIES = ['auto', 'low', 'medium']
export const XAI_ASPECT_RATIOS = [
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2',
  '19.5:9', '9:19.5', '20:9', '9:20', '21:9', '5:2', 'auto',
]
export const XAI_RESOLUTIONS = ['1k', '2k']
export const MAX_XAI_REFS = 5

const DOWNLOAD_TIMEOUT_MS = 60000
const PROBE_TIMEOUT_MS = 15000

/* ------------------------------------------------------------------ */
/* Dialect                                                             */
/* ------------------------------------------------------------------ */

/** CONTRACT.md §5.2: explicit settings dialect > model-name heuristic. */
export function resolveDialect(model, models) {
  // CONTRACT 补丁 v1.2 §2.5: local ComfyUI workflow models win over everything.
  if (String(model || '').startsWith('comfy:')) return 'comfyui'
  const list = Array.isArray(models) ? models : []
  const configured = list.find((item) => item && item.id === model)
  if (configured && (configured.dialect === 'openai-images' || configured.dialect === 'xai-image')) {
    return configured.dialect
  }
  if (/grok|xai/i.test(String(model || ''))) return 'xai-image'
  return 'openai-images'
}

/* ------------------------------------------------------------------ */
/* Upstream errors                                                     */
/* ------------------------------------------------------------------ */

export function extractUpstreamMessage(text) {
  const raw = String(text == null ? '' : text)
  if (!raw) return ''
  try {
    const json = JSON.parse(raw)
    const message = json?.error?.message || json?.message || json?.error?.error || json?.error
    if (typeof message === 'string' && message.trim()) return message.trim()
  } catch {
    // not JSON
  }
  return ''
}

export function upstreamError(status, text, contentType = '') {
  const raw = String(text == null ? '' : text)
  const message = extractUpstreamMessage(raw)
  const typeHint = contentType ? `，content-type: ${truncate(String(contentType).split(';')[0].trim(), 60)}` : ''
  const summary = message
    ? `：${truncate(message, 200)}`
    : `（HTTP ${status}${typeHint}，正文前 300 字：${truncate(raw, 300)}）`
  if (status === 402) return new ApiError(`额度不足或已超出配额${summary}`, 'QUOTA', 402)
  if (status === 401 || status === 403) return new ApiError('API Key 无效或无权限', 'AUTH', 401)
  if (status === 429) return new ApiError(`请求过于频繁或额度不足${summary}`, 'RATE_LIMIT', 429)
  if (
    (status === 400 || status === 422) &&
    /moderation|policy|safety|content[_ -]?policy|flagged|violat/i.test(raw)
  ) {
    return new ApiError('内容被上游安全策略拒绝', 'CONTENT_REJECTED', 400)
  }
  if (status >= 400 && status < 500) {
    return new ApiError(`上游拒绝了请求（HTTP ${status}）${summary}`, 'INVALID_REQUEST', 400)
  }
  return new ApiError(`上游服务异常（HTTP ${status}）${summary}`, 'PROVIDER', 502)
}

/* ------------------------------------------------------------------ */
/* HTTP helpers (abort/timeout cover connection + headers + body)      */
/* ------------------------------------------------------------------ */

/** CONTRACT 补丁 v1.1 §2: every upstream request advertises SSE support. */
const UPSTREAM_ACCEPT = 'application/json, text/event-stream'

function authHeaders(apiKey) {
  return { authorization: `Bearer ${apiKey}`, accept: UPSTREAM_ACCEPT }
}

function jsonHeaders(apiKey) {
  return { ...authHeaders(apiKey), 'content-type': 'application/json' }
}

function joinPath(url) {
  try {
    return new URL(String(url)).pathname || '/'
  } catch {
    return truncate(String(url || ''), 80)
  }
}

/** One host.log line per upstream call: dialect/method/path/status/content-type/elapsed[/proxy]. */
function logUpstreamCall({ dialect, method, url, status, contentType, elapsedMs, proxyUrl }) {
  const safeType = truncate(String(contentType || '').split(';')[0].trim() || '-', 40)
  const proxyTag = proxyUrl ? ` proxy=${proxy.proxyLabel(proxyUrl)}` : ''
  const line = `upstream ${String(dialect || '?')} ${String(method || 'GET').toUpperCase()} ${joinPath(url)} -> ${status} ct=${safeType} ${elapsedMs}ms${proxyTag}`
  try {
    void store.logHost(line).catch(() => {})
  } catch {
    // logging must never break the call
  }
}

/**
 * Upstream transport with FULL body consumption inside the abort/timeout
 * lifecycle. When `opts.proxyUrl` is set the request goes through the built-in
 * HTTP proxy transport (host/proxy.js); otherwise the global fetch path is used.
 *
 * The external AbortSignal (job cancel/timeout) and the local timer stay
 * attached until the body has been fully read — the v1.1 production bug was
 * that they were detached as soon as fetch() resolved (headers arrived), so a
 * stalled response body could never be aborted by the job timeout or cancel.
 */
async function httpBody(url, options, opts = {}) {
  const { signal, timeoutMs = 0, timeoutMessage = '请求上游超时', mode = 'text', proxyUrl } = opts
  if (proxyUrl) {
    // CONTRACT 补丁 v1.2: full-lifecycle proxy transport (CONNECT + TLS or
    // absolute-form), hand-written so abort/timeout also cover the body.
    const result = await proxy.proxyRequest(url, options, { signal, timeoutMs, timeoutMessage, proxyUrl })
    return {
      status: result.status,
      ok: result.ok,
      headers: result.headers,
      contentType: result.contentType,
      body: mode === 'buffer' ? result.body : result.body.toString('utf8'),
      elapsedMs: result.elapsedMs,
    }
  }
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
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const startedAt = Date.now()
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
    const response = await fetch(url, { ...options, signal: controller.signal })
    const body = mode === 'buffer' ? Buffer.from(await response.arrayBuffer()) : await response.text()
    return {
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      contentType: String(response.headers?.get?.('content-type') || ''),
      body,
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    if (externalAborted) {
      const abortError = new Error('请求已中止')
      abortError.name = 'AbortError'
      abortError.aborted = true
      throw abortError
    }
    if (timedOut || controller.signal.aborted) throw new ApiError(timeoutMessage, 'TIMEOUT', 504)
    throw new ApiError(
      `无法连接到生图 API（网络错误）：${truncate(String(error?.message || error), 160)}`,
      'NETWORK',
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

/** Text response with full-lifecycle abort; logs one upstream diagnostic line. */
async function httpText(url, options = {}, opts = {}) {
  const result = await httpBody(url, options, { ...opts, mode: 'text' })
  logUpstreamCall({
    dialect: opts.dialect,
    method: options.method || 'GET',
    url,
    status: result.status,
    contentType: result.contentType,
    elapsedMs: result.elapsedMs,
    proxyUrl: opts.proxyUrl,
  })
  return result
}

/** Buffer response with full-lifecycle abort; logs one upstream diagnostic line. */
async function httpBuffer(url, options = {}, opts = {}) {
  const result = await httpBody(url, options, { ...opts, mode: 'buffer' })
  logUpstreamCall({
    dialect: opts.dialect || 'download',
    method: options.method || 'GET',
    url,
    status: result.status,
    contentType: result.contentType,
    elapsedMs: result.elapsedMs,
    proxyUrl: opts.proxyUrl,
  })
  return result
}

/** Parse an SSE body's `data:` JSON chunks and merge their data/images/output arrays. */
export function parseSsePayload(text) {
  const items = []
  const pushArray = (value) => {
    if (Array.isArray(value)) for (const item of value) items.push(item)
  }
  const lines = String(text == null ? '' : text).split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.toLowerCase().startsWith('data:')) continue
    const chunk = trimmed.slice(5).trim()
    if (!chunk || chunk === '[DONE]') continue
    let json = null
    try {
      json = JSON.parse(chunk)
    } catch {
      continue
    }
    if (!json) continue
    if (Array.isArray(json)) {
      pushArray(json)
      continue
    }
    if (!isPlainObject(json)) continue
    pushArray(json.data)
    pushArray(json.images)
    pushArray(json.output)
    if (typeof json.b64_json === 'string' || typeof json.url === 'string') items.push(json)
  }
  return items.length ? { data: items, __sse: true } : null
}

function looksLikeSse(text, contentType) {
  if (/text\/event-stream/i.test(String(contentType || ''))) return true
  return /^\s*data:/m.test(String(text || ''))
}

/** JSON body or SSE-merged payload; failure carries status/content-type/body snippet. */
function parseJsonOrSse(text, contentType) {
  const raw = String(text == null ? '' : text)
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed)
      if (isPlainObject(json)) return json
    } catch {
      // fall through to SSE/diagnostic handling
    }
  }
  if (looksLikeSse(raw, contentType)) {
    const merged = parseSsePayload(raw)
    if (merged) return merged
    throw new ApiError(
      `上游返回了无法解析的 SSE 响应（content-type: ${truncate(contentType, 80) || '-'}，正文前 300 字：${truncate(raw, 300)}）`,
      'PROVIDER',
      502,
    )
  }
  throw new ApiError(
    `上游返回了无法解析的响应（content-type: ${truncate(contentType, 80) || '-'}，正文前 300 字：${truncate(raw, 300)}）`,
    'PROVIDER',
    502,
  )
}

async function requestJson(url, options, opts = {}) {
  const result = await httpText(url, options, opts)
  if (!result.ok) throw upstreamError(result.status, result.body, result.contentType)
  return parseJsonOrSse(result.body, result.contentType)
}

async function downloadUrl(url, signal, { dialect, proxyUrl } = {}) {
  const result = await httpBuffer(url, { method: 'GET' }, {
    signal,
    dialect,
    proxyUrl,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    timeoutMessage: '下载生成图片超时（60 秒）',
  })
  if (!result.ok) {
    throw new ApiError(
      `下载生成图片失败（HTTP ${result.status}，content-type: ${truncate(result.contentType, 60) || '-'}）`,
      'PROVIDER',
      502,
    )
  }
  if (!result.body || result.body.length === 0) throw new ApiError('下载生成图片失败：空响应', 'PROVIDER', 502)
  return result.body
}

/* ------------------------------------------------------------------ */
/* Validation (CONTRACT.md §5.3 / §5.4)                                */
/* ------------------------------------------------------------------ */

export function validateOpenAIParams(params) {
  const size = params?.size ? String(params.size) : ''
  if (size && size !== 'auto') {
    const match = /^(\d+)x(\d+)$/.exec(size)
    if (!match) {
      throw new ApiError('尺寸格式应为「宽x高」，例如 1024x1024（或 auto）', 'INVALID_REQUEST', 400)
    }
    const width = Number(match[1])
    const height = Number(match[2])
    if (width % 16 !== 0 || height % 16 !== 0) {
      throw new ApiError('尺寸的宽和高必须是 16 的倍数', 'INVALID_REQUEST', 400)
    }
    if (Math.max(width, height) > 3840) {
      throw new ApiError('尺寸的最长边不能超过 3840 像素', 'INVALID_REQUEST', 400)
    }
    const pixels = width * height
    if (pixels < 655360 || pixels > 8294400) {
      throw new ApiError('尺寸总像素需在 655360 到 8294400 之间', 'INVALID_REQUEST', 400)
    }
    if (Math.max(width, height) / Math.min(width, height) > 3) {
      throw new ApiError('尺寸的长宽比不能超过 3:1', 'INVALID_REQUEST', 400)
    }
  }
  if (params?.background === 'transparent' && params?.outputFormat === 'jpeg') {
    throw new ApiError('透明背景不能搭配 JPEG 输出格式', 'INVALID_REQUEST', 400)
  }
  const quality = params?.quality
  if (quality && !OPENAI_QUALITIES.includes(quality)) {
    throw new ApiError('质量参数仅支持 auto / low / medium / high', 'INVALID_REQUEST', 400)
  }
}

export function validateXaiParams(params) {
  const aspectRatio = params?.aspectRatio
  if (aspectRatio && !XAI_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new ApiError('比例参数不在 xAI 支持的范围内', 'INVALID_REQUEST', 400)
  }
  const resolution = params?.resolution
  if (resolution && !XAI_RESOLUTIONS.includes(resolution)) {
    throw new ApiError('分辨率参数仅支持 1k / 2k', 'INVALID_REQUEST', 400)
  }
  const quality = params?.quality
  if (quality && !XAI_QUALITIES.includes(quality)) {
    throw new ApiError('质量参数仅支持 auto / low / medium', 'INVALID_REQUEST', 400)
  }
}

function buildOpenAIJsonBody(params, prompt) {
  const body = { model: params.model, prompt, n: params.n }
  if (params.size) body.size = params.size
  if (params.quality) body.quality = params.quality
  if (params.background) body.background = params.background
  if (params.outputFormat) body.output_format = params.outputFormat
  return body
}

function buildXaiJsonBody(params, prompt) {
  const body = {
    model: params.model,
    prompt,
    n: params.n,
    response_format: 'b64_json',
  }
  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio
  if (params.resolution) body.resolution = params.resolution
  if (params.quality) body.quality = params.quality
  return body
}

/* ------------------------------------------------------------------ */
/* Result normalization (CONTRACT.md §5.5)                             */
/* ------------------------------------------------------------------ */

function looksLikeBase64(value) {
  const text = String(value || '')
  return text.length > 64 && /^[A-Za-z0-9+/=\r\n]+$/.test(text)
}

function collectCandidates(payload) {
  const out = []
  const pushItem = (item) => {
    if (!item) return
    if (typeof item === 'string') {
      if (/^https?:\/\//i.test(item)) out.push({ url: item })
      else if (item.startsWith('data:image/')) out.push({ b64: item })
      else if (looksLikeBase64(item)) out.push({ b64: item })
      return
    }
    if (typeof item !== 'object') return
    const b64 =
      (typeof item.b64_json === 'string' && item.b64_json) ||
      (typeof item.b64 === 'string' && item.b64) ||
      (typeof item.base64 === 'string' && item.base64) ||
      ''
    if (b64) {
      out.push({ b64 })
      return
    }
    if (typeof item.url === 'string' && item.url) out.push({ url: item.url })
  }
  const lists = []
  if (Array.isArray(payload?.data)) lists.push(payload.data)
  if (Array.isArray(payload?.images)) lists.push(payload.images)
  if (Array.isArray(payload?.output)) lists.push(payload.output)
  if (Array.isArray(payload?.result)) lists.push(payload.result)
  for (const list of lists) {
    for (const item of list) pushItem(item)
  }
  return out
}

function bytesFromBase64(value) {
  try {
    const bytes = decodeBase64Payload(value, '上游返回的图片')
    return bytes
  } catch {
    return null
  }
}

/** Turn any accepted upstream payload into `[{ bytes, mime, w, h }]`. */
export async function normalizeResults(payload, { signal, onProgress, dialect, proxyUrl } = {}) {
  const candidates = collectCandidates(payload)
  if (candidates.length === 0) {
    throw new ApiError(
      `上游没有返回可识别的图片数据：${truncate(JSON.stringify(payload), 300)}`,
      'PROVIDER',
      502,
    )
  }
  const images = []
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    let bytes = null
    if (candidate.b64) {
      bytes = bytesFromBase64(candidate.b64)
    } else if (candidate.url) {
      try {
        bytes = await downloadUrl(candidate.url, signal, { dialect, proxyUrl })
      } catch (error) {
        // Timeout / abort must keep their classification (a skipped download
        // would otherwise be misreported as an unparseable payload).
        if (error?.name === 'AbortError' || error?.code === 'TIMEOUT') throw error
        bytes = null
      }
    }
    if (bytes && bytes.length > 0) {
      const mime = detectMime(bytes)
      if (mime) {
        const size = imageSize(bytes, mime)
        images.push({ bytes, mime, w: size.w, h: size.h })
      }
    }
    if (onProgress) onProgress(0.5 + 0.45 * ((index + 1) / candidates.length))
  }
  if (images.length === 0) {
    throw new ApiError(
      `上游返回的图片无法解析（未找到可用的 base64 或 URL 图片）：${truncate(JSON.stringify(payload), 300)}`,
      'PROVIDER',
      502,
    )
  }
  return images
}

/* ------------------------------------------------------------------ */
/* OpenAI Images dialect (CONTRACT.md §5.3)                            */
/* ------------------------------------------------------------------ */

function shouldFallbackToJsonEdits(status) {
  // CONTRACT §5.3: retry JSON edits when the multipart call is rejected with a
  // 4xx. Auth/rate-limit cases would fail identically, so they are not retried.
  return status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 402 && status !== 429
}

async function generateOpenAI({ config, params, prompt, refs, signal, onProgress, timeoutMs, mask }) {
  validateOpenAIParams(params)
  const base = `${config.baseUrl}/images`
  const jsonBody = buildOpenAIJsonBody(params, prompt)
  const requestTimeoutMs = util.normalizeJobTimeoutMs(timeoutMs)
  const proxyUrl = config.proxyUrl || ''

  if (!refs.length) {
    const payload = await requestJson(`${base}/generations`, {
      method: 'POST',
      headers: jsonHeaders(config.apiKey),
      body: JSON.stringify(jsonBody),
    }, { signal, timeoutMs: requestTimeoutMs, timeoutMessage: '生图请求超时', dialect: 'openai-images', proxyUrl })
    if (onProgress) onProgress(0.5)
    const images = await normalizeResults(payload, { signal, onProgress, dialect: 'openai-images', proxyUrl })
    return { dialect: 'openai-images', mode: 'generations', images }
  }

  // Reference images: multipart/form-data first. When proxied we must not rely
  // on global fetch/FormData, so the multipart bytes are built by hand
  // (CONTRACT 补丁 v1.2 §1).
  const editFields = [['model', params.model], ['prompt', prompt], ['n', String(params.n)]]
  if (params.size) editFields.push(['size', params.size])
  if (params.quality) editFields.push(['quality', params.quality])
  if (params.background) editFields.push(['background', params.background])
  if (params.outputFormat) editFields.push(['output_format', params.outputFormat])
  const editFiles = refs.map((ref, index) => ({
    field: 'image[]',
    filename: ref.name || `reference-${index + 1}.${util.extForMime(ref.mime)}`,
    mime: ref.mime || 'image/png',
    bytes: ref.bytes,
  }))
  // CONTRACT 补丁 v1.4 §C: append the PNG mask as a `mask` file part.
  if (mask && mask.bytes) {
    editFiles.push({
      field: 'mask',
      filename: 'mask.png',
      mime: 'image/png',
      bytes: mask.bytes,
    })
  }
  let editRequest
  if (proxyUrl) {
    const multipart = proxy.buildMultipartBody(editFields, editFiles)
    editRequest = {
      headers: { ...authHeaders(config.apiKey), 'content-type': multipart.contentType },
      body: multipart.body,
    }
  } else {
    const form = new FormData()
    for (const [name, value] of editFields) form.append(name, value)
    for (const file of editFiles) {
      form.append(file.field, new Blob([file.bytes], { type: file.mime }), file.filename)
    }
    editRequest = { headers: authHeaders(config.apiKey), body: form }
  }

  let result = await httpText(`${base}/edits`, {
    method: 'POST',
    ...editRequest,
  }, { signal, timeoutMs: requestTimeoutMs, timeoutMessage: '参考图生图请求超时', dialect: 'openai-images', proxyUrl })

  if (!result.ok && shouldFallbackToJsonEdits(result.status)) {
    // CONTRACT §5.3 fallback: JSON edits with data-URI reference images
    // (+ CONTRACT v1.4 §C mask data URI).
    const fallbackBody = {
      ...buildOpenAIJsonBody(params, prompt),
      images: refs.map((ref) => toDataUri(ref.mime, ref.bytes)),
    }
    if (mask && mask.bytes) fallbackBody.mask = toDataUri(mask.mime || 'image/png', mask.bytes)
    result = await httpText(`${base}/edits`, {
      method: 'POST',
      headers: jsonHeaders(config.apiKey),
      body: JSON.stringify(fallbackBody),
    }, { signal, timeoutMs: requestTimeoutMs, timeoutMessage: '参考图生图请求超时', dialect: 'openai-images', proxyUrl })
  }

  if (!result.ok) throw upstreamError(result.status, result.body, result.contentType)
  const payload = parseJsonOrSse(result.body, result.contentType)
  if (onProgress) onProgress(0.5)
  const images = await normalizeResults(payload, { signal, onProgress, dialect: 'openai-images', proxyUrl })
  return { dialect: 'openai-images', mode: 'edits', images }
}

/* ------------------------------------------------------------------ */
/* xAI / Grok Imagine dialect (CONTRACT.md §5.4)                       */
/* ------------------------------------------------------------------ */

function shouldFallbackXaiGenerations(status) {
  return status === 400 || status === 404 || status === 405
}

async function generateXai({ config, params, prompt, refs, signal, onProgress, timeoutMs }) {
  validateXaiParams(params)
  const base = `${config.baseUrl}/images`
  const generationBody = buildXaiJsonBody(params, prompt)
  const requestTimeoutMs = util.normalizeJobTimeoutMs(timeoutMs)
  const proxyUrl = config.proxyUrl || ''

  if (!refs.length) {
    const payload = await requestJson(`${base}/generations`, {
      method: 'POST',
      headers: jsonHeaders(config.apiKey),
      body: JSON.stringify(generationBody),
    }, { signal, timeoutMs: requestTimeoutMs, timeoutMessage: '生图请求超时', dialect: 'xai-image', proxyUrl })
    if (onProgress) onProgress(0.5)
    const images = await normalizeResults(payload, { signal, onProgress, dialect: 'xai-image', proxyUrl })
    return { dialect: 'xai-image', mode: 'generations', images }
  }

  const dataUris = refs.map((ref) => toDataUri(ref.mime, ref.bytes))
  const editBody = {
    ...generationBody,
    images: dataUris.map((url) => ({ type: 'image_url', url })),
  }
  if (!editBody.aspect_ratio) delete editBody.aspect_ratio
  if (!editBody.resolution) delete editBody.resolution
  if (!editBody.quality) delete editBody.quality

  let result = await httpText(`${base}/edits`, {
    method: 'POST',
    headers: jsonHeaders(config.apiKey),
    body: JSON.stringify(editBody),
  }, { signal, timeoutMs: requestTimeoutMs, timeoutMessage: '参考图生图请求超时', dialect: 'xai-image', proxyUrl })

  if (!result.ok && shouldFallbackXaiGenerations(result.status)) {
    // CONTRACT §5.4 fallback: generations with an `images` array (+ image_url
    // for the single-reference case).
    const fallbackBody = {
      ...generationBody,
      images: dataUris.map((url) => ({ type: 'image_url', url })),
    }
    if (dataUris.length === 1) fallbackBody.image_url = dataUris[0]
    result = await httpText(`${base}/generations`, {
      method: 'POST',
      headers: jsonHeaders(config.apiKey),
      body: JSON.stringify(fallbackBody),
    }, { signal, timeoutMs: requestTimeoutMs, timeoutMessage: '参考图生图请求超时', dialect: 'xai-image', proxyUrl })
  }

  if (!result.ok) throw upstreamError(result.status, result.body, result.contentType)
  const payload = parseJsonOrSse(result.body, result.contentType)
  if (onProgress) onProgress(0.5)
  const images = await normalizeResults(payload, { signal, onProgress, dialect: 'xai-image', proxyUrl })
  return { dialect: 'xai-image', mode: 'edits', images }
}

/* ------------------------------------------------------------------ */
/* Public API used by jobs.js                                          */
/* ------------------------------------------------------------------ */

/**
 * Generate images. `refs` = [{ bytes, mime, name }].
 * Returns `{ dialect, mode, images: [{ bytes, mime, w, h }] }`.
 */
export async function generateImages({ config, settings, params, prompt, refs, signal, onProgress, mask, onQueue }) {
  const dialect = resolveDialect(params?.model, settings?.models)
  // CONTRACT 补丁 v1.2 §2.5: the local ComfyUI workflow dialect skips the
  // third-party API checks (API key, video model, inpainting) entirely; the
  // workflow itself decides what it can do.
  if (dialect === 'comfyui') {
    return comfy.generateImages({
      settings,
      params,
      prompt,
      refs: Array.isArray(refs) ? refs : [],
      signal,
      onProgress,
      onQueue,
    })
  }
  // CONTRACT 补丁 v1.1 §4: never call upstream for a video model.
  if (/video/i.test(String(params?.model || ''))) {
    throw new ApiError(
      `当前版本仅支持生图模型：${truncate(String(params.model), 80)} 是视频模型，请选择图片模型`,
      'INVALID_REQUEST',
      400,
    )
  }
  // CONTRACT 补丁 v1.4 §C: inpainting is OpenAI-images only.
  if (mask) {
    if (dialect !== 'openai-images') {
      throw new ApiError('该模型不支持局部重绘，请选择 OpenAI 图像模型', 'INVALID_REQUEST', 400)
    }
    if (!Array.isArray(refs) || refs.length === 0) {
      throw new ApiError('局部重绘需要至少一张参考图', 'INVALID_REQUEST', 400)
    }
  }
  const timeoutMs = util.normalizeJobTimeoutMs(settings?.jobTimeoutMs)
  if (onProgress) onProgress(0.1)
  if (dialect === 'xai-image') {
    return generateXai({ config, params, prompt, refs: Array.isArray(refs) ? refs : [], signal, onProgress, timeoutMs })
  }
  return generateOpenAI({
    config,
    params,
    prompt,
    refs: Array.isArray(refs) ? refs : [],
    signal,
    onProgress,
    timeoutMs,
    mask: mask || null,
  })
}

/** Minimal, cost-free connectivity probe (CONTRACT §4.2 provider.test). */
export async function testProvider(rawSettings) {
  let config
  try {
    config = store.resolveProviderConfig(rawSettings)
  } catch (error) {
    return { ok: false, error: error.message }
  }
  try {
    const result = await httpText(`${config.baseUrl}/models`, {
      method: 'GET',
      headers: authHeaders(config.apiKey),
    }, {
      timeoutMs: PROBE_TIMEOUT_MS,
      timeoutMessage: '连接测试超时（15 秒）',
      dialect: 'probe',
      proxyUrl: config.proxyUrl,
    })
    if (!result.ok) {
      const mapped = upstreamError(result.status, result.body, result.contentType)
      return { ok: false, status: result.status, error: mapped.message }
    }
    let models = 0
    try {
      const payload = parseJsonOrSse(result.body, result.contentType)
      if (Array.isArray(payload?.data)) models = payload.data.length
    } catch {
      models = 0
    }
    return { ok: true, status: result.status, models }
  } catch (error) {
    return { ok: false, error: String(error?.message || error) }
  }
}

/** Upstream model list with a settings fallback + warning (CONTRACT §4.2). */
export async function listModels(rawSettings) {
  const settings = store.normalizeSettings(rawSettings)
  const configured = settings.models.map((item) => ({ id: item.id, label: item.label, dialect: item.dialect }))
  const fallback = (reason) => ({
    models: configured,
    warning: `无法从上游获取模型列表，已使用本地配置（${truncate(reason, 160)}）`,
  })

  let config
  try {
    config = store.resolveProviderConfig(settings)
  } catch (error) {
    return {
      models: configured,
      warning: `尚未配置生图 API 地址或 API Key，已使用本地模型列表（${truncate(error.message, 120)}）`,
    }
  }

  try {
    const result = await httpText(`${config.baseUrl}/models`, {
      method: 'GET',
      headers: authHeaders(config.apiKey),
    }, {
      timeoutMs: PROBE_TIMEOUT_MS,
      timeoutMessage: '获取模型列表超时（15 秒）',
      dialect: 'probe',
      proxyUrl: config.proxyUrl,
    })
    if (!result.ok) return fallback(`HTTP ${result.status}`)
    let ids = []
    try {
      const payload = parseJsonOrSse(result.body, result.contentType)
      const items = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : []
      ids = items
        .map((item) => (typeof item === 'string' ? item : item && typeof item.id === 'string' ? item.id : ''))
        .filter((id) => typeof id === 'string' && id.length > 0)
    } catch {
      return fallback('上游返回了无法解析的模型列表')
    }
    if (ids.length === 0) return fallback('上游未返回任何模型')
    const models = ids.map((id) => {
      const known = configured.find((item) => item.id === id)
      const dialect = known && known.dialect !== 'auto' ? known.dialect : resolveDialect(id, configured)
      return { id, label: known ? known.label : id, dialect }
    })
    return { models }
  } catch (error) {
    return fallback(String(error?.message || error))
  }
}
