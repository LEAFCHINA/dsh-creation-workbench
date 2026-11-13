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
const store = await import(`./store.js?rev=${encodeURIComponent(REV)}`)

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

/**
 * v2.5: model metadata lookups are adapter round-trips. Cache them briefly so a
 * multi-turn session does not pay for the same lookup on every turn.
 */
const MODEL_INFO_TTL_MS = 5 * 60 * 1000
const modelInfoCache = new Map()

async function resolveModelInfoCached(llm, provider, model) {
  const key = `${provider}::${model}`
  const cached = modelInfoCache.get(key)
  if (cached && Date.now() - cached.at < MODEL_INFO_TTL_MS) return cached.info
  let info = null
  try {
    if (typeof llm.resolveModelInfo === 'function') {
      info = await llm.resolveModelInfo(provider, model)
    }
  } catch {
    info = null
  }
  modelInfoCache.set(key, { at: Date.now(), info })
  return info
}

/** Whether the selected DSH model advertises image input. */
async function dshModelSupportsImage(llm, provider, model) {
  try {
    const info = await resolveModelInfoCached(llm, provider, model)
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
/** Build the DSH message list for a multi-turn conversation (v2.4.0). */
async function buildDshMessages({ ctx, conversation, template, agent }) {
  const messages = []
  let firstUser = true
  for (const turn of conversation) {
    if (turn.role === 'assistant') {
      messages.push({
        id: randomUUID(),
        role: 'assistant',
        content: [{ type: 'text', text: turn.text }],
        source: { kind: 'creation-workbench-agent' },
      })
      continue
    }
    const userText = firstUser
      ? buildUserContent(template, turn.text, '', '')
      : turn.text || '（见图片）'
    firstUser = false
    let content = [{ type: 'text', text: userText }]
    if (turn.imageBase64) {
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
          {
            type: 'image',
            data: canonicalBase64(turn.imageBase64),
            mediaType: turn.imageMime,
            name: 'reference.png',
          },
        ])
      } catch (error) {
        throw new ApiError(
          `图片无法送入 DSH 模型：${String(error?.message || error)}（可换一张更小的图片或改用 Agent API）`,
          'AGENT_IMAGE_REJECTED',
          400,
        )
      }
    }
    messages.push({
      id: randomUUID(),
      role: 'user',
      content,
      source: { kind: 'creation-workbench-agent' },
    })
  }
  return messages
}

/** Execute one ✨ template conversation through the DSH host LLM service. */
async function runDshAgent({ ctx, settings, template, agent, conversation, outputFormat }) {
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
  const hasImage = conversation.some((turn) => !!turn.imageBase64)
  if (hasImage) {
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
  }
  const messages = await buildDshMessages({ ctx, conversation, template, agent })

  // v2.3.5: reasoning-capable models can burn the whole output budget on
  // reasoning and return no text at all. Ask for the smallest reasoning effort
  // and retry with a bigger budget when the first attempt comes back empty or
  // truncated by max-tokens.
  let reasoningEfforts = []
  let defaultEffort
  try {
    const info = await resolveModelInfoCached(llm, provider, model)
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
      sessionId: AGENT_SESSION_ID,
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

  const startedAt = Date.now()
  let result = await attempt({ maxTokens: 4096, effort: lowEffort, timeoutMs: 150000 })
  // v2.5.1: only pay for a second call when the first one is unusable. A reply
  // that merely hit max-tokens but already contains real text is kept — the old
  // condition retried those and doubled the wait (a 76 s turn was two calls).
  const tooShort = result.text.length < 200
  if (!result.text || (result.finishKind === 'max-tokens' && tooShort)) {
    result = await attempt({ maxTokens: 8192, effort: lowEffort, timeoutMs: 180000 })
  }
  void store
    .logHost(
      `agent dsh ${provider}/${model} ms=${Date.now() - startedAt} finish=${result.finishKind || '-'} chars=${result.text.length} reasoning=${result.reasoningChars} efforts=[${reasoningEfforts.join(',')}] low=${lowEffort || '-'}`,
    )
    .catch(() => {})
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
    outputFormat,
    turns: conversation.length,
    elapsedMs: Date.now() - startedAt,
  }
}

/**
 * v2.4.0: normalize one conversation for the agent channels.
 *
 * Accepts the multi-turn form `messages: [{role, text, imageBase64?, imageMime?}]`
 * and the legacy single-turn `input: {text, imageBase64, imageMime}`.
 * Returns the conversation (user/assistant turns only) capped by count and size.
 */
const MAX_TURNS = 16
const MAX_TURN_TEXT = 8000
const MAX_CONTEXT_CHARS = 40000

function normalizeConversation(body, agent, allowImage) {
  const raw = Array.isArray(body.messages) ? body.messages : null
  const turns = []
  if (raw) {
    for (const item of raw) {
      if (!isPlainObject(item)) continue
      const role = item.role === 'assistant' ? 'assistant' : item.role === 'user' ? 'user' : ''
      if (!role) continue
      const text = typeof item.text === 'string' ? item.text.trim().slice(0, MAX_TURN_TEXT) : ''
      const imageBase64 = typeof item.imageBase64 === 'string' ? item.imageBase64 : ''
      if (imageBase64 && !allowImage) {
        throw new ApiError('该 Agent 模板不接受图片输入', 'INVALID_REQUEST', 400)
      }
      if (imageBase64.length > MAX_IMAGE_BASE64) {
        throw new ApiError('图片过大，请换一张小一点的图片（≤ 6MB）', 'INVALID_REQUEST', 400)
      }
      if (role === 'assistant') {
        if (!text) continue
        turns.push({ role, text })
        continue
      }
      if (!text && !imageBase64) continue
      const imageMime =
        typeof item.imageMime === 'string' && /^image\/(png|jpeg|webp)$/i.test(item.imageMime)
          ? item.imageMime.toLowerCase()
          : 'image/png'
      turns.push({ role, text, imageBase64, imageMime })
    }
  } else {
    const input = isPlainObject(body.input) ? body.input : {}
    const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_TURN_TEXT) : ''
    const imageBase64 = typeof input.imageBase64 === 'string' ? input.imageBase64 : ''
    if (imageBase64 && !allowImage) {
      throw new ApiError('该 Agent 模板不接受图片输入', 'INVALID_REQUEST', 400)
    }
    if (imageBase64.length > MAX_IMAGE_BASE64) {
      throw new ApiError('图片过大，请换一张小一点的图片（≤ 6MB）', 'INVALID_REQUEST', 400)
    }
    const imageMime =
      typeof input.imageMime === 'string' && /^image\/(png|jpeg|webp)$/i.test(input.imageMime)
        ? input.imageMime.toLowerCase()
        : 'image/png'
    if (text || imageBase64) turns.push({ role: 'user', text, imageBase64, imageMime })
  }
  if (!turns.length) {
    throw new ApiError('请输入文字或上传一张图片', 'INVALID_REQUEST', 400)
  }
  const last = turns[turns.length - 1]
  if (last.role !== 'user') {
    throw new ApiError('最后一条消息必须来自用户', 'INVALID_REQUEST', 400)
  }
  // Keep the most recent turns; the template's system prompt carries the rest.
  let trimmed = turns.slice(-MAX_TURNS)
  let total = trimmed.reduce((sum, turn) => sum + turn.text.length, 0)
  while (trimmed.length > 1 && total > MAX_CONTEXT_CHARS) {
    const dropped = trimmed.shift()
    total -= dropped.text.length
  }
  // The conversation must still start with a user turn for chat-style providers.
  while (trimmed.length > 1 && trimmed[0].role !== 'user') trimmed.shift()
  return trimmed
}

function turnToApiContent(turn) {
  if (!turn.imageBase64) return turn.text
  return [
    { type: 'text', text: turn.text || '（见图片）' },
    { type: 'image_url', image_url: { url: `data:${turn.imageMime};base64,${turn.imageBase64}` } },
  ]
}

export async function runAgent({ settings, payload, ctx } = {}) {
  const body = isPlainObject(payload) ? payload : {}
  const template = await templates.getTemplate(body.templateId)
  if (template.kind !== 'agent') {
    throw new ApiError('该模板不是 Agent 模板', 'INVALID_REQUEST', 400)
  }
  const agent = isPlainObject(template.agent) ? template.agent : {}
  const allowImage = Array.isArray(agent.inputTypes) && agent.inputTypes.indexOf('image') >= 0
  const conversation = normalizeConversation(body, agent, allowImage)
  const outputFormat = agent.outputFormat === 'prompt_negative' ? 'prompt_negative' : 'prompt'

  if (settings?.agentSource === 'dsh') {
    return runDshAgent({ ctx, settings, template, agent, conversation, outputFormat })
  }

  const systemPrompt = agentSystemPrompt(template, agent)
  const messages = [{ role: 'system', content: systemPrompt }]
  for (const turn of conversation) {
    messages.push({
      role: turn.role,
      content: turn.role === 'user' ? turnToApiContent(turn) : turn.text,
    })
  }
  const startedAt = Date.now()
  const result = await provider.runAgentChat({
    settings,
    messages,
    model: agent.model,
  })
  return {
    prompt: result.prompt,
    model: result.model,
    source: 'api',
    outputFormat,
    turns: conversation.length,
    elapsedMs: Date.now() - startedAt,
  }
}
