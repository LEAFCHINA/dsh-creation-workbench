/**
 * Minimal HTTP/1.1 proxy transport + system proxy detection for the image
 * workbench (CONTRACT.md 补丁 v1.2).
 *
 * Only used when `settings.proxyUrl` is set; it affects ONLY this plugin's
 * image-upstream traffic (never DSH global traffic / LLM calls).
 *
 * Transport rules:
 *  - https target: CONNECT host:port tunnel through the proxy, then TLS over
 *    the tunnel (SNI = target hostname), then HTTP/1.1 over TLS.
 *  - http target: absolute-form request written to the proxy socket.
 *  - proxy scheme http(s): plain/TLS connection to the proxy first.
 *  - Proxy-Authorization: Basic base64(user:pass) when the proxy URL has
 *    credentials (never logged).
 *  - Abort/timeout covers connect + headers + body: the external AbortSignal
 *    destroys every socket (AbortError); the local timer throws TIMEOUT;
 *    connect/TLS/body errors throw NETWORK. The body is fully read before
 *    cleanup so stalled bodies are abortable (v1.1 root cause must not recur).
 *
 * No npm dependencies: node:net / node:tls / node:child_process only.
 */

import net from 'node:net'
import tls from 'node:tls'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const { ApiError, truncate } = util

const MAX_HEAD_BYTES = 64 * 1024
const MAX_BODY_BYTES = 64 * 1024 * 1024
const MAX_REDIRECTS = 5

/* ------------------------------------------------------------------ */
/* Proxy URL parsing / validation / masking                            */
/* ------------------------------------------------------------------ */

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value))
  } catch {
    return String(value)
  }
}

/** Parse a validated proxy URL into connection coordinates (null when empty). */
export function parseProxyUrl(raw) {
  const text = String(raw == null ? '' : raw).trim()
  if (!text) return null
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname) return null
  const defaultPort = parsed.protocol === 'https:' ? 443 : 80
  const port = parsed.port ? Number(parsed.port) : defaultPort
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  const username = parsed.username ? safeDecode(parsed.username) : ''
  const password = parsed.password ? safeDecode(parsed.password) : ''
  const authHeader = username
    ? `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
    : ''
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port,
    username,
    password,
    authHeader,
    label: `${parsed.hostname}:${port}`,
    origin: `${parsed.protocol}//${parsed.hostname}:${port}`,
  }
}

/** Host:port label for logs — never includes credentials. */
export function proxyLabel(raw) {
  const parsed = parseProxyUrl(raw)
  return parsed ? parsed.label : ''
}

/** Validate + normalize a proxy setting value; '' clears (CONTRACT v1.2 §3). */
export function validateProxyUrl(raw) {
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string') {
    throw new ApiError('代理地址必须是字符串（空字符串表示直连）', 'INVALID_REQUEST', 400)
  }
  const text = raw.trim()
  if (!text) return ''
  // A masked value from SafeSettings must never be persisted (the client shows
  // `http://user:***@host:port`; saving it would overwrite the real password).
  if (/:\*\*\*@/.test(text)) {
    throw new ApiError('代理密码不能保存为掩码，请重新填写完整代理地址', 'INVALID_REQUEST', 400)
  }
  if (/^socks/i.test(text) || /^pac:/i.test(text) || /^socks5/i.test(text)) {
    throw new ApiError('仅支持 http/https 代理地址（不支持 socks/socks5/PAC）', 'INVALID_REQUEST', 400)
  }
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw new ApiError('代理地址格式无效，请填写 http://host:port（可带 user:pass@）', 'INVALID_REQUEST', 400)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ApiError('仅支持 http/https 代理地址（不支持 socks/socks5/PAC）', 'INVALID_REQUEST', 400)
  }
  if (!parsed.hostname) {
    throw new ApiError('代理地址缺少主机名，请填写 http://host:port', 'INVALID_REQUEST', 400)
  }
  const defaultPort = parsed.protocol === 'https:' ? 443 : 80
  const port = parsed.port ? Number(parsed.port) : defaultPort
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ApiError('代理端口无效，请检查代理地址', 'INVALID_REQUEST', 400)
  }
  const userInfo = parsed.username
    ? `${encodeURIComponent(safeDecode(parsed.username))}${
        parsed.password ? `:${encodeURIComponent(safeDecode(parsed.password))}` : ''
      }@`
    : ''
  return `${parsed.protocol}//${userInfo}${parsed.hostname}:${port}`
}

/** Masked display value for SafeSettings (CONTRACT v1.2 §2). */
export function maskProxyUrl(raw) {
  const parsed = parseProxyUrl(raw)
  if (!parsed) return ''
  const userInfo = parsed.username ? `${encodeURIComponent(parsed.username)}:***@` : ''
  return `${parsed.protocol}//${userInfo}${parsed.hostname}:${parsed.port}`
}

/* ------------------------------------------------------------------ */
/* Hand-built multipart bytes (proxy mode must not rely on FormData)   */
/* ------------------------------------------------------------------ */

function quoteMultipartValue(value) {
  return String(value == null ? '' : value).replace(/[\r\n"]/g, '_')
}

/**
 * Build a multipart/form-data body by hand.
 * `fields`: [[name, value]]; `files`: [{ field, filename, mime, bytes }].
 */
export function buildMultipartBody(fields, files) {
  const boundary = `----dshImageWorkbench${randomUUID().replace(/-/g, '')}`
  const chunks = []
  for (const [name, value] of Array.isArray(fields) ? fields : []) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${quoteMultipartValue(name)}"\r\n\r\n${String(
          value == null ? '' : value,
        )}\r\n`,
        'utf8',
      ),
    )
  }
  for (const file of Array.isArray(files) ? files : []) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${quoteMultipartValue(
          file.field || 'image[]',
        )}"; filename="${quoteMultipartValue(file.filename || 'image.png')}"\r\nContent-Type: ${
          file.mime || 'application/octet-stream'
        }\r\n\r\n`,
        'utf8',
      ),
    )
    chunks.push(Buffer.isBuffer(file.bytes) ? file.bytes : Buffer.from(file.bytes || []))
    chunks.push(Buffer.from('\r\n', 'utf8'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

/* ------------------------------------------------------------------ */
/* Small socket helpers                                                */
/* ------------------------------------------------------------------ */

function normalizeNetworkError(error, prefix) {
  return new ApiError(
    `${prefix}：无法连接（${truncate(String(error?.message || error || '网络错误'), 160)}）`,
    'NETWORK',
    502,
  )
}

function createState(opts = {}) {
  const state = {
    sockets: [],
    aborted: false,
    timedOut: false,
    error: null,
    timer: null,
    listeners: [],
    cleanup: null,
    fail: null,
    failure: null,
  }
  let rejectFailure = () => {}
  state.failure = new Promise((_, reject) => {
    rejectFailure = reject
  })
  state.failure.catch(() => {})
  const cleanup = () => {
    if (state.timer) {
      try {
        clearTimeout(state.timer)
      } catch {
        // ignore
      }
      state.timer = null
    }
    for (const off of state.listeners) {
      try {
        off()
      } catch {
        // ignore
      }
    }
    state.listeners = []
  }
  state.cleanup = cleanup
  state.abortError = () => {
    if (state.timedOut) return new ApiError(opts.timeoutMessage || '请求上游超时', 'TIMEOUT', 504)
    const error = new Error('请求已中止')
    error.name = 'AbortError'
    error.aborted = true
    return error
  }
  state.fail = (error) => {
    if (state.aborted) return
    state.aborted = true
    state.error = error
    cleanup()
    for (const socket of state.sockets) {
      try {
        socket.destroy()
      } catch {
        // ignore
      }
    }
    rejectFailure(error)
  }
  const signal = opts.signal
  if (signal) {
    if (signal.aborted) {
      state.fail(state.abortError())
    } else {
      const onAbort = () => state.fail(state.abortError())
      try {
        signal.addEventListener('abort', onAbort, { once: true })
        state.listeners.push(() => signal.removeEventListener('abort', onAbort))
      } catch {
        // ignore
      }
    }
  }
  const timeoutMs = Number(opts.timeoutMs) || 0
  if (timeoutMs > 0) {
    state.timer = setTimeout(() => {
      state.timedOut = true
      state.fail(new ApiError(opts.timeoutMessage || '请求上游超时', 'TIMEOUT', 504))
    }, timeoutMs)
    try {
      state.timer.unref?.()
    } catch {
      // ignore
    }
  }
  return state
}

function raceFailure(state, promise) {
  return Promise.race([promise, state.failure])
}

function attachSocketErrorHandling(socket, state, prefix) {
  socket.on('error', (error) => {
    if (state.aborted) return
    state.fail(normalizeNetworkError(error, prefix))
  })
}

function openSocket(connection, state, tlsToProxy, label) {
  return raceFailure(
    state,
    new Promise((resolve) => {
      const tlsOptions = { host: connection.hostname, port: connection.port }
      if (tlsToProxy && !net.isIP(connection.hostname)) tlsOptions.servername = connection.hostname
      const socket = tlsToProxy ? tls.connect(tlsOptions) : net.connect({ host: connection.hostname, port: connection.port })
      state.sockets.push(socket)
      attachSocketErrorHandling(socket, state, label)
      socket.once(tlsToProxy ? 'secureConnect' : 'connect', () => resolve(socket))
    }),
  )
}

/**
 * Read an HTTP response head from a socket.
 * On resolve the socket is paused. Returns parsed status/headers and any bytes
 * already read past the head (`rest`).
 */
function readHead(socket, state, label) {
  return raceFailure(
    state,
    new Promise((resolve) => {
      let buffer = Buffer.alloc(0)
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        if (buffer.length > MAX_HEAD_BYTES) {
          cleanup()
          state.fail(new ApiError(`${label} 响应头过大`, 'PROVIDER', 502))
          return
        }
        const index = buffer.indexOf('\r\n\r\n')
        if (index < 0) return
        cleanup()
        try {
          socket.pause()
        } catch {
          // ignore
        }
        resolve({
          ...parseHead(buffer.subarray(0, index).toString('latin1')),
          rest: buffer.subarray(index + 4),
        })
      }
      const onEnd = () => {
        cleanup()
        state.fail(normalizeNetworkError(new Error('连接在响应头之前关闭'), label))
      }
      const cleanup = () => {
        socket.removeListener('data', onData)
        socket.removeListener('end', onEnd)
        socket.removeListener('close', onEnd)
      }
      socket.on('data', onData)
      socket.once('end', onEnd)
      socket.once('close', onEnd)
      try {
        socket.resume()
      } catch {
        // ignore
      }
    }),
  )
}

function parseHead(headText) {
  const lines = String(headText || '').split(/\r?\n/)
  const statusLine = lines.shift() || ''
  const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine)
  if (!match) throw new ApiError(`上游返回了无法解析的响应行：${truncate(statusLine, 120)}`, 'PROVIDER', 502)
  const headers = {}
  for (const line of lines) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const name = line.slice(0, index).trim().toLowerCase()
    const value = line.slice(index + 1).trim()
    if (!name) continue
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value
  }
  return { statusCode: Number(match[1]), statusLine, headers }
}

async function writeAll(socket, buffer, state, label) {
  if (!buffer || buffer.length === 0) return
  await raceFailure(
    state,
    new Promise((resolve) => {
      socket.write(buffer, () => resolve())
    }),
  ).catch((error) => {
    throw error
  })
  try {
    void label
  } catch {
    // ignore
  }
}

function readFixedBody(socket, state, initial, expected, label) {
  return raceFailure(
    state,
    new Promise((resolve) => {
      let chunks = initial && initial.length ? [Buffer.from(initial)] : []
      let size = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      if (size >= expected) {
        socket.destroy()
        resolve(Buffer.concat(chunks).subarray(0, expected))
        return
      }
      const finish = (ok) => {
        socket.removeListener('data', onData)
        socket.removeListener('end', onEnd)
        socket.removeListener('close', onEnd)
        if (!ok) {
          state.fail(normalizeNetworkError(new Error('响应体提前结束'), label))
          return
        }
        resolve(Buffer.concat(chunks).subarray(0, expected))
      }
      const onData = (chunk) => {
        chunks.push(chunk)
        size += chunk.length
        if (size >= expected) {
          try {
            socket.destroy()
          } catch {
            // ignore
          }
          finish(true)
        }
      }
      const onEnd = () => finish(size >= expected)
      const cleanup = () => {
        socket.removeListener('data', onData)
        socket.removeListener('end', onEnd)
        socket.removeListener('close', onEnd)
      }
      socket.on('data', onData)
      socket.once('end', onEnd)
      socket.once('close', onEnd)
      try {
        socket.resume()
      } catch {
        // ignore
      }
      void cleanup
    }),
  )
}

function readUntilCloseBody(socket, state, initial, label) {
  return raceFailure(
    state,
    new Promise((resolve) => {
      const chunks = initial && initial.length ? [Buffer.from(initial)] : []
      let size = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const onData = (chunk) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          cleanup()
          state.fail(new ApiError('上游响应体过大', 'PROVIDER', 502))
          return
        }
        chunks.push(chunk)
      }
      const finish = () => {
        cleanup()
        resolve(Buffer.concat(chunks))
      }
      const cleanup = () => {
        socket.removeListener('data', onData)
        socket.removeListener('end', finish)
        socket.removeListener('close', finish)
      }
      socket.on('data', onData)
      socket.once('end', finish)
      socket.once('close', finish)
      try {
        socket.resume()
      } catch {
        // ignore
      }
      void label
    }),
  )
}

function readChunkedBody(socket, state, initial, label) {
  return raceFailure(
    state,
    new Promise((resolve) => {
      let buffer = initial && initial.length ? Buffer.from(initial) : Buffer.alloc(0)
      const chunks = []
      let size = 0
      let done = false
      const consume = () => {
        for (;;) {
          if (done) return
          const lineEnd = buffer.indexOf('\r\n')
          if (lineEnd < 0) return
          const sizeLine = buffer.subarray(0, lineEnd).toString('latin1').split(';')[0].trim()
          const chunkSize = Number.parseInt(sizeLine, 16)
          if (!Number.isFinite(chunkSize) || chunkSize < 0) {
            cleanup()
            state.fail(new ApiError('上游返回了无法解析的分块响应', 'PROVIDER', 502))
            return
          }
          if (buffer.length < lineEnd + 2 + chunkSize + 2) return
          const chunk = buffer.subarray(lineEnd + 2, lineEnd + 2 + chunkSize)
          buffer = buffer.subarray(lineEnd + 2 + chunkSize + 2)
          if (chunkSize === 0) {
            done = true
            cleanup()
            resolve(Buffer.concat(chunks))
            return
          }
          chunks.push(chunk)
          size += chunkSize
          if (size > MAX_BODY_BYTES) {
            cleanup()
            state.fail(new ApiError('上游响应体过大', 'PROVIDER', 502))
            return
          }
        }
      }
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk])
        consume()
      }
      const onEnd = () => {
        cleanup()
        state.fail(normalizeNetworkError(new Error('分块响应提前结束'), label))
      }
      const cleanup = () => {
        socket.removeListener('data', onData)
        socket.removeListener('end', onEnd)
        socket.removeListener('close', onEnd)
      }
      socket.on('data', onData)
      socket.once('end', onEnd)
      socket.once('close', onEnd)
      consume()
      try {
        socket.resume()
      } catch {
        // ignore
      }
    }),
  )
}

async function readResponseBody(socket, head, method, state, label) {
  if (method === 'HEAD' || head.statusCode === 204 || head.statusCode === 304) {
    try {
      socket.destroy()
    } catch {
      // ignore
    }
    return Buffer.alloc(0)
  }
  const transferEncoding = String(head.headers['transfer-encoding'] || '').toLowerCase()
  if (transferEncoding.includes('chunked')) {
    return readChunkedBody(socket, state, head.rest, label)
  }
  const contentLength = head.headers['content-length']
  if (contentLength !== undefined && String(contentLength).trim() !== '') {
    const expected = Number.parseInt(String(contentLength), 10)
    if (Number.isFinite(expected) && expected >= 0) return readFixedBody(socket, state, head.rest, expected, label)
  }
  return readUntilCloseBody(socket, state, head.rest, label)
}

/* ------------------------------------------------------------------ */
/* Request construction                                                */
/* ------------------------------------------------------------------ */

function targetPort(target) {
  if (target.port) return Number(target.port)
  return target.protocol === 'https:' ? 443 : 80
}

function originFormPath(target) {
  const pathname = target.pathname || '/'
  return `${pathname}${target.search || ''}`
}

function absoluteFormUrl(target) {
  return `${target.protocol}//${target.hostname}:${targetPort(target)}${originFormPath(target)}`
}

function buildHeaderLines(headers) {
  const lines = []
  for (const [name, value] of Object.entries(headers || {})) {
    if (value === undefined || value === null || value === '') continue
    lines.push(`${name}: ${value}`)
  }
  return lines
}

function hasHeader(headers, name) {
  const needle = String(name).toLowerCase()
  return Object.keys(headers || {}).some((key) => String(key).toLowerCase() === needle)
}

function normalizeRequestBody(body) {
  if (body === undefined || body === null) return Buffer.alloc(0)
  if (Buffer.isBuffer(body)) return body
  if (body instanceof Uint8Array) return Buffer.from(body)
  return Buffer.from(String(body), 'utf8')
}

/**
 * Execute one HTTP request through the proxy (single hop, no redirects).
 * Returns { statusCode, headers, body } with the body fully read.
 */
async function executeOnce(target, proxy, options, state) {
  const method = String(options.method || 'GET').toUpperCase()
  const body = normalizeRequestBody(options.body)
  const label = `代理 ${proxy.label}`
  let socket
  let tlsToTarget = false

  if (target.protocol === 'https:') {
    // 1) TCP/TLS to the proxy, 2) CONNECT tunnel, 3) TLS to the target.
    const proxySocket = await openSocket(proxy, state, proxy.protocol === 'https:', label)
    socket = proxySocket
    const connectLines = [
      `CONNECT ${target.hostname}:${targetPort(target)} HTTP/1.1`,
      `Host: ${target.hostname}:${targetPort(target)}`,
      'Proxy-Connection: keep-alive',
    ]
    if (proxy.authHeader) connectLines.push(`Proxy-Authorization: ${proxy.authHeader}`)
    connectLines.push('', '')
    await writeAll(proxySocket, Buffer.from(connectLines.join('\r\n'), 'latin1'), state, label)
    const connectHead = await readHead(proxySocket, state, label)
    if (connectHead.statusCode === 407) {
      throw new ApiError(
        '代理需要认证（HTTP 407），请在代理地址中填写 user:pass@host:port',
        'AUTH',
        407,
      )
    }
    if (connectHead.statusCode !== 200) {
      throw new ApiError(`代理 CONNECT 隧道建立失败（HTTP ${connectHead.statusCode}）`, 'NETWORK', 502)
    }
    // Hand any tunnel bytes we already read back to the socket, then layer TLS.
    try {
      if (connectHead.rest && connectHead.rest.length) proxySocket.unshift(connectHead.rest)
      proxySocket.resume()
    } catch {
      // ignore
    }
    const tlsSocket = tls.connect(
      net.isIP(target.hostname)
        ? { socket: proxySocket }
        : { socket: proxySocket, servername: target.hostname },
    )
    state.sockets.push(tlsSocket)
    attachSocketErrorHandling(tlsSocket, state, `TLS ${target.hostname}`)
    await raceFailure(
      state,
      new Promise((resolve, reject) => {
        tlsSocket.once('secureConnect', resolve)
        tlsSocket.once('error', (error) =>
          reject(normalizeNetworkError(error, `TLS 握手失败（${target.hostname}）`)),
        )
      }),
    )
    socket = tlsSocket
    tlsToTarget = true
  } else {
    socket = await openSocket(proxy, state, proxy.protocol === 'https:', label)
  }

  const headers = { ...(options.headers || {}) }
  const headerLines = [`${method} ${tlsToTarget ? originFormPath(target) : absoluteFormUrl(target)} HTTP/1.1`]
  if (!hasHeader(headers, 'host')) headerLines.push(`Host: ${target.hostname}:${targetPort(target)}`)
  if (proxy.authHeader) headerLines.push(`Proxy-Authorization: ${proxy.authHeader}`)
  if (!hasHeader(headers, 'connection')) headerLines.push('Connection: close')
  if (body.length > 0 && !hasHeader(headers, 'content-length')) headerLines.push(`Content-Length: ${body.length}`)
  for (const line of buildHeaderLines(headers)) headerLines.push(line)
  headerLines.push('', '')
  await writeAll(socket, Buffer.concat([Buffer.from(headerLines.join('\r\n'), 'latin1'), body]), state, label)
  const head = await readHead(socket, state, label)
  if (head.statusCode === 407) {
    socket.destroy()
    throw new ApiError(
      '代理需要认证（HTTP 407），请在代理地址中填写 user:pass@host:port',
      'AUTH',
      407,
    )
  }
  const responseBody = await readResponseBody(socket, head, method, state, label)
  try {
    socket.destroy()
  } catch {
    // ignore
  }
  return { statusCode: head.statusCode, headers: head.headers, body: responseBody }
}

/**
 * Proxy request entry point. Returns the same shape provider.js expects from
 * its direct HTTP transport:
 *   { status, ok, headers, contentType, body: Buffer, elapsedMs }
 */
export async function proxyRequest(rawUrl, options = {}, opts = {}) {
  const proxy = parseProxyUrl(opts.proxyUrl)
  if (!proxy) {
    throw new ApiError('代理地址无效，请重新配置网络代理', 'INVALID_REQUEST', 400)
  }
  let target
  try {
    target = new URL(String(rawUrl))
  } catch {
    throw new ApiError(`上游地址无效：${truncate(String(rawUrl), 120)}`, 'NETWORK', 502)
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new ApiError(`仅支持 http/https 上游地址：${truncate(String(rawUrl), 120)}`, 'NETWORK', 502)
  }
  const state = createState(opts)
  const startedAt = Date.now()
  let currentTarget = target
  let currentOptions = { ...options }
  try {
    for (let redirects = 0; ; redirects += 1) {
      const result = await executeOnce(currentTarget, proxy, currentOptions, state)
      const location = result.headers?.location
      const redirectStatus = [301, 302, 303, 307, 308].includes(result.statusCode)
      if (redirectStatus && location && redirects < MAX_REDIRECTS) {
        let nextTarget
        try {
          nextTarget = new URL(location, currentTarget)
        } catch {
          nextTarget = null
        }
        if (nextTarget) {
          const downgrade =
            result.statusCode === 303 ||
            ([301, 302].includes(result.statusCode) &&
              String(currentOptions.method || 'GET').toUpperCase() !== 'GET' &&
              String(currentOptions.method || 'GET').toUpperCase() !== 'HEAD')
          currentTarget = nextTarget
          if (downgrade) {
            const nextHeaders = { ...(currentOptions.headers || {}) }
            delete nextHeaders['content-type']
            delete nextHeaders['Content-Type']
            delete nextHeaders['content-length']
            delete nextHeaders['Content-Length']
            currentOptions = { ...currentOptions, method: 'GET', body: undefined, headers: nextHeaders }
          }
          continue
        }
      }
      return {
        status: result.statusCode,
        ok: result.statusCode >= 200 && result.statusCode < 300,
        headers: result.headers || {},
        contentType: String(result.headers?.['content-type'] || ''),
        body: result.body,
        elapsedMs: Date.now() - startedAt,
      }
    }
  } finally {
    state.cleanup()
  }
}

/* ------------------------------------------------------------------ */
/* System proxy detection (proxy.detect RPC)                           */
/* ------------------------------------------------------------------ */

/** Run a console program and return its RAW stdout buffer (never lossy-decoded). */
function execFileBuffer(file, args, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    try {
      execFile(
        file,
        args,
        { timeout: timeoutMs, windowsHide: true, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 },
        (error, stdout) => {
          if (error) reject(error)
          else resolve(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout || ''))
        },
      )
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * Decode Windows console output that may be OEM/GBK encoded (reg.exe, etc.):
 * try strict UTF-8 first; if replacement characters appear, fall back to GBK
 * (Node ships full ICU). Never throws.
 */
export function decodeWindowsConsoleOutput(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || [])
  const utf8 = data.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    if (typeof TextDecoder === 'function') {
      const gbk = new TextDecoder('gbk', { fatal: false }).decode(data)
      if (!gbk.includes('\uFFFD')) return gbk
      return gbk
    }
  } catch {
    // fall through to utf8
  }
  return utf8
}

function normalizeDetectedProxyUrl(value) {
  let text = String(value || '').trim()
  if (!text) return ''
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`
  try {
    return validateProxyUrl(text)
  } catch {
    return ''
  }
}

function parseWindowsProxyServer(value) {
  const text = String(value || '').trim()
  if (!text) return ''
  const entries = {}
  if (text.includes('=')) {
    for (const part of text.split(';')) {
      const index = part.indexOf('=')
      if (index > 0) entries[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim()
    }
  } else {
    entries.https = text
    entries.http = text
  }
  const chosen = entries.https || entries.http
  return chosen ? normalizeDetectedProxyUrl(chosen) : ''
}

async function detectWindowsRegistryProxy() {
  if (process.platform !== 'win32') return null
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
  const stdout = decodeWindowsConsoleOutput(await execFileBuffer('reg', ['query', key]))
  const values = {}
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s+(\S+)\s+(REG_[A-Z_]+)\s+(.*)$/.exec(line)
    if (match) values[match[1]] = match[3].trim()
  }
  const enabled = /^(0x)?1$/i.test(String(values.ProxyEnable || ''))
  if (!enabled) return null
  const url = parseWindowsProxyServer(values.ProxyServer)
  return url ? { url, source: 'registry:HKCU' } : null
}

/* ------------------------------------------------------------------ */
/* System proxy detection (proxy.detect RPC)                           */
/* ------------------------------------------------------------------ */

/**
 * v1.10: common local HTTP-proxy ports of popular clients on Windows.
 * Scan order doubles as tie-break priority for equally verified candidates.
 * Tests override the list with IW_PROXY_SCAN_PORTS.
 */
const COMMON_LOCAL_PROXY_PORTS = [
  12001, // iKuuu VPN mixed port (HTTP CONNECT + SOCKS5)
  12002, // iKuuu VPN alternate listener
  12003, // iKuuu VPN httplib listener
  7890, // Clash / Clash for Windows
  7897, // Clash Verge / Mihomo
  7891, // Clash Verge redir/mixed fallback
  10808, // v2rayN SOCKS
  10809, // v2rayN HTTP
  1080, // generic SOCKS/HTTP
  10801, // v2rayA HTTP
  2080, // sing-box mixed
  2081, // sing-box alternative
  3128, // Squid
  8080,
  8888,
  20171, // Netch mixed
]

const DEFAULT_PROBE_TARGET = 'www.gstatic.com:443'
const PROBE_TIMEOUT_MS = 700
const PROBE_MAX_HEAD_BYTES = 8192

function scanPorts() {
  const raw = String(process.env.IW_PROXY_SCAN_PORTS || '').trim()
  if (!raw) return COMMON_LOCAL_PROXY_PORTS.slice()
  const ports = []
  for (const part of raw.split(',')) {
    const port = Number.parseInt(part.trim(), 10)
    if (Number.isInteger(port) && port > 0 && port < 65536 && !ports.includes(port)) ports.push(port)
  }
  return ports.length ? ports : COMMON_LOCAL_PROXY_PORTS.slice()
}

/** Build the CONNECT probe target from the configured image API base URL. */
export function probeTargetForBaseUrl(baseUrl) {
  try {
    const parsed = new URL(String(baseUrl || '').trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return DEFAULT_PROBE_TARGET
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80')
    return `${parsed.hostname}:${port}`
  } catch {
    return DEFAULT_PROBE_TARGET
  }
}

/**
 * Probe one local proxy port: TCP connect, then an HTTP CONNECT handshake to
 * `target`. Answers `{ reachable, verified, needsAuth, status?, error? }` —
 * verified means the proxy answered `200 Connection established`, which is the
 * exact capability this plugin uses. Never throws.
 */
export function probeProxyPort(port, target = DEFAULT_PROBE_TARGET, timeoutMs = PROBE_TIMEOUT_MS) {
  const numericPort = Number(port)
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    return Promise.resolve({ reachable: false, verified: false, error: 'invalid-port' })
  }
  return new Promise((resolve) => {
    let settled = false
    let head = Buffer.alloc(0)
    const socket = net.connect({ host: '127.0.0.1', port: numericPort })
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.destroy()
      } catch {
        // ignore
      }
      resolve(result)
    }
    const timer = setTimeout(
      () => finish({ reachable: false, verified: false, error: 'timeout' }),
      Math.max(150, Number(timeoutMs) || PROBE_TIMEOUT_MS),
    )
    try {
      socket.setNoDelay(true)
    } catch {
      // ignore
    }
    socket.once('connect', () => {
      const [host, portText] = String(target || DEFAULT_PROBE_TARGET).split(':')
      const authority = `${host}:${portText || '443'}`
      const lines = [`CONNECT ${authority} HTTP/1.1`, `Host: ${authority}`, 'Proxy-Connection: keep-alive', '', '']
      try {
        socket.write(lines.join('\r\n'))
      } catch {
        finish({ reachable: false, verified: false, error: 'write-failed' })
      }
    })
    socket.on('data', (chunk) => {
      head = Buffer.concat([head, chunk])
      const end = head.indexOf('\r\n\r\n')
      if (end < 0) {
        if (head.length > PROBE_MAX_HEAD_BYTES) finish({ reachable: true, verified: false, error: 'head-too-large' })
        return
      }
      const statusLine = head.subarray(0, end).toString('latin1').split(/\r?\n/)[0] || ''
      const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine)
      if (!match) {
        finish({ reachable: true, verified: false, error: 'not-http-proxy' })
        return
      }
      const status = Number(match[1])
      finish({
        reachable: true,
        verified: status === 200,
        needsAuth: status === 407,
        status,
      })
    })
    socket.on('error', (error) => finish({ reachable: false, verified: false, error: String(error?.code || 'connect-failed') }))
  })
}

function proxyHostOf(rawUrl) {
  const parsed = parseProxyUrl(rawUrl)
  if (!parsed) return { hostname: '', port: 0 }
  return { hostname: parsed.hostname, port: parsed.port }
}

/**
 * Read-only proxy detection + local port scan (CONTRACT 补丁 v1.10).
 * Never throws. Returns:
 *   { candidates: [{ url, source, verified, needsAuth?, reachable, status? }],
 *     platform, target, scannedAt }
 * Candidates are ordered verified-first, then needsAuth, then reachable-only.
 */
export async function detectProxy(options = {}) {
  const target = probeTargetForBaseUrl(options && options.baseUrl)
  const candidates = []
  const seen = new Set()
  const add = (url, source) => {
    const normalized = normalizeDetectedProxyUrl(url)
    if (!normalized || seen.has(normalized)) return
    seen.add(normalized)
    candidates.push({ url: normalized, source })
  }
  try {
    const registry = await detectWindowsRegistryProxy()
    if (registry) add(registry.url, registry.source)
  } catch {
    // registry detection is best-effort
  }
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    try {
      const value = process.env[name]
      if (value) add(value, `env:${name}`)
    } catch {
      // ignore
    }
  }
  for (const port of scanPorts()) add(`http://127.0.0.1:${port}`, `local-port:${port}`)

  const probed = await Promise.all(
    candidates.map(async (candidate) => {
      const { hostname, port } = proxyHostOf(candidate.url)
      if (!hostname || !port) return { ...candidate, reachable: false, verified: false }
      const result = await probeProxyPort(port, target)
      return { ...candidate, ...result }
    }),
  )
  const score = (item) => (item.verified ? 0 : item.needsAuth ? 1 : item.reachable ? 2 : 3)
  probed.forEach((item, index) => {
    item.__index = index
  })
  probed.sort((left, right) => score(left) - score(right) || left.__index - right.__index)
  for (const item of probed) delete item.__index
  return {
    candidates: probed,
    platform: process.platform,
    target,
    scannedAt: new Date().toISOString(),
  }
}
