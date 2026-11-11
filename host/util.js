/**
 * Shared helpers for the AI image workbench host half.
 *
 * Loaded with a `?rev=` query by every other host module so that editing any
 * file is picked up on the next HTTP request (the stable shim re-imports
 * `host/main.js` with a fresh query every request).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * Rejection carrying the CONTRACT.md error envelope semantics:
 *   message (Chinese, user facing), code (AUTH/…), http status.
 */
export class ApiError extends Error {
  constructor(message, code = 'INVALID_REQUEST', status = 400) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export function toApiError(error, fallbackMessage = '服务器内部错误', fallbackStatus = 500) {
  if (error instanceof ApiError) return error
  const message = String(error?.message || error || fallbackMessage)
  return new ApiError(`${fallbackMessage}：${truncate(message, 200)}`, 'PROVIDER', fallbackStatus)
}

/* ------------------------------------------------------------------ */
/* Basic values                                                        */
/* ------------------------------------------------------------------ */

export function nowIso() {
  return new Date().toISOString()
}

export function truncate(value, max = 300) {
  const text = String(value == null ? '' : value)
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

export const ID_RE = /^(ws|conv|turn|img|up)_[0-9a-f]{8}$/

/* ------------------------------------------------------------------ */
/* Job timeout (CONTRACT 补丁 v1.1 §6)                                 */
/* ------------------------------------------------------------------ */

export const JOB_TIMEOUT_DEFAULT_MS = 300000
export const JOB_TIMEOUT_MIN_MS = 10000
export const JOB_TIMEOUT_MAX_MS = 600000
/** Watchdog reaps a running job once it exceeds jobTimeoutMs + 30s. */
export const JOB_TIMEOUT_GRACE_MS = 30000
/** cancelJob force-finalizes when the upstream ignores the abort. */
export const CANCEL_GRACE_MS = 5000

/** Clamp a user/provider-supplied job timeout to 10s..600s (default 240s). */
export function normalizeJobTimeoutMs(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return JOB_TIMEOUT_DEFAULT_MS
  return Math.min(JOB_TIMEOUT_MAX_MS, Math.max(JOB_TIMEOUT_MIN_MS, Math.round(number)))
}

export function newId(prefix) {
  let body = ''
  try {
    body = randomUUID().replace(/-/g, '').slice(0, 8).toLowerCase()
  } catch {
    body = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
  }
  return `${prefix}_${body}`
}

export function isId(value, prefix) {
  if (typeof value !== 'string') return false
  if (prefix) return new RegExp(`^${prefix}_[0-9a-f]{8}$`).test(value)
  return ID_RE.test(value)
}

/** Create an id that passes `exists` (async) — collisions are retried. */
export async function newUniqueId(prefix, exists) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = newId(prefix)
    if (!exists || !(await exists(id))) return id
  }
  throw new ApiError('无法分配新的 ID，请重试', 'INVALID_REQUEST', 500)
}

export function assertId(value, prefix, label) {
  if (!isId(value, prefix)) throw new ApiError(`${label}无效`, 'INVALID_REQUEST', 400)
  return value
}

export function assertNonEmptyString(value, label, { max = 200, min = 1 } = {}) {
  if (typeof value !== 'string') throw new ApiError(`${label}（字符串）无效`, 'INVALID_REQUEST', 400)
  const text = value.trim()
  if (text.length < min) throw new ApiError(`${label}不能为空`, 'INVALID_REQUEST', 400)
  if (text.length > max) throw new ApiError(`${label}不能超过 ${max} 个字符`, 'INVALID_REQUEST', 400)
  return text
}

export function optionalString(value, label, { max = 200 } = {}) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new ApiError(`${label}（字符串）无效`, 'INVALID_REQUEST', 400)
  const text = value.trim()
  if (text.length > max) throw new ApiError(`${label}不能超过 ${max} 个字符`, 'INVALID_REQUEST', 400)
  return text
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

export function sendJson(res, status, payload) {
  if (res.headersSent) {
    try {
      res.end()
    } catch {
      // ignore
    }
    return
  }
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(body)
}

/** Read a request body into a Buffer, rejecting when over `limit` bytes. */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      try {
        req.destroy()
      } catch {
        // ignore
      }
      reject(error)
    }
    req.on('data', (chunk) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > limit) {
        fail(new ApiError('请求内容过大', 'INVALID_REQUEST', 413))
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    req.on('error', (error) => fail(error))
    req.on('aborted', () => fail(new ApiError('请求已中断', 'INVALID_REQUEST', 400)))
  })
}

export async function readJsonBody(req, limit) {
  const raw = await readBody(req, limit)
  if (raw.length === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new ApiError('请求体不是合法的 JSON', 'INVALID_REQUEST', 400)
  }
  if (!isPlainObject(parsed)) throw new ApiError('请求体必须是 JSON 对象', 'INVALID_REQUEST', 400)
  return parsed
}

/* ------------------------------------------------------------------ */
/* Base64 / data URI                                                   */
/* ------------------------------------------------------------------ */

/** Decode plain base64 or a `data:*;base64,` payload into a Buffer. */
export function decodeBase64Payload(data, label = '图片数据') {
  if (typeof data !== 'string' || data.length === 0) {
    throw new ApiError(`${label}（base64）无效`, 'INVALID_REQUEST', 400)
  }
  let raw = data.trim()
  if (raw.startsWith('data:')) {
    const comma = raw.indexOf(',')
    if (comma < 0) throw new ApiError(`${label}（base64）无效`, 'INVALID_REQUEST', 400)
    raw = raw.slice(comma + 1)
  }
  raw = raw.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
    throw new ApiError(`${label}不是合法的 base64`, 'INVALID_REQUEST', 400)
  }
  const bytes = Buffer.from(raw, 'base64')
  if (bytes.length === 0) throw new ApiError(`${label}为空`, 'INVALID_REQUEST', 400)
  return bytes
}

export function toDataUri(mime, bytes) {
  return `data:${mime || 'image/png'};base64,${Buffer.from(bytes).toString('base64')}`
}

/* ------------------------------------------------------------------ */
/* Image sniffing                                                      */
/* ------------------------------------------------------------------ */

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const SUPPORTED_UPLOAD_MIMES = ['image/png', 'image/jpeg', 'image/webp']

export function extForMime(mime) {
  return EXT_BY_MIME[String(mime || '').toLowerCase()] || 'png'
}

export function mimeForFileName(fileName) {
  return MIME_BY_EXT[path.extname(String(fileName || '')).toLowerCase()] || ''
}

/** Detect the image mime type from magic bytes; '' when unknown. */
export function detectMime(bytes) {
  if (!bytes || bytes.length < 2) return ''
  const head = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png'
  }
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg'
  if (head.length >= 6) {
    const ascii = head.toString('ascii', 0, 6)
    if (ascii === 'GIF87a' || ascii === 'GIF89a') return 'image/gif'
  }
  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return ''
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function pngSize(bytes) {
  if (bytes.length < 24) return null
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) }
}

function gifSize(bytes) {
  if (bytes.length < 10) return null
  return { w: bytes.readUInt16LE(6), h: bytes.readUInt16LE(8) }
}

function jpegSize(bytes) {
  let offset = 2
  const length = bytes.length
  while (offset + 9 < length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === 0xff) {
      offset += 1
      continue
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2
      continue
    }
    const segmentLength = bytes.readUInt16BE(offset + 2)
    if (segmentLength < 2) return null
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      return { h: bytes.readUInt16BE(offset + 5), w: bytes.readUInt16BE(offset + 7) }
    }
    offset += 2 + segmentLength
  }
  return null
}

function webpSize(bytes) {
  if (bytes.length < 30) return null
  const fourcc = bytes.toString('ascii', 12, 16)
  if (fourcc === 'VP8X') {
    return { w: 1 + readUInt24LE(bytes, 24), h: 1 + readUInt24LE(bytes, 27) }
  }
  if (fourcc === 'VP8L') {
    if (bytes[20] !== 0x2f) return null
    const b0 = bytes[21]
    const b1 = bytes[22]
    const b2 = bytes[23]
    const b3 = bytes[24]
    return {
      w: 1 + (((b1 & 0x3f) << 8) | b0),
      h: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    }
  }
  if (fourcc === 'VP8 ') {
    const end = Math.min(bytes.length - 9, 44)
    for (let offset = 20; offset < end; offset += 1) {
      if (bytes[offset] === 0x9d && bytes[offset + 1] === 0x01 && bytes[offset + 2] === 0x2a) {
        return {
          w: bytes.readUInt16LE(offset + 3) & 0x3fff,
          h: bytes.readUInt16LE(offset + 5) & 0x3fff,
        }
      }
    }
    return null
  }
  return null
}

/**
 * Parse image dimensions from magic bytes. Returns `{w:0,h:0}` when unknown —
 * generation keeps going, the UI simply renders a plain card.
 */
export function imageSize(bytes, mime) {
  try {
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const type = mime || detectMime(buffer)
    let size = null
    if (type === 'image/png') size = pngSize(buffer)
    else if (type === 'image/jpeg') size = jpegSize(buffer)
    else if (type === 'image/webp') size = webpSize(buffer)
    else if (type === 'image/gif') size = gifSize(buffer)
    if (!size || !Number.isFinite(size.w) || !Number.isFinite(size.h)) return { w: 0, h: 0 }
    return { w: Math.max(0, Math.round(size.w)), h: Math.max(0, Math.round(size.h)) }
  } catch {
    return { w: 0, h: 0 }
  }
}

/* ------------------------------------------------------------------ */
/* Log files                                                           */
/* ------------------------------------------------------------------ */

const LOG_MAX_BYTES = 4 * 1024 * 1024
const LOG_KEEP_BYTES = 1024 * 1024

/** Append one line to a log file; truncate the file when it exceeds ~4MB. */
export async function appendLogLine(file, line) {
  const text = String(line == null ? '' : line)
  const value = `${text.endsWith('\n') ? text : `${text}\n`}`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, value, 'utf8')
    const info = await fs.stat(file)
    if (info.size > LOG_MAX_BYTES) {
      const raw = await fs.readFile(file, 'utf8')
      const kept = raw.slice(Math.max(0, raw.length - LOG_KEEP_BYTES))
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(tmp, `…（日志已截断）\n${kept}`, 'utf8')
      await fs.rename(tmp, file)
    }
  } catch {
    // Logging must never break a request.
  }
}
