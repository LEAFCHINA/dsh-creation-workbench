/**
 * Agent tool `image_generate` (CONTRACT.md 补丁 v1.4 §B).
 *
 * Registered once per Host process via `ctx.inject(['tools','attachments'])` +
 * `scope.effect(() => scope.tools.register(def))`. The definition is hand-written
 * (no npm deps). Execution reuses the exact same settings/provider pipeline as
 * manual generation (proxy / timeout / dialect / video guard), saves files to
 * `<imageDir>/agent/<yyyyMM>/<id>.<ext>`, appends the cost ledger row with
 * workspaceId='agent', and returns a text envelope plus image content blocks
 * when the currently selected LLM model accepts image input.
 */

import { promises as fs } from 'node:fs'

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const store = await import(`./store.js?rev=${encodeURIComponent(REV)}`)
const provider = await import(`./provider.js?rev=${encodeURIComponent(REV)}`)
const costs = await import(`./costs.js?rev=${encodeURIComponent(REV)}`)

const { truncate, isPlainObject } = util

export const TOOL_NAME = 'image_generate'
const MAX_AGENT_N = 4

/* ------------------------------------------------------------------ */
/* Tool definition                                                     */
/* ------------------------------------------------------------------ */

const PARAMETERS = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description: '图像描述提示词（必填）。支持主体、风格、构图、光线等自然语言描述。',
    },
    model: {
      type: 'string',
      description: '模型 ID（可选；缺省使用设置中的默认模型）。视频模型会被拒绝。',
    },
    n: {
      type: 'integer',
      enum: [1, 2, 3, 4],
      description: '生成张数（1–4，默认 1）。',
    },
    size: {
      type: 'string',
      description: 'OpenAI 方言尺寸，例如 1024x1024、1536x1024 或 auto（xAI 模型忽略）。',
    },
    quality: {
      type: 'string',
      description: '质量：auto / low / medium（OpenAI 还支持 high）。',
    },
    aspect_ratio: {
      type: 'string',
      description: 'xAI / Grok 方言画面比例，例如 16:9、1:1 或 auto（OpenAI 模型忽略）。',
    },
    resolution: {
      type: 'string',
      enum: ['1k', '2k'],
      description: 'xAI / Grok 方言分辨率（OpenAI 模型忽略）。',
    },
  },
  required: ['prompt'],
  additionalProperties: false,
}

/**
 * Output schema is STRICT (additionalProperties:false at every level) because
 * the tool registry validates the canonical value against it. Every property
 * that `execute()` can return must be declared here — a mismatch makes the
 * whole tool call fail after the (already paid for) generation.
 */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: '是否成功。' },
    message: { type: 'string', description: '面向模型的说明文字（失败时给出原因与处理建议）。' },
    error: { type: 'string', description: '失败时的简短错误原因。' },
    model: { type: 'string', description: '实际使用的生图模型 ID。' },
    dialect: { type: 'string', description: '上游方言：openai-images / xai-image。' },
    count: { type: 'integer', description: '实际生成的图片张数。' },
    size: { type: 'string', description: '尺寸或画面比例描述。' },
    estimatedCost: { type: 'number', description: '按 modelCosts 估算的成本（人民币元）。' },
    currency: { type: 'string', description: '成本货币符号。' },
    prompt: { type: 'string', description: '本次使用的提示词。' },
    paths: { type: 'array', items: { type: 'string' }, description: '生成图片的绝对路径列表。' },
    images: {
      type: 'array',
      description: '每张图片的结构化信息。',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          url: { type: 'string' },
          localPath: { type: 'string' },
          width: { type: 'integer' },
          height: { type: 'integer' },
          mime: { type: 'string' },
          bytes: { type: 'integer' },
        },
        required: ['id', 'url', 'localPath', 'width', 'height', 'mime', 'bytes'],
        additionalProperties: false,
      },
    },
    visionAvailable: {
      type: 'boolean',
      description: '当前模型是否支持图片输入（为 true 时结果附带图片内容块）。',
    },
    callId: {
      type: 'string',
      description: '内部渲染用标识（用于把图片附件块关联到本次结果）。',
    },
  },
  required: ['ok'],
  additionalProperties: false,
}

/** Image attachments for `output.render`, keyed by the declared `callId`. */
const IMAGE_BLOCK_CACHE = new Map()
const IMAGE_BLOCK_CACHE_MAX = 50

function cacheImageBlocks(callId, refs) {
  if (!callId || !Array.isArray(refs) || refs.length === 0) return
  IMAGE_BLOCK_CACHE.set(callId, refs)
  while (IMAGE_BLOCK_CACHE.size > IMAGE_BLOCK_CACHE_MAX) {
    const oldest = IMAGE_BLOCK_CACHE.keys().next().value
    IMAGE_BLOCK_CACHE.delete(oldest)
  }
}

function textBlock(text) {
  return { type: 'text', text: String(text == null ? '' : text) }
}

function resultText(value) {
  if (!value) return '生成失败：未知错误'
  if (!value.ok) return `图片生成失败：${value.error || value.message || '未知错误'}`
  const lines = [
    `已生成 ${value.count} 张图片（模型：${value.model}，尺寸/比例：${value.size}，估算成本：¥${
      typeof value.estimatedCost === 'number' ? value.estimatedCost : 0
    }）。`,
  ]
  if (Array.isArray(value.paths) && value.paths.length) {
    lines.push('图片已保存到：')
    for (const item of value.paths) lines.push(`- ${item}`)
  }
  if (!value.visionAvailable) {
    lines.push('当前模型不支持图片输入，可使用 read_image 工具查看上述文件。')
  }
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

function buildParams(args, model, settings) {
  const defaults = settings.defaults || {}
  const nRaw = Number(args?.n)
  const n = Number.isInteger(nRaw) && nRaw >= 1 && nRaw <= MAX_AGENT_N ? nRaw : 1
  const dialect = provider.resolveDialect(model, settings.models)
  const params = { model, n }
  const quality = typeof args?.quality === 'string' && args.quality.trim() ? args.quality.trim() : defaults.quality || 'auto'
  if (dialect === 'xai-image') {
    params.aspectRatio = (typeof args?.aspect_ratio === 'string' && args.aspect_ratio.trim()) || defaults.aspectRatio || 'auto'
    params.resolution = (typeof args?.resolution === 'string' && args.resolution.trim()) || defaults.resolution || '1k'
    params.quality = quality
  } else {
    params.size = (typeof args?.size === 'string' && args.size.trim()) || defaults.size || '1024x1024'
    params.quality = quality
  }
  return params
}

async function resolveVisionAvailability(hostCtx, signal) {
  try {
    const modelService = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('agentDefaultModel') : null
    const llm = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('llm') : null
    if (!modelService || !llm) return { available: false, provider: '', model: '' }
    const selection = modelService.currentSelection()
    const providerId = String(selection?.provider || '')
    const modelId = String(selection?.model || '')
    if (!providerId || !modelId) return { available: false, provider: providerId, model: modelId }
    const info = await llm.resolveModelInfo(providerId, modelId, signal)
    const modalities = Array.isArray(info?.inputModalities) ? info.inputModalities : []
    return { available: modalities.includes('image'), provider: providerId, model: modelId }
  } catch {
    return { available: false, provider: '', model: '' }
  }
}

function makeExecute(scope, hostCtx) {
  return async function execute(args, exec) {
    const signal = exec?.signal
    const input = isPlainObject(args) ? args : {}
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
    if (!prompt) {
      return { ok: false, model: '', message: 'prompt 不能为空，请提供图像描述。', error: 'prompt 不能为空' }
    }
    const settings = await store.readSettingsRaw()
    const defaultModel =
      (settings.defaults && settings.defaults.model) || (Array.isArray(settings.models) && settings.models[0] ? settings.models[0].id : '')
    const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : defaultModel
    if (!model) {
      return {
        ok: false,
        model: '',
        message: '尚未配置生图模型。请先在「AI 创作工作台 → API 设置」中添加模型后再使用本工具。',
        error: '尚未配置生图模型',
      }
    }
    if (/video/i.test(model)) {
      return {
        ok: false,
        model,
        message: `当前工具仅支持生图模型：${truncate(model, 80)} 是视频模型，请选择图片模型。`,
        error: '视频模型不可用于图片生成',
      }
    }
    const params = buildParams(input, model, settings)
    const turnId = `agent_${util.newId('turn').slice(5)}`
    let config
    try {
      config = store.resolveProviderConfig(settings)
    } catch (error) {
      return {
        ok: false,
        model,
        message: `尚未配置生图 API：${truncate(String(error?.message || error), 160)}。请先在「API 设置」中填写地址与 API Key。`,
        error: '尚未配置生图 API',
      }
    }

    let generated
    try {
      generated = await provider.generateImages({
        config,
        settings,
        params,
        prompt,
        refs: [],
        signal,
        onProgress: () => {},
      })
    } catch (error) {
      const aborted = Boolean(signal && signal.aborted) || error?.name === 'AbortError'
      const message = truncate(String(error?.message || error || '未知错误'), 300)
      try {
        await costs.recordJobTerminal({
          model,
          dialect: provider.resolveDialect(model, settings.models),
          status: aborted ? 'cancelled' : 'error',
          n: params.n,
          images: 0,
          params,
          workspaceId: 'agent',
          conversationId: 'agent',
          turnId,
        })
      } catch {
        // ignore
      }
      if (aborted) {
        const abortError = new Error('image_generate 已取消')
        abortError.name = 'AbortError'
        throw abortError
      }
      return { ok: false, model, message: `图片生成失败：${message}`, error: message }
    }

    const saved = []
    for (const item of Array.isArray(generated.images) ? generated.images : []) {
      const imageId = await store.newImageId()
      const imageName = `agent-${imageId}.${util.extForMime(item.mime)}`
      const written = await store.saveAgentImage(imageId, item.bytes, {
        mime: item.mime,
        w: item.w,
        h: item.h,
        name: imageName,
      })
      saved.push({
        id: imageId,
        path: written.file,
        mime: item.mime,
        w: item.w,
        h: item.h,
        bytes: item.bytes.length,
      })
    }
    const modelCosts = settings.modelCosts || {}
    // CONTRACT 补丁 v1.8 §5: estimate uses the actual generated image dims tier.
    const estimate = costs.estimateCostForImages(model, saved, modelCosts)
    const estimatedCost = estimate.cost
    try {
      await costs.recordJobTerminal({
        model,
        dialect: generated.dialect || provider.resolveDialect(model, settings.models),
        status: 'done',
        n: params.n,
        images: saved.length,
        params,
        imageDims: saved[0] ? { w: saved[0].w, h: saved[0].h } : null,
        workspaceId: 'agent',
        conversationId: 'agent',
        turnId,
      })
    } catch {
      // ledger failure must not fail the tool
    }

    const sizeLabel =
      params.size || (params.aspectRatio ? `${params.aspectRatio}${params.resolution ? ` / ${params.resolution}` : ''}` : 'auto')
    const callId = `call_${util.newId('turn').slice(5)}`
    // Returned value must match OUTPUT_SCHEMA exactly (strict validation).
    const value = {
      ok: true,
      model,
      dialect: generated.dialect || provider.resolveDialect(model, settings.models),
      count: saved.length,
      size: String(sizeLabel),
      estimatedCost,
      currency: '¥',
      prompt,
      paths: saved.map((item) => item.path),
      images: saved.map((item) => ({
        id: item.id,
        url: store.fileUrl(item.id),
        localPath: item.path,
        width: item.w,
        height: item.h,
        mime: item.mime,
        bytes: item.bytes,
      })),
      visionAvailable: false,
      callId,
    }

    // Image content blocks only when the current LLM model accepts image input.
    const vision = await resolveVisionAvailability(hostCtx, signal)
    if (vision.available) {
      const attachments = []
      const attachmentsService = (scope && scope.attachments) ||
        (hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('attachments') : null)
      if (attachmentsService && typeof attachmentsService.saveImage === 'function') {
        for (const item of saved) {
          try {
            const bytes = await fs.readFile(item.path)
            const ref = await attachmentsService.saveImage({
              data: bytes,
              mediaType: item.mime,
              name: `image_generate-${item.id}`,
            })
            if (ref) attachments.push(ref)
          } catch {
            // Image blocks are best effort; paths stay in the text envelope.
          }
        }
      }
      if (attachments.length) {
        value.visionAvailable = true
        // Attachment refs stay OUT of the validated value; render() resolves
        // them through this declared-callId cache instead.
        cacheImageBlocks(callId, attachments)
      }
    }
    return value
  }
}

function makeRender() {
  return function render(args, value) {
    const blocks = [textBlock(resultText(value))]
    const callId = value && typeof value.callId === 'string' ? value.callId : ''
    const attachments = callId ? IMAGE_BLOCK_CACHE.get(callId) : null
    if (Array.isArray(attachments) && attachments.length) {
      IMAGE_BLOCK_CACHE.delete(callId)
      for (const ref of attachments) {
        if (ref && typeof ref === 'object') blocks.push({ type: 'image', attachment: ref })
      }
    }
    return blocks
  }
}

export function buildDefinition(scope, hostCtx) {
  return {
    name: TOOL_NAME,
    description:
      '根据文本提示词生成图片（复用 AI 创作工作台已配置的第三方生图 API、方言、代理与超时设置）。' +
      '返回生成张数、尺寸、估算成本与图片的绝对路径；当当前模型支持视觉输入时同时返回图片内容块。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: makeRender(),
    },
    execute: makeExecute(scope, hostCtx),
  }
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

/**
 * Register / upgrade the tool. Called lazily from the HTTP entry (index.js
 * passes the plugin context but host/main.js has no apply hook).
 *
 * Tool registration lives on the plugin scope, which outlives host module hot
 * reloads. Therefore on a build change we do NOT re-register (duplicate name):
 * we resolve the current tools service through ctx.inject and patch the already
 * registered definition in place with the new generation's execute/output.
 * Only the very first registration goes through scope.effect.
 */
export function ensureRegistered(hostCtx, build = '') {
  const state = store.STATE
  if (!hostCtx || typeof hostCtx.inject !== 'function') return false
  if (state.imageGenerateToolBuild === build && (state.imageGenerateToolRegistered || state.imageGenerateToolRegistrationRequested)) {
    return false
  }
  state.imageGenerateToolRegistrationRequested = true
  state.imageGenerateToolBuild = build
  try {
    hostCtx.inject(['tools', 'attachments'], (scope) => {
      try {
        const existing =
          scope && scope.tools && typeof scope.tools.get === 'function' ? scope.tools.get(TOOL_NAME) : null
        if (existing && typeof existing === 'object' && !Object.isFrozen(existing)) {
          // Hot-reload upgrade: patch the registered definition in place.
          const fresh = buildDefinition({ attachments: scope.attachments || null }, hostCtx)
          existing.description = fresh.description
          existing.parameters = fresh.parameters
          existing.output = fresh.output
          existing.execute = fresh.execute
          state.imageGenerateToolRegistered = true
          state.imageGenerateToolRegistrationRequested = false
          try {
            void store.logHost(`tool updated in place: ${TOOL_NAME} build=${build}`).catch(() => {})
          } catch {
            // ignore
          }
          return
        }
        scope.effect(() => {
          const definition = buildDefinition(scope, hostCtx)
          const disposer = scope.tools.register(definition)
          const dispose = () => {
            if (state.imageGenerateToolDispose === dispose) state.imageGenerateToolDispose = null
            state.imageGenerateToolRegistered = false
            try {
              if (typeof disposer === 'function') disposer()
            } catch {
              // ignore
            }
          }
          state.imageGenerateToolRegistered = true
          state.imageGenerateToolRegistrationRequested = false
          state.imageGenerateToolDispose = dispose
          try {
            void store.logHost(`tool registered: ${TOOL_NAME} build=${build}`).catch(() => {})
          } catch {
            // ignore
          }
          return dispose
        })
      } catch (error) {
        state.imageGenerateToolRegistrationRequested = false
        try {
          void store
            .logHost(`tool ${TOOL_NAME} setup failed: ${truncate(String(error?.stack || error), 500)}`)
            .catch(() => {})
        } catch {
          // ignore
        }
      }
    })
    return true
  } catch (error) {
    state.imageGenerateToolRegistrationRequested = false
    try {
      void store
        .logHost(`tool ${TOOL_NAME} registration failed: ${truncate(String(error?.stack || error), 500)}`)
        .catch(() => {})
    } catch {
      // ignore
    }
    return false
  }
}

export { resultText }
