/**
 * Disk store for the AI image workbench host half.
 *
 * Layout (CONTRACT.md §3):
 *   <DSH_HOME>/dsh-creation-workbench/
 *     settings.json
 *     workspaces.json
 *     data/<wsId>/<convId>.json
 *     images/<wsId>/<convId>/<imgId>.<ext>
 *     uploads/<upId>.<ext>
 *     logs/client.log, logs/host.log
 *
 * All JSON writes are atomic (tmp + rename) and serialized per file through
 * `withLock`; the lock table lives on globalThis so a hot-reloaded host module
 * never races itself.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const proxy = await import(`./proxy.js?rev=${encodeURIComponent(REV)}`)
const {
  ApiError,
  nowIso,
  newId,
  newUniqueId,
  isId,
  isPlainObject,
  assertId,
  assertNonEmptyString,
  optionalString,
  detectMime,
  extForMime,
  imageSize,
  mimeForFileName,
  truncate,
  decodeBase64Payload,
  SUPPORTED_UPLOAD_MIMES,
  appendLogLine,
  normalizeJobTimeoutMs,
  JOB_TIMEOUT_DEFAULT_MS,
} = util

/* ------------------------------------------------------------------ */
/* Locations + shared mutable state                                    */
/* ------------------------------------------------------------------ */

export const PLUGIN_DIR_NAME = 'dsh-creation-workbench'
export const LEGACY_PLUGIN_DIR_NAME = 'dsh-image-workbench'
export const API_PREFIX = '/dsh-creation-workbench/'
export const DEFAULT_WORKSPACE_NAME = '默认工作区'
export const DEFAULT_CONVERSATION_TITLE = '新会话'
export const AUTOTITLE_MAX = 24
export const LIMITS = { maxN: 4, maxUploadBytes: 20 * 1024 * 1024 }

function resolveDshHome() {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home.trim().length > 0) return path.resolve(home.trim())
  return path.join(os.homedir(), '.dsh')
}

export const DSH_HOME = resolveDshHome()
export const DATA_DIR = path.join(DSH_HOME, PLUGIN_DIR_NAME)
const LEGACY_DATA_DIR = path.join(DSH_HOME, LEGACY_PLUGIN_DIR_NAME)
const MIGRATION_MARKER = path.join(DATA_DIR, '.migrated-from-image-workbench')

/**
 * v2.0.0 rename migration: the plugin used to store everything under
 * `dsh-image-workbench`. On first load, copy that directory to the new one so
 * workflows / settings / conversations / images survive the rename. The copy is
 * kept (never deleted) because old conversation records may still hold absolute
 * paths pointing into the legacy directory.
 */
async function migrateLegacyData() {
  try {
    if (await pathExists(DATA_DIR)) return
    if (!(await pathExists(LEGACY_DATA_DIR))) return
    await fs.cp(LEGACY_DATA_DIR, DATA_DIR, { recursive: true, force: false, errorOnExist: false })
    await fs.writeFile(
      MIGRATION_MARKER,
      `migrated from ${LEGACY_DATA_DIR} at ${new Date().toISOString()}\n`,
      'utf8',
    )
  } catch {
    // Data migration must never prevent the plugin from starting.
  }
}

await migrateLegacyData()

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const WORKSPACES_FILE = path.join(DATA_DIR, 'workspaces.json')
const DATA_ROOT = path.join(DATA_DIR, 'data')
const IMAGES_ROOT = path.join(DATA_DIR, 'images')
const UPLOADS_ROOT = path.join(DATA_DIR, 'uploads')
const LOGS_ROOT = path.join(DATA_DIR, 'logs')
const TRASH_ROOT = path.join(DATA_ROOT, '.trash')

/**
 * CONTRACT.md §2: mutable state HAS to live on globalThis, otherwise every
 * request-triggered re-import would drop running jobs and the image registry.
 */
const STATE_KEY = '__dshImageWorkbench'
const STATE = (() => {
  const existing = globalThis[STATE_KEY]
  if (existing && typeof existing === 'object') {
    if (!(existing.jobs instanceof Map)) existing.jobs = new Map()
    if (!(existing.locks instanceof Map)) existing.locks = new Map()
    if (existing.registry === undefined) existing.registry = null
    if (typeof existing.seq !== 'number') existing.seq = 0
    return existing
  }
  const fresh = { jobs: new Map(), locks: new Map(), registry: null, seq: 0 }
  globalThis[STATE_KEY] = fresh
  return fresh
})()

export { STATE }

export function dataDir() {
  return DATA_DIR
}

export function settingsFilePath() {
  return SETTINGS_FILE
}

export function hostLogPath() {
  return path.join(LOGS_ROOT, 'host.log')
}

export function clientLogPath() {
  return path.join(LOGS_ROOT, 'client.log')
}

export async function logHost(message) {
  await appendLogLine(hostLogPath(), `${nowIso()} ${String(message)}`)
}

export async function logClient(level, message) {
  const safeLevel = truncate(String(level || 'info').toLowerCase(), 20)
  await appendLogLine(clientLogPath(), `${nowIso()} [${safeLevel}] ${truncate(String(message ?? ''), 4000)}`)
}

/* ------------------------------------------------------------------ */
/* Locks                                                               */
/* ------------------------------------------------------------------ */

/** Run `task` after every previously queued task with the same key. */
export function withLock(key, task) {
  const previous = STATE.locks.get(key) || Promise.resolve()
  const run = previous.catch(() => {}).then(task)
  const settled = run.catch(() => {})
  STATE.locks.set(key, settled)
  settled.then(() => {
    if (STATE.locks.get(key) === settled) STATE.locks.delete(key)
  })
  return run
}

/* ------------------------------------------------------------------ */
/* Atomic file helpers                                                 */
/* ------------------------------------------------------------------ */

export async function pathExists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function readJsonFile(file, fallback = null) {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  try {
    await fs.rename(tmp, file)
  } catch (error) {
    try {
      await fs.rm(tmp, { force: true })
    } catch {
      // ignore
    }
    throw error
  }
}

async function moveToTrash(absolutePath, trashRoot = TRASH_ROOT) {
  try {
    await fs.mkdir(trashRoot, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = path.join(trashRoot, `${stamp}-${path.basename(absolutePath)}`)
    try {
      await fs.rename(absolutePath, target)
    } catch (error) {
      if (error && error.code === 'EXDEV') {
        await fs.cp(absolutePath, target, { recursive: true, force: true })
        await fs.rm(absolutePath, { recursive: true, force: true })
      } else {
        throw error
      }
    }
  } catch {
    // Deleting must not block the main flow (CONTRACT.md §3).
  }
}

async function removePathBestEffort(target) {
  try {
    await fs.rm(target, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const DIALECTS = ['openai-images', 'xai-image', 'auto']
const QUALITIES = ['auto', 'low', 'medium', 'high']
const XAI_QUALITIES = ['auto', 'low', 'medium']
const RESOLUTIONS = ['1k', '2k']

export function defaultSettings() {
  return {
    baseUrl: '',
    apiKey: '',
    // CONTRACT 补丁 v1.2 §1.1: local ComfyUI endpoint ('' = not configured).
    comfyBaseUrl: 'http://127.0.0.1:8188',
    jobTimeoutMs: JOB_TIMEOUT_DEFAULT_MS,
    proxyUrl: '',
    imageDir: '',
    saveDir: '',
    modelCosts: {},
    models: [
      { id: 'gpt-image-2', label: 'GPT Image 2', dialect: 'openai-images' },
      { id: 'grok-imagine-image-2.0', label: 'Grok Imagine 2.0', dialect: 'xai-image' },
    ],
    defaults: {
      model: 'gpt-image-2',
      size: '1024x1024',
      quality: 'auto',
      aspectRatio: '16:9',
      resolution: '1k',
      n: 1,
    },
    ui: {
      activeWorkspaceId: null,
      activeConversationId: null,
      lastParams: null,
    },
  }
}

function normalizeModels(models) {
  if (!Array.isArray(models)) return defaultSettings().models
  const seen = new Set()
  const out = []
  for (const item of models) {
    if (!isPlainObject(item)) continue
    const id = optionalString(item.id, '模型 ID', { max: 200 })
    if (!id || seen.has(id)) continue
    seen.add(id)
    const dialect = DIALECTS.includes(item.dialect) ? item.dialect : 'auto'
    const label = optionalString(item.label, '模型名称', { max: 200 }) || id
    out.push({ id, label, dialect })
    if (out.length >= 60) break
  }
  return out
}

function normalizeDefaults(defaults) {
  const source = isPlainObject(defaults) ? defaults : {}
  const n = Number(source.n)
  return {
    model: typeof source.model === 'string' ? source.model.trim().slice(0, 200) : '',
    size: typeof source.size === 'string' ? source.size.trim().slice(0, 40) : '',
    quality: QUALITIES.includes(source.quality) ? source.quality : 'auto',
    aspectRatio: typeof source.aspectRatio === 'string' ? source.aspectRatio.trim().slice(0, 20) : 'auto',
    resolution: RESOLUTIONS.includes(source.resolution) ? source.resolution : '1k',
    n: Number.isInteger(n) && n >= 1 && n <= LIMITS.maxN ? n : 1,
  }
}

export const COST_TIERS = ['1K', '2K', '4K']

/** CONTRACT 补丁 v1.8: GPT image 系列模型按输出分辨率分 1K/2K/4K 三档定价。 */
export function isGptImageModel(model) {
  return /gpt[-_ ]?image/i.test(String(model == null ? '' : model))
}

/**
 * Permissive read-path normalization of one modelCosts value (used by
 * normalizeSettings): number stays number; object keeps only 1K/2K/4K with
 * finite ≥0 numbers (missing → 0). Invalid entries return undefined (dropped).
 */
function normalizeCostValue(value) {
  if (isPlainObject(value)) {
    const tiers = {}
    for (const tier of COST_TIERS) {
      const raw = value[tier]
      const num = Number(raw)
      tiers[tier] = Number.isFinite(num) && num >= 0 ? num : 0
    }
    return tiers
  }
  const cost = Number(value)
  if (!Number.isFinite(cost) || cost < 0) return undefined
  return cost
}

/**
 * Strict write-path validation of one modelCosts value (applySettings):
 * throws readable INVALID_REQUEST for negative/non-numeric values.
 */
function parseCostSetting(modelId, value) {
  if (isPlainObject(value)) {
    const tiers = {}
    for (const tier of COST_TIERS) {
      if (!Object.prototype.hasOwnProperty.call(value, tier)) {
        tiers[tier] = 0
        continue
      }
      const raw = value[tier]
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
        throw new ApiError(`模型 ${modelId} 的 ${tier} 档成本必须是不小于 0 的数字`, 'INVALID_REQUEST', 400)
      }
      tiers[tier] = raw
    }
    return tiers
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ApiError(`模型 ${modelId} 的成本必须是不小于 0 的数字`, 'INVALID_REQUEST', 400)
  }
  return value
}

/**
 * CONTRACT 补丁 v1.2 §1.1: ComfyUI base URL normalization.
 * trim; '' stays ''; must start with http(s)://; trailing '/' stripped;
 * never append `/v1` (ComfyUI has no OpenAI-style version prefix).
 */
export function normalizeComfyBaseUrl(raw) {
  if (typeof raw !== 'string') return ''
  const base = raw.trim().replace(/\/+$/, '')
  if (base.length === 0) return ''
  if (!/^https?:\/\//i.test(base)) return ''
  return base
}

export function normalizeSettings(raw) {
  const base = defaultSettings()
  const source = isPlainObject(raw) ? raw : {}
  const ui = isPlainObject(source.ui) ? source.ui : {}
  const modelCosts = {}
  if (isPlainObject(source.modelCosts)) {
    for (const [modelId, value] of Object.entries(source.modelCosts)) {
      const id = String(modelId || '').trim().slice(0, 200)
      if (!id) continue
      const normalized = normalizeCostValue(value)
      if (normalized === undefined) continue
      modelCosts[id] = normalized
      if (Object.keys(modelCosts).length >= 200) break
    }
  }
  return {
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl.trim() : '',
    apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : '',
    // CONTRACT 补丁 v1.2 §1.1: absent field (older settings.json) keeps the
    // default local endpoint; an explicit '' means "not configured".
    comfyBaseUrl: Object.prototype.hasOwnProperty.call(source, 'comfyBaseUrl')
      ? normalizeComfyBaseUrl(source.comfyBaseUrl)
      : base.comfyBaseUrl,
    jobTimeoutMs: normalizeJobTimeoutMs(source.jobTimeoutMs),
    proxyUrl: typeof source.proxyUrl === 'string' ? source.proxyUrl.trim() : '',
    // CONTRACT 补丁 v1.10: first-run proxy onboarding state.
    proxyAuto: source.proxyAuto === true,
    onboardDone: source.onboardDone === true,
    imageDir: typeof source.imageDir === 'string' ? source.imageDir.trim() : '',
    saveDir: typeof source.saveDir === 'string' ? source.saveDir.trim() : '',
    modelCosts,
    models: Array.isArray(source.models) ? normalizeModels(source.models) : base.models,
    defaults: normalizeDefaults({ ...base.defaults, ...(isPlainObject(source.defaults) ? source.defaults : {}) }),
    ui: {
      activeWorkspaceId: typeof ui.activeWorkspaceId === 'string' ? ui.activeWorkspaceId : null,
      activeConversationId: typeof ui.activeConversationId === 'string' ? ui.activeConversationId : null,
      lastParams: isPlainObject(ui.lastParams) ? ui.lastParams : null,
    },
  }
}

export async function readSettingsRaw() {
  const raw = await readJsonFile(SETTINGS_FILE, null)
  return normalizeSettings(raw)
}

async function mutateSettings(mutator) {
  return withLock('settings', async () => {
    const current = await readSettingsRaw()
    const next = normalizeSettings((await mutator(current)) || current)
    await writeJsonAtomic(SETTINGS_FILE, next)
    return next
  })
}

export async function updateSettingsUi(patch) {
  const safePatch = isPlainObject(patch) ? patch : {}
  return mutateSettings((current) => ({
    ...current,
    ui: { ...current.ui, ...safePatch },
  }))
}

export function normalizeBaseUrl(raw) {
  let base = String(raw == null ? '' : raw).trim()
  base = base.replace(/\/+$/, '')
  if (base.length === 0) return ''
  if (!/\/v1($|\/)/.test(base)) base = `${base}/v1`
  return base
}

export function envFallbackSettings() {
  const base = String(process.env.IMAGE_API_BASE || '').trim()
  const key = String(process.env.IMAGE_API_KEY || '').trim()
  return { base, key }
}

function maskApiKey(key) {
  const value = String(key || '')
  if (value.length === 0) return ''
  if (value.length <= 8) return `…${value.slice(-2)}`
  return `${value.slice(0, 3)}…${value.slice(-4)}`
}

/** SafeSettings — CONTRACT.md §3: the API key must never be echoed back. */
export function safeSettings(raw) {
  const settings = normalizeSettings(raw)
  const env = envFallbackSettings()
  const effectiveBase = settings.baseUrl || env.base
  const effectiveKey = settings.apiKey || env.key
  return {
    baseUrl: effectiveBase ? normalizeBaseUrl(effectiveBase) : '',
    apiKeySet: Boolean(effectiveKey),
    apiKeyHint: maskApiKey(effectiveKey),
    // CONTRACT 补丁 v1.2 §1.1: echoed verbatim (no secret involved).
    comfyBaseUrl: settings.comfyBaseUrl,
    jobTimeoutMs: settings.jobTimeoutMs,
    proxyUrl: proxy.maskProxyUrl(settings.proxyUrl),
    proxySet: Boolean(settings.proxyUrl),
    proxyAuto: settings.proxyAuto,
    onboardDone: settings.onboardDone,
    imageDir: settings.imageDir,
    saveDir: settings.saveDir,
    modelCosts: { ...settings.modelCosts },
    models: settings.models.map((model) => ({ id: model.id, label: model.label, dialect: model.dialect })),
    defaults: { ...settings.defaults },
    envFallback: Boolean(env.base || env.key),
  }
}

/** Effective provider config: settings.json wins over IMAGE_API_* env vars. */
export function resolveProviderConfig(rawSettings) {
  const settings = normalizeSettings(rawSettings)
  const env = envFallbackSettings()
  const baseUrl = normalizeBaseUrl(settings.baseUrl || env.base)
  const apiKey = String(settings.apiKey || env.key || '').trim()
  if (!baseUrl || !apiKey) {
    throw new ApiError('请先在设置中填写生图 API 地址与 API Key', 'INVALID_REQUEST', 400)
  }
  // CONTRACT 补丁 v1.2 §1: explicit settings.proxyUrl only; empty = direct,
  // where DSH/global env proxy behavior (if any) applies as before.
  const proxyUrl = proxy.validateProxyUrl(settings.proxyUrl)
  return { baseUrl, apiKey, proxyUrl }
}

export async function applySettings(body) {
  if (!isPlainObject(body)) throw new ApiError('设置参数无效', 'INVALID_REQUEST', 400)
  const next = await mutateSettings(async (current) => {
    const updated = { ...current }
    if (Object.prototype.hasOwnProperty.call(body, 'baseUrl')) {
      if (typeof body.baseUrl !== 'string') throw new ApiError('API 地址必须是字符串', 'INVALID_REQUEST', 400)
      const baseUrl = body.baseUrl.trim().replace(/\/+$/, '')
      if (baseUrl.length > 0 && !/^https?:\/\//i.test(baseUrl)) {
        throw new ApiError('API 地址必须以 http:// 或 https:// 开头', 'INVALID_REQUEST', 400)
      }
      updated.baseUrl = baseUrl
    }
    if (Object.prototype.hasOwnProperty.call(body, 'apiKey')) {
      if (typeof body.apiKey !== 'string') throw new ApiError('API Key 必须是字符串', 'INVALID_REQUEST', 400)
      const apiKey = body.apiKey.trim()
      if (apiKey.length > 0) updated.apiKey = apiKey
    }
    if (body.clearApiKey === true) updated.apiKey = ''
    // CONTRACT 补丁 v1.2 §1.1: local ComfyUI endpoint ('' = not configured).
    if (Object.prototype.hasOwnProperty.call(body, 'comfyBaseUrl')) {
      if (typeof body.comfyBaseUrl !== 'string') {
        throw new ApiError('ComfyUI 服务地址必须是字符串', 'INVALID_REQUEST', 400)
      }
      const comfyBaseUrl = body.comfyBaseUrl.trim().replace(/\/+$/, '')
      if (comfyBaseUrl.length > 0 && !/^https?:\/\//i.test(comfyBaseUrl)) {
        throw new ApiError('ComfyUI 服务地址必须以 http:// 或 https:// 开头', 'INVALID_REQUEST', 400)
      }
      updated.comfyBaseUrl = comfyBaseUrl
    }
    if (Object.prototype.hasOwnProperty.call(body, 'proxyUrl')) {
      // CONTRACT 补丁 v1.2 §1: ''/null clears (direct); only http(s) proxies.
      if (body.proxyUrl === null) updated.proxyUrl = ''
      else updated.proxyUrl = proxy.validateProxyUrl(body.proxyUrl)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'jobTimeoutMs')) {
      const raw = body.jobTimeoutMs
      const number = Number(raw)
      if (raw !== null && raw !== undefined && raw !== '' && !Number.isFinite(number)) {
        throw new ApiError('生成超时必须是数字（毫秒）', 'INVALID_REQUEST', 400)
      }
      // CONTRACT 补丁 v1.1 §6: default 300000ms, clamp 10000..600000.
      updated.jobTimeoutMs = normalizeJobTimeoutMs(Number.isFinite(number) ? number : JOB_TIMEOUT_DEFAULT_MS)
    }
    // CONTRACT 补丁 v1.10: first-run proxy onboarding state.
    if (Object.prototype.hasOwnProperty.call(body, 'proxyAuto')) {
      if (typeof body.proxyAuto !== 'boolean') {
        throw new ApiError('proxyAuto 必须是布尔值', 'INVALID_REQUEST', 400)
      }
      updated.proxyAuto = body.proxyAuto
    }
    if (Object.prototype.hasOwnProperty.call(body, 'onboardDone')) {
      if (typeof body.onboardDone !== 'boolean') {
        throw new ApiError('onboardDone 必须是布尔值', 'INVALID_REQUEST', 400)
      }
      updated.onboardDone = body.onboardDone
    }
    // CONTRACT 补丁 v1.4 §A2: local dirs + per-model cost map.
    if (Object.prototype.hasOwnProperty.call(body, 'imageDir')) {
      updated.imageDir = await validateDirectorySetting(body.imageDir, '图片保存目录')
    }
    if (Object.prototype.hasOwnProperty.call(body, 'saveDir')) {
      updated.saveDir = await validateDirectorySetting(body.saveDir, '另存为目录')
    }
    if (Object.prototype.hasOwnProperty.call(body, 'modelCosts')) {
      if (!isPlainObject(body.modelCosts)) {
        throw new ApiError('模型成本必须是 { 模型ID: 单价 } 对象', 'INVALID_REQUEST', 400)
      }
      const costs = {}
      for (const [modelId, value] of Object.entries(body.modelCosts)) {
        const id = String(modelId || '').trim()
        if (!id) continue
        if (id.length > 200) throw new ApiError('模型ID过长', 'INVALID_REQUEST', 400)
        // CONTRACT 补丁 v1.8: legacy flat number OR {1K,2K,4K} tier object.
        // Validate every entry BEFORE mutating anything.
        costs[id] = parseCostSetting(id, value)
      }
      // CONTRACT 补丁 v1.8 §Host(7, 修订): PATCH/MERGE semantics. The dashboard
      // intentionally submits only the edited model(s); an empty object is a
      // no-op, never "clear all". Existing prices for other models must survive.
      updated.modelCosts = {
        ...(isPlainObject(current.modelCosts) ? current.modelCosts : {}),
        ...costs,
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'models')) {
      if (!Array.isArray(body.models)) throw new ApiError('模型列表必须是数组', 'INVALID_REQUEST', 400)
      updated.models = normalizeModels(body.models)
    }
    if (Object.prototype.hasOwnProperty.call(body, 'defaults')) {
      if (!isPlainObject(body.defaults)) throw new ApiError('默认参数必须是对象', 'INVALID_REQUEST', 400)
      updated.defaults = normalizeDefaults({ ...current.defaults, ...body.defaults })
    }
    return updated
  })
  return safeSettings(next)
}

/**
 * Validate a settings directory value (CONTRACT 补丁 v1.4 §A2): '' = default,
 * otherwise it must be an absolute, creatable and writable directory.
 */
export async function validateDirectorySetting(raw, label) {
  if (raw === null || raw === undefined) return ''
  if (typeof raw !== 'string') {
    throw new ApiError(`${label}必须是字符串（绝对路径，空字符串表示默认）`, 'INVALID_REQUEST', 400)
  }
  const value = raw.trim()
  if (!value) return ''
  if (!path.isAbsolute(value)) throw new ApiError(`${label}必须是绝对路径`, 'INVALID_REQUEST', 400)
  const target = path.resolve(value)
  try {
    await fs.mkdir(target, { recursive: true })
    const probe = path.join(target, `.dsh-iw-write-probe-${process.pid}-${Date.now()}`)
    await fs.writeFile(probe, 'ok')
    await fs.rm(probe, { force: true })
  } catch (error) {
    throw new ApiError(
      `${label}无法创建或不可写：${truncate(String(error?.message || error), 120)}`,
      'INVALID_REQUEST',
      400,
    )
  }
  return target
}

/** Effective new-image storage root (settings.imageDir, '' = default images/). */
export async function resolveImageDir() {
  const settings = await readSettingsRaw()
  return settings.imageDir || IMAGES_ROOT
}

/** Effective file.saveAs target dir (settings.saveDir, '' = <imageDir>/exports). */
export async function resolveSaveDir() {
  const settings = await readSettingsRaw()
  if (settings.saveDir) return settings.saveDir
  return path.join(await resolveImageDir(), 'exports')
}

/* ------------------------------------------------------------------ */
/* Local image folders (workspace / conversation names)                */
/* ------------------------------------------------------------------ */

/**
 * CONTRACT 补丁 v1.9: generated images are stored under
 *   <图片保存目录>/<工作区名>/<会话名>/<imgId>.<ext>
 *
 * Each workspace/conversation record persists the exact directory segment it
 * owns (`folder`), so renames stay stable and two records with the same name
 * never fight over one directory. Records written by older builds get their
 * folder assigned and their legacy `<wsId>/<convId>/` image files migrated by
 * `ensureLocalFolderLayout()` (called from `loadBootstrap`).
 */
const FOLDER_SEGMENT_MAX = 60
const FALLBACK_WORKSPACE_FOLDER = '未命名工作区'
const WINDOWS_RESERVED_BASENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

/**
 * Sanitize one directory segment so any user-entered workspace name or
 * conversation title becomes a legal Windows/macOS/Linux folder name:
 * invalid characters → `_`, control chars removed, trailing dots/spaces
 * trimmed, reserved device names suffixed, length capped, empty → fallback.
 */
export function folderSegment(raw, fallback = FALLBACK_WORKSPACE_FOLDER) {
  let text = String(raw == null ? '' : raw)
  text = text.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_')
  text = text.replace(/\s+/g, ' ').trim()
  text = text.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  if (WINDOWS_RESERVED_BASENAMES.has(text.split('.')[0].toLowerCase())) text = `${text}_`
  const chars = Array.from(text)
  if (chars.length > FOLDER_SEGMENT_MAX) text = chars.slice(0, FOLDER_SEGMENT_MAX).join('')
  text = text.replace(/[.\s]+$/, '')
  if (!text) return String(fallback || DEFAULT_CONVERSATION_TITLE)
  return text
}

function folderKey(segment) {
  return String(segment || '').toLowerCase()
}

function samePath(left, right) {
  const a = path.resolve(String(left || ''))
  const b = path.resolve(String(right || ''))
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isUnderPath(child, parent) {
  const inner = process.platform === 'win32' ? String(child || '').toLowerCase() : String(child || '')
  const outer = process.platform === 'win32' ? String(parent || '').toLowerCase() : String(parent || '')
  const owner = outer.endsWith(path.sep) ? outer : `${outer}${path.sep}`
  return Boolean(outer) && inner.startsWith(owner)
}

/** Directory segment owned by a workspace (falls back to its current name). */
export function folderOfWorkspace(workspace) {
  const stored = workspace && typeof workspace.folder === 'string' ? workspace.folder.trim() : ''
  return stored || folderSegment(workspace && workspace.name, FALLBACK_WORKSPACE_FOLDER)
}

/** Directory segment owned by a conversation (falls back to its current title). */
export function folderOfConversation(conversation) {
  const stored = conversation && typeof conversation.folder === 'string' ? conversation.folder.trim() : ''
  return stored || folderSegment(conversation && conversation.title, DEFAULT_CONVERSATION_TITLE)
}

function workspaceImageDir(root, workspace) {
  return path.join(root, folderOfWorkspace(workspace))
}

function conversationImageDir(root, workspace, conversation) {
  return path.join(root, folderOfWorkspace(workspace), folderOfConversation(conversation))
}

/** Pick a folder segment that no sibling record (or stray directory) owns. */
async function uniqueFolderSegment(base, siblingSegments, parentDir, ownedSegment = '') {
  const used = new Set((Array.isArray(siblingSegments) ? siblingSegments : []).map(folderKey))
  const ownedKey = folderKey(ownedSegment)
  const candidateExists = async (candidate) => {
    if (ownedKey && folderKey(candidate) === ownedKey) return false
    if (used.has(folderKey(candidate))) return true
    return Boolean(parentDir) && (await pathExists(path.join(parentDir, candidate)))
  }
  let candidate = base
  let index = 1
  while (await candidateExists(candidate)) {
    index += 1
    candidate = `${base} (${index})`
    if (index >= 500) return `${base} (${Date.now().toString(36)})`
  }
  return candidate
}

/** Rename a directory; returns false when the source is missing or the target exists. */
async function renameDirectoryIfPossible(fromDir, toDir) {
  if (!fromDir || !toDir || samePath(fromDir, toDir)) return false
  try {
    if (!(await pathExists(fromDir))) return false
    if (await pathExists(toDir)) return false
    await fs.rename(fromDir, toDir)
    return true
  } catch {
    return false
  }
}

function setRegistryPath(imageId, filePath) {
  const registry = STATE.registry
  if (!(registry instanceof Map)) return
  const entry = registry.get(imageId)
  if (entry && typeof entry === 'object') entry.path = filePath
}

/** Registry entries that still point inside `fromDir` follow a directory rename. */
function moveRegistryPathsUnder(fromDir, toDir) {
  const registry = STATE.registry
  if (!(registry instanceof Map)) return
  for (const entry of registry.values()) {
    if (!entry || typeof entry.path !== 'string' || !path.isAbsolute(entry.path)) continue
    if (!isUnderPath(entry.path, fromDir)) continue
    const relative = path.relative(fromDir, entry.path)
    if (!relative || relative.startsWith('..')) continue
    entry.path = path.join(toDir, relative)
  }
}

/** Persisted image `localPath` values inside `fromDir` follow a directory rename. */
function applyLocalPathPrefix(conversation, fromDir, toDir) {
  let changed = false
  for (const turn of Array.isArray(conversation?.turns) ? conversation.turns : []) {
    for (const image of Array.isArray(turn?.images) ? turn.images : []) {
      if (!isPlainObject(image) || typeof image.localPath !== 'string' || !image.localPath) continue
      if (!path.isAbsolute(image.localPath)) continue
      if (!isUnderPath(image.localPath, fromDir)) continue
      const relative = path.relative(fromDir, image.localPath)
      if (!relative || relative.startsWith('..')) continue
      const next = path.join(toDir, relative)
      if (samePath(next, image.localPath)) continue
      image.localPath = next
      changed = true
      setRegistryPath(image.id, next)
    }
  }
  return changed
}

/** All conversation records of one workspace (unsorted raw files). */
async function readWorkspaceConversationRecords(workspaceId) {
  const dir = workspaceDataDir(workspaceId)
  let names = []
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const conversationId = name.slice(0, -5)
    if (!isId(conversationId, 'conv')) continue
    const file = path.join(dir, name)
    const conversation = await readConversationFile(file)
    if (!conversation || conversation.id !== conversationId) continue
    out.push({ conversation, file })
  }
  return out
}

function imageFileExtensions(image) {
  const exts = []
  const mime = typeof image?.mime === 'string' && image.mime ? image.mime : ''
  if (mime) {
    try {
      exts.push(extForMime(mime))
    } catch {
      // unknown mime: fall back to known extensions
    }
  }
  for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
    if (!exts.includes(ext)) exts.push(ext)
  }
  return exts
}

/** Remove empty `<root>/<wsId>/<convId>` and `<root>/<wsId>` legacy folders. */
async function pruneEmptyLegacyDirs(root, workspaceId, conversationId) {
  const candidates = [path.join(root, workspaceId, conversationId), path.join(root, workspaceId)]
  for (const dir of candidates) {
    try {
      const names = await fs.readdir(dir)
      if (names.length === 0) await fs.rmdir(dir)
    } catch {
      // missing / non-empty / lock: best effort only
    }
  }
}

/** Best-effort bottom-up removal of empty directories left by a failed rename. */
async function pruneEmptyTreeBestEffort(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) await pruneEmptyTreeBestEffort(path.join(dir, entry.name))
    }
    const remaining = await fs.readdir(dir)
    if (remaining.length === 0) await fs.rmdir(dir)
  } catch {
    // ignore
  }
}

/**
 * Move every image of one conversation into its name-based folder and refresh
 * the persisted `localPath`. Files under the current 图片保存目录 are relocated;
 * files outside it (an older imageDir) keep their absolute path untouched.
 * Runs inside the caller's conversation lock; returns whether the record changed.
 */
async function reconcileConversationImages(workspaceId, conversation, root) {
  const workspace = await requireWorkspace(workspaceId)
  const expectedDir = conversationImageDir(root, workspace, conversation)
  const conversationId = conversation.id
  let changed = false
  let touchedLegacy = false
  const turns = Array.isArray(conversation?.turns) ? conversation.turns : []
  for (const turn of turns) {
    const images = Array.isArray(turn?.images) ? turn.images : []
    for (const image of images) {
      if (!isPlainObject(image) || !isId(image.id, 'img')) continue
      const stored = typeof image.localPath === 'string' && path.isAbsolute(image.localPath) ? image.localPath : ''
      let source = stored && (await pathExists(stored)) ? stored : ''
      if (!source) {
        for (const ext of imageFileExtensions(image)) {
          const candidate = path.join(root, workspaceId, conversationId, `${image.id}.${ext}`)
          if (await pathExists(candidate)) {
            source = candidate
            touchedLegacy = true
            break
          }
        }
      }
      if (!source) continue
      if (!isUnderPath(source, root)) {
        // A file from an older imageDir: never move it, just keep the exact path.
        if (!samePath(source, image.localPath || '')) {
          image.localPath = source
          changed = true
        }
        setRegistryPath(image.id, source)
        continue
      }
      if (isUnderPath(source, path.join(root, workspaceId))) touchedLegacy = true
      const target = path.join(expectedDir, path.basename(source))
      if (samePath(source, target)) {
        if (!samePath(target, image.localPath || '')) {
          image.localPath = target
          changed = true
        }
        setRegistryPath(image.id, target)
        continue
      }
      try {
        await fs.mkdir(expectedDir, { recursive: true })
        if (await pathExists(target)) await removePathBestEffort(source)
        else await fs.rename(source, target)
      } catch {
        continue
      }
      image.localPath = target
      changed = true
      setRegistryPath(image.id, target)
    }
  }
  if (touchedLegacy) await pruneEmptyLegacyDirs(root, workspaceId, conversationId)
  return { changed, expectedDir }
}

/**
 * Fill the persisted `folder` segment on every workspace/conversation created by
 * an older build and migrate their images into the name-based layout. Called on
 * bootstrap; idempotent and best effort (never fails the bootstrap request).
 */
export async function ensureLocalFolderLayout() {
  let root = ''
  try {
    root = await resolveImageDir()
  } catch {
    return
  }
  let workspaces = []
  try {
    await withLock('workspaces', async () => {
      const list = await readWorkspaces()
      const taken = new Set()
      let listChanged = false
      for (const workspace of list) {
        const stored = typeof workspace.folder === 'string' ? workspace.folder.trim() : ''
        if (stored) {
          workspace.folder = stored
          taken.add(folderKey(stored))
          continue
        }
        const folder = await uniqueFolderSegment(
          folderSegment(workspace.name, FALLBACK_WORKSPACE_FOLDER),
          [...taken],
          root,
        )
        workspace.folder = folder
        taken.add(folderKey(folder))
        listChanged = true
      }
      workspaces = list
      if (listChanged) await writeJsonAtomic(WORKSPACES_FILE, list)
    })
  } catch {
    return
  }
  for (const workspace of workspaces) {
    let records = []
    try {
      records = await readWorkspaceConversationRecords(workspace.id)
    } catch {
      continue
    }
    records.sort(
      (left, right) =>
        String(left.conversation.createdAt || '').localeCompare(String(right.conversation.createdAt || '')) ||
        String(left.conversation.id).localeCompare(String(right.conversation.id)),
    )
    const taken = new Set()
    const pendingFolders = new Map()
    for (const record of records) {
      const stored = typeof record.conversation.folder === 'string' ? record.conversation.folder.trim() : ''
      if (stored) {
        taken.add(folderKey(stored))
        continue
      }
      const folder = await uniqueFolderSegment(
        folderSegment(record.conversation.title, DEFAULT_CONVERSATION_TITLE),
        [...taken],
        workspaceImageDir(root, workspace),
      )
      taken.add(folderKey(folder))
      pendingFolders.set(record.conversation.id, folder)
    }
    for (const record of records) {
      try {
        await withLock(conversationLockKey(workspace.id, record.conversation.id), async () => {
          const conversation = await readConversationFile(record.file)
          if (!conversation) return
          let changed = false
          const pendingFolder = pendingFolders.get(conversation.id)
          if (!conversation.folder && pendingFolder) {
            conversation.folder = pendingFolder
            changed = true
          }
          const reconciled = await reconcileConversationImages(workspace.id, conversation, root)
          if (reconciled.changed) changed = true
          if (changed) await writeJsonAtomic(record.file, conversation)
        })
      } catch {
        // one broken conversation must not block the rest of the migration
      }
    }
    // Old id-based folders may be left empty after the migration; prune them.
    await pruneEmptyTreeBestEffort(path.join(root, workspace.id))
  }
}

/* ------------------------------------------------------------------ */
/* Workspaces                                                          */
/* ------------------------------------------------------------------ */

function workspaceDataDir(workspaceId) {
  assertId(workspaceId, 'ws', '工作区 ID')
  return path.join(DATA_ROOT, workspaceId)
}

function conversationFile(workspaceId, conversationId) {
  assertId(workspaceId, 'ws', '工作区 ID')
  assertId(conversationId, 'conv', '会话 ID')
  return path.join(DATA_ROOT, workspaceId, `${conversationId}.json`)
}

function imagesDir(workspaceId, conversationId) {
  return path.join(IMAGES_ROOT, workspaceId, conversationId)
}

export async function readWorkspaces() {
  const list = await readJsonFile(WORKSPACES_FILE, [])
  if (!Array.isArray(list)) return []
  return list.filter(
    (item) =>
      isPlainObject(item) &&
      isId(item.id, 'ws') &&
      typeof item.name === 'string' &&
      typeof item.createdAt === 'string' &&
      typeof item.updatedAt === 'string',
  )
}

async function findWorkspace(workspaceId) {
  const list = await readWorkspaces()
  return list.find((item) => item.id === workspaceId) || null
}

export async function requireWorkspace(workspaceId) {
  assertId(workspaceId, 'ws', '工作区 ID')
  const ws = await findWorkspace(workspaceId)
  if (!ws) throw new ApiError('工作区不存在或已被删除', 'INVALID_REQUEST', 404)
  return ws
}

async function touchWorkspace(workspaceId) {
  try {
    await withLock('workspaces', async () => {
      const list = await readWorkspaces()
      const ws = list.find((item) => item.id === workspaceId)
      if (!ws) return
      ws.updatedAt = nowIso()
      await writeJsonAtomic(WORKSPACES_FILE, list)
    })
  } catch {
    // best effort
  }
}

export async function createWorkspace(name) {
  const label = assertNonEmptyString(name, '工作区名称', { max: 80 })
  return withLock('workspaces', async () => {
    const list = await readWorkspaces()
    const root = await resolveImageDir()
    const folder = await uniqueFolderSegment(
      folderSegment(label, FALLBACK_WORKSPACE_FOLDER),
      list.map(folderOfWorkspace),
      root,
    )
    const ws = {
      id: await newUniqueId('ws', async (id) => list.some((item) => item.id === id) || (await pathExists(path.join(DATA_ROOT, id)))),
      name: label,
      folder,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    list.push(ws)
    await writeJsonAtomic(WORKSPACES_FILE, list)
    await updateSettingsUi({ activeWorkspaceId: ws.id, activeConversationId: null })
    return { ...ws, conversations: [] }
  })
}

export async function renameWorkspace(workspaceId, name) {
  const label = assertNonEmptyString(name, '工作区名称', { max: 80 })
  assertId(workspaceId, 'ws', '工作区 ID')
  return withLock('workspaces', async () => {
    const list = await readWorkspaces()
    const ws = list.find((item) => item.id === workspaceId)
    if (!ws) throw new ApiError('工作区不存在或已被删除', 'INVALID_REQUEST', 404)
    const root = await resolveImageDir()
    const oldFolder = folderOfWorkspace(ws)
    const newFolder = await uniqueFolderSegment(
      folderSegment(label, FALLBACK_WORKSPACE_FOLDER),
      list.filter((item) => item.id !== workspaceId).map(folderOfWorkspace),
      root,
      oldFolder,
    )
    ws.name = label
    ws.folder = newFolder
    ws.updatedAt = nowIso()
    await writeJsonAtomic(WORKSPACES_FILE, list)
    // CONTRACT 补丁 v1.9: keep the local folder name in sync with the rename.
    const oldDir = path.join(root, oldFolder)
    const newDir = path.join(root, newFolder)
    const moved = await renameDirectoryIfPossible(oldDir, newDir)
    if (moved) moveRegistryPathsUnder(oldDir, newDir)
    let records = []
    try {
      records = await readWorkspaceConversationRecords(workspaceId)
    } catch {
      records = []
    }
    for (const record of records) {
      try {
        await withLock(conversationLockKey(workspaceId, record.conversation.id), async () => {
          const conversation = await readConversationFile(record.file)
          if (!conversation) return
          let changed = moved ? applyLocalPathPrefix(conversation, oldDir, newDir) : false
          const reconciled = await reconcileConversationImages(workspaceId, conversation, root)
          if (reconciled.changed) changed = true
          if (changed) await writeJsonAtomic(record.file, conversation)
        })
      } catch {
        // one unreadable conversation must not block the workspace rename
      }
    }
    if (!moved && !samePath(oldDir, newDir)) await pruneEmptyTreeBestEffort(oldDir)
    return { ok: true, folder: newFolder }
  })
}

export async function deleteWorkspace(workspaceId) {
  assertId(workspaceId, 'ws', '工作区 ID')
  return withLock('workspaces', async () => {
    const list = await readWorkspaces()
    const index = list.findIndex((item) => item.id === workspaceId)
    if (index < 0) throw new ApiError('工作区不存在或已被删除', 'INVALID_REQUEST', 404)
    list.splice(index, 1)
    await writeJsonAtomic(WORKSPACES_FILE, list)
    await moveToTrash(workspaceDataDir(workspaceId))
    await removePathBestEffort(path.join(IMAGES_ROOT, workspaceId))
    pruneRegistry((entry) => String(entry?.path || '').includes(`${path.sep}${workspaceId}${path.sep}`))
    const settings = await readSettingsRaw()
    if (settings.ui.activeWorkspaceId === workspaceId) {
      const fallbackWs = list[0] || null
      const fallbackConvs = fallbackWs ? await listConversations(fallbackWs.id) : []
      await updateSettingsUi({
        activeWorkspaceId: fallbackWs ? fallbackWs.id : null,
        activeConversationId: fallbackConvs[0] ? fallbackConvs[0].id : null,
      })
    }
    return { ok: true }
  })
}

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

function summarizeConversation(conv) {
  const turns = Array.isArray(conv?.turns) ? conv.turns : []
  let imageCount = 0
  let lastPrompt = ''
  for (const turn of turns) {
    if (Array.isArray(turn?.images)) imageCount += turn.images.length
    if (typeof turn?.prompt === 'string' && turn.prompt.length > 0) lastPrompt = turn.prompt
  }
  return {
    id: conv.id,
    title: typeof conv.title === 'string' && conv.title ? conv.title : DEFAULT_CONVERSATION_TITLE,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    imageCount,
    lastPrompt,
  }
}

export async function listConversations(workspaceId) {
  assertId(workspaceId, 'ws', '工作区 ID')
  const dir = workspaceDataDir(workspaceId)
  let names = []
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const summaries = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const conversationId = name.slice(0, -5)
    if (!isId(conversationId, 'conv')) continue
    const conv = await readJsonFile(path.join(dir, name), null)
    if (!isPlainObject(conv) || conv.id !== conversationId) continue
    summaries.push(summarizeConversation(conv))
  }
  summaries.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return summaries
}

async function readConversationFile(file) {
  const conv = await readJsonFile(file, null)
  if (!isPlainObject(conv)) return null
  if (!Array.isArray(conv.turns)) conv.turns = []
  return conv
}

async function readConversationOrThrow(workspaceId, conversationId) {
  const file = conversationFile(workspaceId, conversationId)
  const conv = await readConversationFile(file)
  if (!conv) throw new ApiError('会话不存在或已被删除', 'INVALID_REQUEST', 404)
  return { conv, file }
}

function conversationLockKey(workspaceId, conversationId) {
  return `conv:${workspaceId}:${conversationId}`
}

/**
 * v1.4 §A1: legacy images persisted before localPath existed (or written by an
 * old build) get an in-memory localPath from the image registry on read.
 */
async function decorateImagesLocalPath(conv) {
  if (!conv || !Array.isArray(conv.turns)) return conv
  let registry = null
  for (const turn of conv.turns) {
    if (!turn || !Array.isArray(turn.images)) continue
    for (const image of turn.images) {
      if (!isPlainObject(image) || !isId(image.id, 'img')) continue
      if (typeof image.localPath === 'string' && image.localPath) continue
      if (!registry) {
        registry = await ensureRegistry().catch(() => null)
      }
      const entry = registry && registry.get(image.id)
      if (entry && entry.path) image.localPath = entry.path
    }
  }
  return conv
}

/** Resolve a conversation without a workspace id by scanning all workspaces. */
async function resolveConversation(workspaceId, conversationId) {
  assertId(conversationId, 'conv', '会话 ID')
  if (workspaceId !== undefined && workspaceId !== null && workspaceId !== '') {
    assertId(workspaceId, 'ws', '工作区 ID')
    await requireWorkspace(workspaceId)
    return { workspaceId, file: conversationFile(workspaceId, conversationId) }
  }
  const list = await readWorkspaces()
  for (const ws of list) {
    const file = conversationFile(ws.id, conversationId)
    if (await pathExists(file)) return { workspaceId: ws.id, file }
  }
  throw new ApiError('会话不存在或已被删除', 'INVALID_REQUEST', 404)
}

export async function getConversation(workspaceId, conversationId) {
  const resolved = await resolveConversation(workspaceId, conversationId)
  const conv = await readConversationFile(resolved.file)
  if (!conv) throw new ApiError('会话不存在或已被删除', 'INVALID_REQUEST', 404)
  return decorateImagesLocalPath(conv)
}

export async function createConversation(workspaceId, title) {
  assertId(workspaceId, 'ws', '工作区 ID')
  const ws = await requireWorkspace(workspaceId)
  const rawTitle = typeof title === 'string' ? title.trim() : ''
  const label = rawTitle.length > 0 ? assertNonEmptyString(rawTitle, '会话标题', { max: 80 }) : DEFAULT_CONVERSATION_TITLE
  const root = await resolveImageDir()
  const siblingFolders = (await readWorkspaceConversationRecords(ws.id)).map((record) =>
    folderOfConversation(record.conversation),
  )
  const folder = await uniqueFolderSegment(
    folderSegment(label, DEFAULT_CONVERSATION_TITLE),
    siblingFolders,
    workspaceImageDir(root, ws),
  )
  const conversationId = await newUniqueId('conv', (id) => pathExists(conversationFile(ws.id, id)))
  const now = nowIso()
  const conv = {
    id: conversationId,
    workspaceId: ws.id,
    title: label,
    folder,
    createdAt: now,
    updatedAt: now,
    turns: [],
  }
  await withLock(conversationLockKey(ws.id, conversationId), () => writeJsonAtomic(conversationFile(ws.id, conversationId), conv))
  await touchWorkspace(ws.id)
  await updateSettingsUi({ activeWorkspaceId: ws.id, activeConversationId: conv.id })
  return conv
}

export async function renameConversation(conversationId, title, workspaceId) {
  assertId(conversationId, 'conv', '会话 ID')
  const label = assertNonEmptyString(title, '会话标题', { max: 80 })
  const resolved = await resolveConversation(workspaceId, conversationId)
  const wsId = resolved.workspaceId
  return withLock(conversationLockKey(wsId, conversationId), async () => {
    const { conv, file } = await readConversationOrThrow(wsId, conversationId)
    const root = await resolveImageDir()
    const workspace = await requireWorkspace(wsId)
    const parentDir = workspaceImageDir(root, workspace)
    const oldFolder = folderOfConversation(conv)
    const siblingFolders = (await readWorkspaceConversationRecords(wsId))
      .filter((record) => record.conversation.id !== conversationId)
      .map((record) => folderOfConversation(record.conversation))
    const newFolder = await uniqueFolderSegment(
      folderSegment(label, DEFAULT_CONVERSATION_TITLE),
      siblingFolders,
      parentDir,
      oldFolder,
    )
    const oldDir = path.join(parentDir, oldFolder)
    const newDir = path.join(parentDir, newFolder)
    conv.title = label
    conv.folder = newFolder
    conv.updatedAt = nowIso()
    // CONTRACT 补丁 v1.9: rename the local folder together with the conversation.
    const moved = await renameDirectoryIfPossible(oldDir, newDir)
    if (moved) {
      applyLocalPathPrefix(conv, oldDir, newDir)
      moveRegistryPathsUnder(oldDir, newDir)
    }
    await reconcileConversationImages(wsId, conv, root)
    if (!moved && !samePath(oldDir, newDir)) await pruneEmptyTreeBestEffort(oldDir)
    await writeJsonAtomic(file, conv)
    await touchWorkspace(wsId)
    return { ok: true, folder: newFolder }
  })
}

export async function deleteConversation(conversationId, workspaceId) {
  assertId(conversationId, 'conv', '会话 ID')
  const resolved = await resolveConversation(workspaceId, conversationId)
  const wsId = resolved.workspaceId
  return withLock(conversationLockKey(wsId, conversationId), async () => {
    const { file } = await readConversationOrThrow(wsId, conversationId)
    const trashDir = path.join(workspaceDataDir(wsId), '.trash')
    await moveToTrash(file, trashDir)
    await removePathBestEffort(imagesDir(wsId, conversationId))
    pruneRegistry((entry) => String(entry?.path || '').includes(`${path.sep}${conversationId}${path.sep}`))
    const settings = await readSettingsRaw()
    if (settings.ui.activeConversationId === conversationId) {
      const summaries = await listConversations(wsId)
      await updateSettingsUi({ activeConversationId: summaries[0] ? summaries[0].id : null })
    }
    await touchWorkspace(wsId)
    return { ok: true }
  })
}

function autoTitleFromPrompt(prompt) {
  const chars = Array.from(String(prompt || '').replace(/\s+/g, ' ').trim())
  if (chars.length === 0) return ''
  return chars.slice(0, AUTOTITLE_MAX).join('')
}

export async function appendTurn(workspaceId, conversationId, turn) {
  assertId(workspaceId, 'ws', '工作区 ID')
  assertId(conversationId, 'conv', '会话 ID')
  return withLock(conversationLockKey(workspaceId, conversationId), async () => {
    const { conv, file } = await readConversationOrThrow(workspaceId, conversationId)
    conv.turns.push(turn)
    conv.updatedAt = nowIso()
    await writeJsonAtomic(file, conv)
    await touchWorkspace(workspaceId)
    return conv
  })
}

/**
 * Persist a job result back into the conversation turn.
 * `patch`: { status, error, images, finishedAt } (+ any extra turn fields).
 */
export async function finalizeTurn(workspaceId, conversationId, turnId, patch) {
  return withLock(conversationLockKey(workspaceId, conversationId), async () => {
    const { conv, file } = await readConversationOrThrow(workspaceId, conversationId)
    const turn = conv.turns.find((item) => item && item.id === turnId)
    if (!turn) return null
    Object.assign(turn, patch)
    conv.updatedAt = nowIso()
    let titleChanged = false
    if (patch.status === 'done' && conv.turns.length === 1 && conv.title === DEFAULT_CONVERSATION_TITLE) {
      const title = autoTitleFromPrompt(turn.prompt)
      if (title && title !== conv.title) {
        conv.title = title
        titleChanged = true
      }
    }
    try {
      // CONTRACT 补丁 v1.9: the first finished generation may auto-rename the
      // conversation; its local folder follows the new title.
      const root = await resolveImageDir()
      let oldDir = ''
      let newDir = ''
      if (titleChanged) {
        const workspace = await requireWorkspace(workspaceId)
        const parentDir = workspaceImageDir(root, workspace)
        const oldFolder = folderOfConversation(conv)
        const siblingFolders = (await readWorkspaceConversationRecords(workspaceId))
          .filter((record) => record.conversation.id !== conversationId)
          .map((record) => folderOfConversation(record.conversation))
        const newFolder = await uniqueFolderSegment(
          folderSegment(conv.title, DEFAULT_CONVERSATION_TITLE),
          siblingFolders,
          parentDir,
          oldFolder,
        )
        conv.folder = newFolder
        oldDir = path.join(parentDir, oldFolder)
        newDir = path.join(parentDir, newFolder)
        if (await renameDirectoryIfPossible(oldDir, newDir)) {
          applyLocalPathPrefix(conv, oldDir, newDir)
          moveRegistryPathsUnder(oldDir, newDir)
        }
      }
      await reconcileConversationImages(workspaceId, conv, root)
      if (oldDir && !samePath(oldDir, newDir)) await pruneEmptyTreeBestEffort(oldDir)
    } catch {
      // Folder bookkeeping must never lose a finished generation.
    }
    await writeJsonAtomic(file, conv)
    await touchWorkspace(workspaceId)
    return conv
  })
}

/**
 * Delete a non-running turn (CONTRACT 补丁 v1.3).
 *
 * Persists the conversation atomically under the per-conversation lock first,
 * then removes the turn's image files and image-registry entries (the file
 * route returns 404 afterwards). Running turns must be cancelled first.
 * Returns the updated conversation.
 */
export async function deleteTurn(workspaceId, conversationId, turnId) {
  assertId(workspaceId, 'ws', '工作区 ID')
  assertId(conversationId, 'conv', '会话 ID')
  assertId(turnId, 'turn', '生成任务 ID')
  await requireWorkspace(workspaceId)
  const result = await withLock(conversationLockKey(workspaceId, conversationId), async () => {
    const { conv, file } = await readConversationOrThrow(workspaceId, conversationId)
    const index = conv.turns.findIndex((item) => item && item.id === turnId)
    if (index < 0) throw new ApiError('该会话中不存在此生成任务', 'INVALID_REQUEST', 404)
    const turn = conv.turns[index]
    if (turn.status === 'running') {
      throw new ApiError('请先取消该生成任务，再删除', 'INVALID_REQUEST', 400)
    }
    const images = (Array.isArray(turn.images) ? turn.images : []).filter(
      (image) => isPlainObject(image) && isId(image.id, 'img'),
    )
    conv.turns.splice(index, 1)
    conv.updatedAt = nowIso()
    await writeJsonAtomic(file, conv)
    await touchWorkspace(workspaceId)
    return { conv, images }
  })
  // Conversation is persisted; now delete files + registry entries. Orphaned
  // files could only remain after a crash, never a dangling conversation ref.
  for (const image of result.images) {
    const mime = typeof image.mime === 'string' && image.mime ? image.mime : 'image/png'
    await deleteImageFile(image.id)
    await removePathBestEffort(imagePathFor(workspaceId, conversationId, image.id, mime))
    if (!image.mime) {
      for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
        await removePathBestEffort(path.join(imagesDir(workspaceId, conversationId), `${image.id}.${ext}`))
      }
    }
  }
  try {
    await logHost(`turn.delete ${conversationId}/${turnId} images=${result.images.length}`)
  } catch {
    // logging must never break the delete
  }
  return decorateImagesLocalPath(result.conv)
}

export async function removeImage(workspaceId, conversationId, imageId) {
  assertId(workspaceId, 'ws', '工作区 ID')
  assertId(conversationId, 'conv', '会话 ID')
  assertId(imageId, 'img', '图片 ID')
  const result = await withLock(conversationLockKey(workspaceId, conversationId), async () => {
    const { conv, file } = await readConversationOrThrow(workspaceId, conversationId)
    let changed = false
    for (let index = 0; index < conv.turns.length; index += 1) {
      const turn = conv.turns[index]
      if (!turn || !Array.isArray(turn.images)) continue
      const before = turn.images.length
      turn.images = turn.images.filter((image) => image && image.id !== imageId)
      if (turn.images.length === before) continue
      changed = true
      if (turn.images.length === 0) conv.turns.splice(index, 1)
      break
    }
    if (changed) {
      conv.updatedAt = nowIso()
      await writeJsonAtomic(file, conv)
      await touchWorkspace(workspaceId)
    }
    return { conv, changed }
  })
  await deleteImageFile(imageId)
  result.conv = await decorateImagesLocalPath(result.conv)
  return result
}

/* ------------------------------------------------------------------ */
/* Bootstrap / seeding                                                 */
/* ------------------------------------------------------------------ */

/**
 * v1.10 auto-heal: with `proxyAuto` on, a configured 127.0.0.1 proxy whose port
 * refuses connections (client restart changed its port) is replaced by the best
 * verified local-port candidate. Timeouts are never treated as "dead", and
 * non-local proxies are never touched. Returns null when nothing changed.
 */
async function maybeHealProxy(settings) {
  if (settings.proxyAuto !== true) return null
  const parsed = proxy.parseProxyUrl(settings.proxyUrl)
  if (!parsed) return null
  const isLocal = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
  if (!isLocal) return null
  let alive = null
  try {
    alive = await proxy.probeProxyPort(parsed.port, proxy.probeTargetForBaseUrl(settings.baseUrl))
  } catch {
    return null
  }
  if (!alive || alive.error !== 'ECONNREFUSED') return null
  let detection = { candidates: [], target: '' }
  try {
    detection = await proxy.detectProxy({ baseUrl: settings.baseUrl })
  } catch {
    return null
  }
  const replacement = (Array.isArray(detection.candidates) ? detection.candidates : []).find(
    (candidate) => candidate && candidate.verified === true && candidate.url !== settings.proxyUrl,
  )
  if (!replacement) return null
  let configuredUrl = ''
  try {
    configuredUrl = proxy.validateProxyUrl(replacement.url)
  } catch {
    return null
  }
  await mutateSettings((current) => ({ ...current, proxyUrl: configuredUrl, onboardDone: true }))
  return {
    mode: 'auto',
    configuredUrl,
    replacedUrl: settings.proxyUrl,
    reason: 'heal',
    candidates: [],
    target: detection.target || '',
  }
}

/**
 * CONTRACT 补丁 v1.10: first-run proxy onboarding.
 *
 * Returns null when a proxy is already configured or the user finished the
 * onboarding earlier. `mode: 'auto'` means the best detected local proxy was
 * persisted automatically; `mode: 'prompt'` carries candidates for the
 * Client's first-run dialog. Detection failures never block bootstrap.
 */
async function buildProxyOnboarding(settings) {
  if (settings.proxyUrl) {
    try {
      return await maybeHealProxy(settings)
    } catch {
      return null
    }
  }
  if (settings.onboardDone) return null
  let detection = { candidates: [], target: '' }
  try {
    detection = await proxy.detectProxy({ baseUrl: settings.baseUrl })
  } catch {
    detection = { candidates: [], target: '' }
  }
  const interesting = (Array.isArray(detection.candidates) ? detection.candidates : [])
    .filter((candidate) => candidate && candidate.reachable !== false)
    .slice(0, 8)
  const candidates = interesting.map((candidate) => ({
    url: candidate.url,
    source: candidate.source,
    verified: candidate.verified === true,
    needsAuth: candidate.needsAuth === true,
  }))
  if (settings.proxyAuto && candidates.length > 0) {
    const best = interesting.find((candidate) => candidate.verified) || interesting[0]
    let configuredUrl = ''
    try {
      configuredUrl = proxy.validateProxyUrl(best.url)
    } catch {
      configuredUrl = ''
    }
    if (configuredUrl) {
      await mutateSettings((current) => ({ ...current, proxyUrl: configuredUrl, onboardDone: true }))
      return { mode: 'auto', configuredUrl, candidates: [], target: detection.target || '' }
    }
  }
  return { mode: 'prompt', candidates, target: detection.target || '' }
}

export async function loadBootstrap(server) {
  return withLock('bootstrap', async () => {
    let workspaces = await readWorkspaces()
    let settings = await readSettingsRaw()

    if (workspaces.length === 0) {
      const ws = {
        id: await newUniqueId('ws', async (id) => pathExists(path.join(DATA_ROOT, id))),
        name: DEFAULT_WORKSPACE_NAME,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      }
      workspaces = [ws]
      await writeJsonAtomic(WORKSPACES_FILE, workspaces)
      const now = nowIso()
      const conv = {
        id: await newUniqueId('conv', (id) => pathExists(conversationFile(ws.id, id))),
        workspaceId: ws.id,
        title: DEFAULT_CONVERSATION_TITLE,
        createdAt: now,
        updatedAt: now,
        turns: [],
      }
      await writeJsonAtomic(conversationFile(ws.id, conv.id), conv)
      settings = await updateSettingsUi({
        activeWorkspaceId: ws.id,
        activeConversationId: conv.id,
      })
    }

    // CONTRACT 补丁 v1.9: assign name-based folders + migrate legacy image paths.
    try {
      await ensureLocalFolderLayout()
    } catch {
      // layout migration is best effort; the panel must still open
    }

    // CONTRACT 补丁 v1.10: first-run proxy guidance (prompt or auto-configure).
    let proxyOnboarding = null
    try {
      settings = await readSettingsRaw()
      proxyOnboarding = await buildProxyOnboarding(settings)
      if (proxyOnboarding && proxyOnboarding.mode === 'auto') settings = await readSettingsRaw()
    } catch {
      proxyOnboarding = null
    }

    const activeWorkspace =
      workspaces.find((item) => item.id === settings.ui.activeWorkspaceId) || workspaces[0] || null
    const summaries = activeWorkspace ? await listConversations(activeWorkspace.id) : []
    const activeConversation =
      summaries.find((item) => item.id === settings.ui.activeConversationId) || summaries[0] || null

    const nextUi = {
      activeWorkspaceId: activeWorkspace ? activeWorkspace.id : null,
      activeConversationId: activeConversation ? activeConversation.id : null,
    }
    if (
      settings.ui.activeWorkspaceId !== nextUi.activeWorkspaceId ||
      settings.ui.activeConversationId !== nextUi.activeConversationId
    ) {
      settings = await updateSettingsUi(nextUi)
    }

    const workspacesWithConversations = []
    for (const workspace of workspaces) {
      const conversations = workspace.id === activeWorkspace?.id ? summaries : await listConversations(workspace.id)
      workspacesWithConversations.push({ ...workspace, conversations })
    }

    return {
      settings: safeSettings(settings),
      workspaces: workspacesWithConversations,
      activeWorkspaceId: nextUi.activeWorkspaceId,
      activeConversationId: nextUi.activeConversationId,
      // CONTRACT 补丁 v1.10: null when no first-run guidance is needed.
      proxyOnboarding,
      server: { build: server?.build || '', hostBuild: server?.hostBuild || '' },
      limits: { maxN: LIMITS.maxN, maxUploadBytes: LIMITS.maxUploadBytes },
    }
  })
}

/* ------------------------------------------------------------------ */
/* Image registry (file route + reference resolution)                  */
/* ------------------------------------------------------------------ */

export function fileUrl(imageId) {
  return `${API_PREFIX}file?id=${encodeURIComponent(imageId)}`
}

export function pruneRegistry(predicate) {
  const registry = STATE.registry
  if (!(registry instanceof Map)) return
  for (const [id, entry] of registry) {
    try {
      if (predicate(entry, id)) registry.delete(id)
    } catch {
      // ignore
    }
  }
}

export function registerImage(imageId, entry) {
  if (!(STATE.registry instanceof Map)) STATE.registry = new Map()
  STATE.registry.set(imageId, entry)
}

function imagePathFor(workspaceId, conversationId, imageId, mime) {
  return path.join(imagesDir(workspaceId, conversationId), `${imageId}.${extForMime(mime)}`)
}

/**
 * New-image path honouring settings.imageDir (CONTRACT 补丁 v1.4 §A1) and the
 * v1.9 name-based layout: `<图片保存目录>/<工作区名>/<会话名>/<imgId>.<ext>`.
 */
export async function imagePathForNew(workspaceId, conversationId, imageId, mime) {
  const root = await resolveImageDir()
  const workspace = await requireWorkspace(workspaceId)
  const { conv } = await readConversationOrThrow(workspaceId, conversationId)
  return path.join(conversationImageDir(root, workspace, conv), `${imageId}.${extForMime(mime)}`)
}

async function scanUploads(registry) {
  let names = []
  try {
    names = await fs.readdir(UPLOADS_ROOT)
  } catch {
    return
  }
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = path.join(UPLOADS_ROOT, name)
    try {
      const info = await fs.stat(full)
      if (!info.isFile()) continue
      const id = path.basename(name, path.extname(name))
      if (!isId(id, 'up')) continue
      const bytes = await fs.readFile(full)
      const mime = detectMime(bytes) || mimeForFileName(name) || 'application/octet-stream'
      const size = imageSize(bytes, mime)
      registry.set(id, {
        path: full,
        mime,
        w: size.w,
        h: size.h,
        bytes: info.size,
        source: 'upload',
        name,
      })
    } catch {
      // skip unreadable upload
    }
  }
}

async function scanConversationImages(registry) {
  const workspaces = await readWorkspaces()
  for (const ws of workspaces) {
    let names = []
    try {
      names = await fs.readdir(path.join(DATA_ROOT, ws.id))
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const conversationId = name.slice(0, -5)
      if (!isId(conversationId, 'conv')) continue
      const conv = await readJsonFile(path.join(DATA_ROOT, ws.id, name), null)
      if (!isPlainObject(conv) || !Array.isArray(conv.turns)) continue
      for (const turn of conv.turns) {
        if (!turn || !Array.isArray(turn.images)) continue
        for (const image of turn.images) {
          if (!isPlainObject(image) || !isId(image.id, 'img')) continue
          const mime = typeof image.mime === 'string' && image.mime ? image.mime : 'image/png'
          // v1.4: persisted localPath wins (custom imageDir / old images moved).
          const storedPath =
            typeof image.localPath === 'string' && image.localPath && path.isAbsolute(image.localPath)
              ? image.localPath
              : null
          registry.set(image.id, {
            path: storedPath || imagePathFor(ws.id, conversationId, image.id, mime),
            mime,
            w: Number(image.w) || 0,
            h: Number(image.h) || 0,
            bytes: Number(image.bytes) || 0,
            source: 'generated',
            name: typeof image.name === 'string' ? image.name : '',
          })
        }
      }
    }
  }
}

/** Build the id → file registry once per process (CONTRACT.md §3). */
export async function ensureRegistry() {
  if (STATE.registry instanceof Map) return STATE.registry
  return withLock('registry', async () => {
    if (STATE.registry instanceof Map) return STATE.registry
    const registry = new Map()
    await scanUploads(registry)
    await scanConversationImages(registry)
    STATE.registry = registry
    return registry
  })
}

/** Look up a registered image/upload file by id only — never a path. */
export async function lookupImageFile(imageId) {
  if (!isId(imageId, 'img') && !isId(imageId, 'up')) return null
  const registry = await ensureRegistry()
  const entry = registry.get(imageId)
  return entry || null
}

export async function unregisterImage(imageId) {
  if (STATE.registry instanceof Map) STATE.registry.delete(imageId)
}

/** Resolve reference image bytes for generation/edit calls. */
export async function loadRefById(imageId, label = '参考图') {
  const entry = await lookupImageFile(imageId)
  if (!entry) throw new ApiError(`${label}不存在或已被删除`, 'INVALID_REQUEST', 404)
  let bytes
  try {
    bytes = await fs.readFile(entry.path)
  } catch {
    await unregisterImage(imageId)
    throw new ApiError(`${label}文件不存在或已被删除`, 'INVALID_REQUEST', 404)
  }
  const mime = entry.mime || detectMime(bytes) || 'image/png'
  const size = imageSize(bytes, mime)
  return {
    bytes,
    meta: {
      id: imageId,
      url: fileUrl(imageId),
      localPath: entry.path,
      name: entry.name || `${imageId}.${extForMime(mime)}`,
      mime,
      w: size.w || entry.w || 0,
      h: size.h || entry.h || 0,
      bytes: bytes.length,
      source: entry.source === 'upload' ? 'upload' : 'generated',
    },
  }
}

export async function refFromImage(imageId) {
  const { meta } = await loadRefById(imageId, '图片')
  return meta
}

/**
 * RefMeta snapshot from the registry without reading image bytes (used by
 * `generate`, which only needs the metadata; the job loads bytes later).
 */
export async function refMetaById(imageId, label = '参考图') {
  const entry = await lookupImageFile(imageId)
  if (!entry) throw new ApiError(`${label}不存在或已被删除`, 'INVALID_REQUEST', 404)
  const mime = entry.mime || 'image/png'
  return {
    id: imageId,
    url: fileUrl(imageId),
    localPath: entry.path,
    name: entry.name || `${imageId}.${extForMime(mime)}`,
    mime,
    w: Number(entry.w) || 0,
    h: Number(entry.h) || 0,
    bytes: Number(entry.bytes) || 0,
    source: entry.source === 'upload' ? 'upload' : 'generated',
  }
}

/** Assign a fresh image id that is not yet present in the registry. */
export async function newImageId() {
  const registry = await ensureRegistry()
  return newUniqueId('img', (id) => registry.has(id))
}

/**
 * Write generated image bytes and register them.
 * `meta`: { name, mime, w, h }
 */
export async function saveGeneratedImage(workspaceId, conversationId, imageId, bytes, meta) {
  assertId(workspaceId, 'ws', '工作区 ID')
  assertId(conversationId, 'conv', '会话 ID')
  assertId(imageId, 'img', '图片 ID')
  const mime = meta?.mime || detectMime(bytes) || 'image/png'
  // v1.4: honour settings.imageDir for NEW images (old files are not migrated).
  const file = await imagePathForNew(workspaceId, conversationId, imageId, mime)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, bytes)
  registerImage(imageId, {
    path: file,
    mime,
    w: Number(meta?.w) || 0,
    h: Number(meta?.h) || 0,
    bytes: bytes.length,
    source: 'generated',
    name: meta?.name || '',
  })
  return { file, mime, bytes: bytes.length }
}

/**
 * Save an agent-tool generated image under `<imageDir>/agent/<yyyyMM>/<id>.<ext>`
 * (CONTRACT 补丁 v1.4 §B3) and register it in the image registry.
 */
export async function saveAgentImage(imageId, bytes, meta) {
  assertId(imageId, 'img', '图片 ID')
  const mime = meta?.mime || detectMime(bytes) || 'image/png'
  const root = await resolveImageDir()
  const now = new Date()
  const month = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
  const file = path.join(root, 'agent', month, `${imageId}.${extForMime(mime)}`)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, bytes)
  registerImage(imageId, {
    path: file,
    mime,
    w: Number(meta?.w) || 0,
    h: Number(meta?.h) || 0,
    bytes: bytes.length,
    source: 'generated',
    name: meta?.name || '',
  })
  return { file, mime, bytes: bytes.length }
}

export async function deleteImageFile(imageId) {
  const entry = await lookupImageFile(imageId).catch(() => null)
  if (entry?.path) await removePathBestEffort(entry.path)
  await unregisterImage(imageId)
}

/* ------------------------------------------------------------------ */
/* Uploads                                                             */
/* ------------------------------------------------------------------ */

function sanitizeUploadName(name, ext) {
  let base = String(name || '').trim()
  base = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
  base = base.replace(/^\.+/, '').replace(/[. ]+$/, '')
  if (base.length === 0) base = `上传图片.${ext}`
  if (base.length > 120) base = `${base.slice(0, 120)}.${ext}`
  if (!base.includes('.')) base = `${base}.${ext}`
  return base
}

export async function saveUpload(body) {
  const name = optionalString(body?.name, '文件名', { max: 200 })
  const mediaType = optionalString(body?.mediaType, '文件类型', { max: 100 }).toLowerCase().split(';')[0].trim()
  const bytes = decodeBase64Payload(body?.dataBase64, '上传图片')
  if (bytes.length > LIMITS.maxUploadBytes) {
    throw new ApiError('图片不能超过 20MB', 'INVALID_REQUEST', 413)
  }
  const detected = detectMime(bytes)
  if (!detected || !SUPPORTED_UPLOAD_MIMES.includes(detected)) {
    throw new ApiError('仅支持 PNG / JPEG / WebP 格式的图片', 'INVALID_REQUEST', 400)
  }
  const mime = detected
  if (mediaType && SUPPORTED_UPLOAD_MIMES.includes(mediaType) && mediaType !== mime) {
    // Trust the bytes, not the declared media type.
  }
  const registry = await ensureRegistry()
  const imageId = await newUniqueId('up', (id) => registry.has(id) || pathExists(path.join(UPLOADS_ROOT, `${id}.${extForMime(mime)}`)))
  const ext = extForMime(mime)
  const file = path.join(UPLOADS_ROOT, `${imageId}.${ext}`)
  await fs.mkdir(UPLOADS_ROOT, { recursive: true })
  await fs.writeFile(file, bytes)
  const size = imageSize(bytes, mime)
  const safeName = sanitizeUploadName(name, ext)
  registerImage(imageId, {
    path: file,
    mime,
    w: size.w,
    h: size.h,
    bytes: bytes.length,
    source: 'upload',
    name: safeName,
  })
  return {
    id: imageId,
    url: fileUrl(imageId),
    localPath: file,
    name: safeName,
    mime,
    w: size.w,
    h: size.h,
    bytes: bytes.length,
    source: 'upload',
  }
}

/* ------------------------------------------------------------------ */
/* Recovery helpers (used by the job manager)                          */
/* ------------------------------------------------------------------ */

/** Every persisted conversation, for startup recovery. */
export async function listAllConversations() {
  const workspaces = await readWorkspaces()
  const out = []
  for (const ws of workspaces) {
    const dir = path.join(DATA_ROOT, ws.id)
    let names = []
    try {
      names = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const conversationId = name.slice(0, -5)
      if (!isId(conversationId, 'conv')) continue
      const conv = await readJsonFile(path.join(dir, name), null)
      if (!isPlainObject(conv)) continue
      out.push({ workspaceId: ws.id, conversationId, conv })
    }
  }
  return out
}

/**
 * Mark turns left in `running` by a previous process as failed.
 * `activeTurnIds` are the turns a live in-memory job still owns.
 */
export async function markInterruptedTurns(activeTurnIds) {
  const conversations = await listAllConversations()
  let updated = 0
  for (const { workspaceId, conversationId, conv } of conversations) {
    let changed = false
    for (const turn of conv.turns || []) {
      if (!turn || turn.status !== 'running') continue
      if (activeTurnIds && activeTurnIds.has(turn.id)) continue
      turn.status = 'error'
      turn.error = '上次生成被中断'
      turn.finishedAt = nowIso()
      changed = true
    }
    if (!changed) continue
    conv.updatedAt = nowIso()
    await withLock(conversationLockKey(workspaceId, conversationId), () =>
      writeJsonAtomic(conversationFile(workspaceId, conversationId), conv),
    )
    updated += 1
  }
  return updated
}

/* ------------------------------------------------------------------ */
/* Misc exports used by main/provider/jobs                             */
/* ------------------------------------------------------------------ */

export function conversationPath(workspaceId, conversationId) {
  return conversationFile(workspaceId, conversationId)
}

export function conversationKey(workspaceId, conversationId) {
  return conversationLockKey(workspaceId, conversationId)
}

export { conversationFile, imagesDir, imagePathFor }

