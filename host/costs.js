/**
 * Cost ledger + stats aggregation (CONTRACT.md 补丁 v1.4 §A4/§A5, v1.8 分级定价).
 *
 * Every terminal generation job appends one JSONL row to
 * `<DSH_HOME>/dsh-creation-workbench/logs/costs.jsonl`:
 *   { at, model, dialect, status, n, images, cost, tier, workspaceId, conversationId, turnId }
 * `cost` is only charged for status==='done'. GPT image models are priced per
 * output tier (1K/2K/4K) using the actual generated image dimensions.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const store = await import(`./store.js?rev=${encodeURIComponent(REV)}`)

const COSTS_FILE = () => path.join(store.DATA_DIR, 'logs', 'costs.jsonl')
const DEFAULT_DAYS = 30
const TIERS = ['1K', '2K', '4K']

function roundCost(value) {
  const number = Number(value) || 0
  return Math.round(number * 1e6) / 1e6
}

/* ------------------------------------------------------------------ */
/* Tier classification + pricing (CONTRACT 补丁 v1.8 §2)               */
/* ------------------------------------------------------------------ */

function tierFromDims(width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  const longest = Math.max(w, h)
  if (longest <= 1536) return '1K'
  if (longest <= 2560) return '2K'
  return '4K'
}

function readDims(raw) {
  if (!raw || typeof raw !== 'object') return null
  const w = Number(raw.w ?? raw.width) || 0
  const h = Number(raw.h ?? raw.height) || 0
  if (w <= 0 || h <= 0) return null
  return { w, h }
}

function parseSizeHint(size) {
  const text = String(size == null ? '' : size).trim()
  if (!text || /^auto$/i.test(text)) return null
  const match = /^(\d{1,5})\s*[x×*]\s*(\d{1,5})$/i.exec(text)
  if (!match) return null
  const w = Number(match[1])
  const h = Number(match[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return { w, h }
}

/**
 * Pure tier classification: actual image dims → params.size → xAI resolution
 * → '1K'. The model id is accepted for API compatibility but pricing gating
 * (GPT-only tiers) is applied by `effectiveTier()` / `priceFor()`.
 */
export function tierFor({ size, resolution, imageDims, model } = {}) {
  void model
  const dims = readDims(imageDims)
  if (dims) return tierFromDims(dims.w, dims.h)
  const sizeDims = parseSizeHint(size)
  if (sizeDims) return tierFromDims(sizeDims.w, sizeDims.h)
  const res = String(resolution == null ? '' : resolution).trim().toLowerCase()
  if (res === '1k') return '1K'
  if (res === '2k') return '2K'
  return '1K'
}

/** Row's recorded tier: GPT image models get the real tier, others null. */
export function effectiveTier(model, tier) {
  return store.isGptImageModel(model) ? tier || '1K' : null
}

/**
 * Price for one image. Flat number config = uniform price; tier object config:
 * GPT image models use the tier, non-GPT models use their '1K' value.
 */
export function priceFor(model, tier, modelCosts) {
  const entry = modelCosts && typeof modelCosts === 'object' ? modelCosts[model] : undefined
  if (entry === undefined || entry === null) return 0
  if (typeof entry !== 'object') {
    const number = Number(entry)
    return Number.isFinite(number) && number >= 0 ? number : 0
  }
  const key = store.isGptImageModel(model) ? tier || '1K' : '1K'
  const value = Number(entry[key])
  return Number.isFinite(value) && value >= 0 ? value : 0
}

/** Agent-tool estimate: uses the actual generated dimensions of the first image. */
export function estimateCostForImages(model, images, modelCosts) {
  const list = Array.isArray(images) ? images : []
  const first = list[0]
  const dims = first && Number(first.w) > 0 && Number(first.h) > 0 ? { w: Number(first.w), h: Number(first.h) } : null
  const tier = tierFor({ model, imageDims: dims })
  const unit = priceFor(model, tier, modelCosts)
  return { tier, unitPrice: unit, cost: roundCost(unit * list.length) }
}

/** Local (machine timezone) date key YYYY-MM-DD from an ISO timestamp. */
function localDateKey(input) {
  const date = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dateKeyOffset(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return localDateKey(date)
}

async function appendCostEntry(entry) {
  const file = COSTS_FILE()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8')
  return entry
}

export async function readCostEntries() {
  let raw = ''
  try {
    raw = await fs.readFile(COSTS_FILE(), 'utf8')
  } catch {
    return []
  }
  const entries = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object') entries.push(parsed)
    } catch {
      // skip malformed line
    }
  }
  return entries
}

/**
 * Record one terminal job. `images` = number of produced images (0 for
 * error/cancelled); cost applies only when status==='done'.
 * Returns the persisted row.
 */
export async function recordJobTerminal({
  model,
  dialect,
  status,
  n,
  images,
  workspaceId,
  conversationId,
  turnId,
  params,
  imageDims,
}) {
  let modelCosts = {}
  try {
    const settings = await store.readSettingsRaw()
    modelCosts = settings.modelCosts || {}
  } catch {
    modelCosts = {}
  }
  const imageCount = Math.max(0, Number(images) || 0)
  const computedTier = tierFor({
    model,
    size: params && typeof params === 'object' ? params.size : '',
    resolution: params && typeof params === 'object' ? params.resolution : '',
    imageDims,
  })
  const tier = effectiveTier(model, computedTier)
  const unit = priceFor(model, computedTier, modelCosts)
  const entry = {
    at: new Date().toISOString(),
    model: String(model || ''),
    dialect: String(dialect || ''),
    status: String(status || ''),
    n: Math.max(0, Number(n) || 0),
    images: imageCount,
    cost: status === 'done' ? roundCost(unit * imageCount) : 0,
    tier,
    workspaceId: String(workspaceId || ''),
    conversationId: String(conversationId || ''),
    turnId: String(turnId || ''),
  }
  try {
    await appendCostEntry(entry)
  } catch {
    // Ledger write must never break a job's terminal state.
  }
  return entry
}

function emptyBucket() {
  return { generations: 0, images: 0, cost: 0, done: 0 }
}

function emptyModelBucket() {
  return {
    ...emptyBucket(),
    tiers: { '1K': emptyBucket(), '2K': emptyBucket(), '4K': emptyBucket() },
  }
}

function addEntry(bucket, entry) {
  bucket.generations += 1
  bucket.images += Math.max(0, Number(entry.images) || 0)
  bucket.cost = roundCost(bucket.cost + (Number(entry.cost) || 0))
  if (entry.status === 'done') bucket.done += 1
}

function addModelEntry(bucket, entry) {
  addEntry(bucket, entry)
  const tier = entry && entry.tier
  if (tier && Object.prototype.hasOwnProperty.call(bucket.tiers, tier)) {
    addEntry(bucket.tiers[tier], entry)
  }
}

function successRate(bucket) {
  if (!bucket || bucket.generations <= 0) return 0
  return Math.round((bucket.done / bucket.generations) * 10000) / 10000
}

function bucketView(bucket) {
  return {
    cost: roundCost(bucket.cost),
    images: bucket.images,
    generations: bucket.generations,
    successRate: successRate(bucket),
  }
}

/** CONTRACT 补丁 v1.8 §4: per-model tier stats (generations/images/cost only). */
function tierView(bucket) {
  return {
    generations: bucket.generations,
    images: bucket.images,
    cost: roundCost(bucket.cost),
  }
}

function tiersView(tiers) {
  return {
    '1K': tierView(tiers['1K']),
    '2K': tierView(tiers['2K']),
    '4K': tierView(tiers['4K']),
  }
}

/**
 * Aggregate costs.jsonl. Returns the CONTRACT §A5 shape (zero-safe):
 * { currency, daysRange, today, days, models, totals }.
 */
export async function costStats({ days } = {}) {
  const requested = Number(days)
  const rangeDays =
    Number.isInteger(requested) && requested >= 1 && requested <= 365 ? requested : DEFAULT_DAYS
  const entries = await readCostEntries()

  const todayKey = dateKeyOffset(0)
  const fromKey = dateKeyOffset(rangeDays - 1)
  const today = emptyBucket()
  const byDate = new Map()
  const byModel = new Map()
  const totals = emptyBucket()

  for (const entry of entries) {
    const key = localDateKey(entry.at)
    if (!key) continue
    if (key === todayKey) addEntry(today, entry)
    if (key >= fromKey && key <= todayKey) {
      let bucket = byDate.get(key)
      if (!bucket) {
        bucket = emptyBucket()
        byDate.set(key, bucket)
      }
      addEntry(bucket, entry)
      addEntry(totals, entry)
      const model = String(entry.model || '(unknown)')
      let modelBucket = byModel.get(model)
      if (!modelBucket) {
        modelBucket = emptyModelBucket()
        byModel.set(model, modelBucket)
      }
      addModelEntry(modelBucket, entry)
    }
  }

  const daysList = []
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const date = dateKeyOffset(offset)
    const bucket = byDate.get(date) || emptyBucket()
    daysList.push({ date, ...bucketView(bucket) })
  }

  const models = Array.from(byModel.entries())
    .map(([model, bucket]) => ({
      model,
      generations: bucket.generations,
      images: bucket.images,
      cost: roundCost(bucket.cost),
      successRate: successRate(bucket),
      tiers: tiersView(bucket.tiers),
    }))
    .sort((a, b) => b.cost - a.cost || b.generations - a.generations || a.model.localeCompare(b.model))

  return {
    currency: '¥',
    daysRange: { days: rangeDays, from: fromKey, to: todayKey },
    today: bucketView(today),
    days: daysList,
    models,
    totals: bucketView(totals),
  }
}

/** Settings helper: unit costs map (kept here so callers share one source). */
export async function modelCostsMap() {
  try {
    const settings = await store.readSettingsRaw()
    return settings.modelCosts || {}
  } catch {
    return {}
  }
}

export function estimateCost(model, images, modelCosts) {
  const unit = priceFor(model, '1K', modelCosts)
  return roundCost(unit * Math.max(0, Number(images) || 0))
}
