/**
 * Agent channel for ✨ prompt templates (v2.3).
 *
 * Two sources are supported by design:
 *  - `api`: an OpenAI-compatible `/chat/completions` endpoint (configured in
 *    the 模板 tab; base URL / key fall back to the image API settings).
 *  - `dsh`: the DSH host model — only usable if the host exposes a model
 *    service on the plugin context. `probeAgent()` reports what is visible;
 *    until a service is adapted, `runAgent` returns a clear actionable error.
 */

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const provider = await import(`./provider.js?rev=${encodeURIComponent(REV)}`)
const templates = await import(`./templates.js?rev=${encodeURIComponent(REV)}`)

import { randomUUID } from 'node:crypto'

const { ApiError, isPlainObject } = util

const DEFAULT_SYSTEM_PROMPT =
  '你是资深 AI 视觉创作提示词工程师。根据用户给出的想法或图片，输出一段可直接用于 AI 生图/生视频模型的提示词：' +
  '具体、可执行、包含主体、构图、光线、材质、风格与氛围；不要输出解释、标题或 Markdown。'
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024
/**
 * Some providers (opencode-go) require an affinity header derived from
 * `options.sessionId`. This plugin has no DSH session of its own, so it uses a
 * stable pseudo id for the host process.
 */
const AGENT_SESSION_ID = `cwb-${randomUUID()}`

const DSH_SERVICE_KEYS = ['llm', 'languageModel', 'model', 'models', 'chat', 'agent', 'ai']

/** Collect callable method names across the prototype chain (class instances). */
function serviceMethods(service) {
  const names = new Set()
  let proto = service
  for (let depth = 0; proto && depth < 4; depth += 1) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue
      try {
        if (typeof service[name] === 'function') names.add(name)
      } catch {
        // getters may throw
      }
    }
    proto = Object.getPrototypeOf(proto)
  }
  return [...names].slice(0, 30)
}

/** Report which DSH context services look like a model/LLM service. */
export async function probeAgent(ctx) {
  const available = []
  let ctxType = 'none'
  try {
    if (ctx && typeof ctx.get === 'function') {
      ctxType = 'get'
      for (const key of DSH_SERVICE_KEYS) {
        try {
          const service = ctx.get(key)
          if (!service) continue
          available.push({ key, methods: serviceMethods(service) })
        } catch {
          // ignore individual service lookup failures
        }
      }
    } else if (ctx && typeof ctx === 'object') {
      ctxType = 'object'
      for (const key of DSH_SERVICE_KEYS) {
        if (ctx[key]) {
          const service = ctx[key]
          available.push({ key, methods: serviceMethods(service) })
        }
      }
    }
  } catch {
    // probing is best effort
  }
  return {
    available,
    ctxType,
    supported: false,
    hint: available.length
      ? '检测到可能的模型服务，但当前版本尚未适配 DSH 模型调用；请先使用 Agent API。'
      : '未检测到可用的 DSH 模型服务；请使用 Agent API（可复用生图 API 的地址和 Key）。',
  }
}

function buildUserContent(template, text, imageBase64, imageMime) {
  const agent = isPlainObject(template.agent) ? template.agent : {}
  const userTemplate = typeof agent.userTemplate === 'string' ? agent.userTemplate.trim() : ''
  const userText = userTemplate
    ? userTemplate.replace(/\{\{input\}\}/g, text || '（见图片）')
    : text || '请根据这张图片反推一段可直接用于 AI 生图的提示词。'
  if (!imageBase64) return userText
  return [
    { type: 'text', text: userText },
    { type: 'image_url', image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
  ]
}

/**
 * v2.3.3: an agent template's 附加上下文 (template.content) is real material —
 * rules, style guides, skill docs. It must reach the model, not sit unused.
 */
function agentSystemPrompt(template, agent) {
  const custom = typeof agent?.systemPrompt === 'string' ? agent.systemPrompt.trim() : ''
  const context = typeof template?.content === 'string' ? template.content.trim() : ''
  const base = custom || DEFAULT_SYSTEM_PROMPT
  if (!context) return base
  return `${base}\n\n以下是本模板附带的规则与参考资料，生成时必须遵守：\n${context.slice(0, 16000)}`
}

function getLlm(ctx) {
  try {
    if (!ctx) return null
    if (typeof ctx.get === 'function') return ctx.get('llm') || null
    return ctx.llm || null
  } catch {
    return null
  }
}

/** List DSH host providers/models for the Agent settings UI. */
export async function listDshModels(ctx) {
  const llm = getLlm(ctx)
  if (!llm) {
    return {
      ok: false,
      error: '当前环境没有可用的 DSH 模型服务（仅桌面端支持）',
      providers: [],
      models: [],
    }
  }
  const providers = []
  let models = []
  try {
    const list = typeof llm.listProviders === 'function' ? llm.listProviders() : []
    for (const provider of list) {
      let providerModels = []
      try {
        const raw = await llm.listModels(provider.id)
        providerModels = (Array.isArray(raw) ? raw : []).map((model) => ({
          id: String(model.id || ''),
          name: String(model.name || model.id || ''),
          inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities : [],
        }))
      } catch {
        providerModels = []
      }
      providers.push({
        id: String(provider.id || ''),
        name: String(provider.name || provider.id || ''),
        models: providerModels,
      })
      for (const model of providerModels) {
        models.push({ provider: String(provider.id || ''), id: model.id, name: model.name })
      }
    }
  } catch (error) {
    return { ok: false, error: String(error?.message || error), providers: [], models: [] }
  }
  return { ok: true, providers, models }
}

/** Execute one ✨ template through the DSH host LLM service. */
/** Resolve the DSH attachment store used to admit image bytes (v2.3.3). */
function getAttachments(ctx) {
  const keys = ['attachments', 'attachment', 'attachmentStore', 'files']
  try {
    if (!ctx) return null
    for (const key of keys) {
      const found =
        typeof ctx.get === 'function' ? ctx.get(key) : ctx[key]
      if (found && typeof found.admitPromptContent === 'function') return found
    }
  } catch {
    // fall through to the scan below
  }
  try {
    if (typeof ctx === 'object') {
      for (const key of Object.keys(ctx)) {
        if (!/attach/i.test(key)) continue
        const value = ctx[key]
        if (value && typeof value.admitPromptContent === 'function') return value
      }
    }
  } catch {
    // ignore
  }
  return null
}

/** Normalize any base64 (incl. whitespace/data-url leftovers) into canonical form. */
function canonicalBase64(value) {
  const text = String(value || '').replace(/^data:[^,]*,/, '').replace(/\s+/g, '')
  if (!text) return ''
  return Buffer.from(text, 'base64').toString('base64')
}

/** Whether the selected DSH model advertises image input. */
async function dshModelSupportsImage(llm, provider, model) {
  try {
    if (typeof llm.resolveModelInfo !== 'function') return null
    const info = await llm.resolveModelInfo(provider, model)
    const modalities = Array.isArray(info?.inputModalities) ? info.inputModalities : []
    if (!modalities.length) return null
    return modalities.indexOf('image') >= 0
  } catch {
    return null
  }
}

/** Best-effort suggestion of a vision-capable model on the same provider. */
async function suggestVisionModel(llm, provider) {
  try {
    const models = await llm.listModels(provider)
    const found = (Array.isArray(models) ? models : []).find(
      (item) => Array.isArray(item.inputModalities) && item.inputModalities.indexOf('image') >= 0,
    )
    return found ? String(found.id) : ''
  } catch {
    return ''
  }
}

/** Execute one ✨ template through the DSH host LLM service (text or image). */
async function runDshAgent({ ctx, settings, template, agent, text, imageBase64, imageMime }) {
  const bodySessionId = AGENT_SESSION_ID
  const llm = getLlm(ctx)
  if (!llm) {
    throw new ApiError(
      '当前环境没有可用的 DSH 模型服务（仅桌面端支持），请切换到 Agent API',
      'AGENT_DSH_UNAVAILABLE',
      400,
    )
  }
  let provider = String(settings?.agentDshProvider || '').trim()
  let model = String(settings?.agentDshModel || '').trim()
  if (!provider || !model) {
    try {
      const providers = typeof llm.listProviders === 'function' ? llm.listProviders() : []
      for (const item of providers) {
        let models = []
        try {
          models = await llm.listModels(item.id)
        } catch {
          models = []
        }
        if (Array.isArray(models) && models.length) {
          provider = String(item.id)
          model = String(models[0].id)
          break
        }
      }
    } catch {
      // fall through to the readable error below
    }
  }
  if (!provider || !model) {
    throw new ApiError(
      'DSH 没有可用模型，请先在 DSH 设置里配置模型，或改用 Agent API',
      'AGENT_DSH_UNAVAILABLE',
      400,
    )
  }

  const systemPrompt = agentSystemPrompt(template, agent)
  const userText = buildUserContent(template, text, '', '')
  const encodedImage = imageBase64 ? canonicalBase64(imageBase64) : ''

  let content = [{ type: 'text', text: userText }]
  if (encodedImage) {
    const mime =
      typeof imageMime === 'string' && /^image\/(png|jpeg|webp)$/i.test(imageMime)
        ? imageMime.toLowerCase()
        : 'image/png'
    const supportsImage = await dshModelSupportsImage(llm, provider, model)
    if (supportsImage === false) {
      const suggestion = await suggestVisionModel(llm, provider)
      throw new ApiError(
        `当前 DSH 模型「${provider}/${model}」不支持图片输入${
          suggestion ? `，请改用支持视觉的模型（例如 ${suggestion}）` : ''
        }，或在 Agent 设置里切换到 Agent API`,
        'AGENT_MODEL_TEXT_ONLY',
        400,
      )
    }
    const attachments = getAttachments(ctx)
    if (!attachments || typeof attachments.admitPromptContent !== 'function') {
      throw new ApiError(
        '当前环境没有可用的附件存储服务，无法读取图片；请改用 Agent API 通道',
        'AGENT_ATTACHMENT_UNAVAILABLE',
        400,
      )
    }
    try {
      content = await attachments.admitPromptContent([
        { type: 'text', text: userText },
        { type: 'image', data: encodedImage, mediaType: mime, name: 'reference.png' },
      ])
    } catch (error) {
      throw new ApiError(
        `图片无法送入 DSH 模型：${String(error?.message || error)}（可换一张更小的图片或改用 Agent API）`,
        'AGENT_IMAGE_REJECTED',
        400,
      )
    }
  }

  const messages = [
    {
      id: randomUUID(),
      role: 'user',
      content,
      source: { kind: 'creation-workbench-agent' },
    },
  ]
  // v2.3.5: reasoning-capable models can burn the whole output budget on
  // reasoning and return no text at all. Ask for the smallest reasoning effort
  // and retry with a bigger budget when the first attempt comes back empty or
  // truncated by max-tokens.
  let reasoningEfforts = []
  let defaultEffort
  try {
    const info = await llm.resolveModelInfo(provider, model)
    if (info && info.reasoning && Array.isArray(info.reasoning.efforts)) {
      reasoningEfforts = info.reasoning.efforts.map((effort) => String(effort?.id || '')).filter(Boolean)
      defaultEffort = info.reasoning.defaultEffort
    }
  } catch {
    // reasoning metadata is optional
  }
  const LOW_EFFORT_PREFERENCE = ['none', 'minimal', 'min', 'low', 'off']
  const lowEffort = LOW_EFFORT_PREFERENCE.map((name) =>
    reasoningEfforts.find((id) => id.toLowerCase() === name),
  ).find(Boolean)

  const attempt = async ({ maxTokens, effort, timeoutMs }) => {
    const signal = AbortSignal.timeout(timeoutMs)
    const config = { provider, model, maxTokens, ...(effort ? { reasoningEffort: effort } : {}) }
    let call
    try {
      call = await llm.prepareCall(config, signal)
    } catch (error) {
      throw new ApiError(
        `DSH 模型准备失败（${provider}/${model}）：${String(error?.message || error)}`,
        'AGENT_DSH_FAILED',
        502,
      )
    }
    const options = {
      ...call.config,
      messages,
      system: systemPrompt,
      purpose: 'prompt-template',
      sessionId: bodySessionId,
      signal,
    }
    let text = ''
    let finishKind = ''
    let reasoningChars = 0
    try {
      for await (const chunk of call.stream(options)) {
        if (!chunk || typeof chunk !== 'object') continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text
        } else if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
          reasoningChars += chunk.text.length
        } else if (chunk.type === 'finish') {
          const reason = chunk.reason
          finishKind = String(reason?.kind || '')
          if (reason && reason.kind === 'aborted') {
            throw new ApiError('DSH 模型调用已中止', 'AGENT_ABORTED', 499)
          }
          if (reason && reason.kind === 'error') {
            throw new ApiError(
              `DSH 模型调用失败：${String(reason.failure?.message || '未知错误')}`,
              'AGENT_DSH_FAILED',
              502,
            )
          }
        }
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      throw new ApiError(
        `DSH 模型调用失败：${String(error?.message || error)}`,
        'AGENT_DSH_FAILED',
        502,
      )
    }
    return { text: text.trim(), finishKind, reasoningChars }
  }

  let result = await attempt({ maxTokens: 2048, effort: lowEffort, timeoutMs: 120000 })
  if (!result.text || result.finishKind === 'max-tokens') {
    // Reasoning-heavy first attempt (or an empty stop): retry with a wider budget.
    result = await attempt({ maxTokens: 8192, effort: lowEffort, timeoutMs: 180000 })
  }
  const prompt = result.text
  if (!prompt) {
    const reason =
      result.finishKind === 'max-tokens'
        ? '模型把输出额度都用在了推理上（已自动重试仍为空），可换一个非推理模型或缩短模板的附加上下文'
        : result.reasoningChars > 0
          ? '模型只输出推理内容、没有给出正文，请重试或换一个模型'
          : '模型没有返回任何内容，请重试'
    throw new ApiError(`DSH 模型返回了空结果：${reason}`, 'AGENT_EMPTY', 502)
  }

  return {
    prompt,
    model: `${provider}/${model}`,
    source: 'dsh',
    outputFormat: agent.outputFormat === 'prompt_negative' ? 'prompt_negative' : 'prompt',
  }
}

export async function runAgent({ settings, payload, ctx } = {}) {
  const body = isPlainObject(payload) ? payload : {}
  const template = await templates.getTemplate(body.templateId)
  if (template.kind !== 'agent') {
    throw new ApiError('该模板不是 Agent 模板', 'INVALID_REQUEST', 400)
  }
  const agent = isPlainObject(template.agent) ? template.agent : {}
  const input = isPlainObject(body.input) ? body.input : {}
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, 4000) : ''
  const imageBase64 = typeof input.imageBase64 === 'string' ? input.imageBase64 : ''
  const imageMime =
    typeof input.imageMime === 'string' && /^image\/(png|jpeg|webp)$/i.test(input.imageMime)
      ? input.imageMime
      : 'image/png'
  const allowImage = Array.isArray(agent.inputTypes) && agent.inputTypes.indexOf('image') >= 0
  if (imageBase64 && !allowImage) {
    throw new ApiError('该 Agent 模板不接受图片输入', 'INVALID_REQUEST', 400)
  }
  if (!text && !imageBase64) {
    throw new ApiError('请输入文字或上传一张图片', 'INVALID_REQUEST', 400)
  }
  if (imageBase64.length > MAX_IMAGE_BASE64) {
    throw new ApiError('图片过大，请换一张小一点的图片（≤ 6MB）', 'INVALID_REQUEST', 400)
  }
  if (settings?.agentSource === 'dsh') {
    return runDshAgent({ ctx, settings, template, agent, text, imageBase64, imageMime })
  }
  const systemPrompt = agentSystemPrompt(template, agent)
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: buildUserContent(template, text, imageBase64, imageMime) },
  ]
  const result = await provider.runAgentChat({
    settings,
    messages,
    model: agent.model,
  })
  return {
    prompt: result.prompt,
    model: result.model,
    outputFormat: agent.outputFormat === 'prompt_negative' ? 'prompt_negative' : 'prompt',
  }
}
