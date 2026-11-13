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
async function runDshAgent({ ctx, settings, template, agent, text, imageBase64 }) {
  const llm = getLlm(ctx)
  if (!llm) {
    throw new ApiError(
      '当前环境没有可用的 DSH 模型服务（仅桌面端支持），请切换到 Agent API',
      'AGENT_DSH_UNAVAILABLE',
      400,
    )
  }
  if (imageBase64) {
    throw new ApiError(
      'DSH 模型通道暂只支持文字输入；图片反推请使用 Agent API',
      'INVALID_REQUEST',
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
  const systemPrompt =
    typeof agent.systemPrompt === 'string' && agent.systemPrompt.trim()
      ? agent.systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT
  const userText = buildUserContent(template, text, '', '')
  const messages = [
    {
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: userText }],
      source: { kind: 'creation-workbench-agent' },
    },
  ]
  const signal = AbortSignal.timeout(180000)
  let call
  try {
    call = await llm.prepareCall({ provider, model, maxTokens: 1200 }, signal)
  } catch (error) {
    throw new ApiError(
      `DSH 模型准备失败（${provider}/${model}）：${String(error?.message || error)}`,
      'AGENT_DSH_FAILED',
      502,
    )
  }
  let output = ''
  try {
    const options = {
      ...call.config,
      messages,
      system: systemPrompt,
      purpose: 'prompt-template',
      signal,
    }
    for await (const chunk of call.stream(options)) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        output += chunk.text
      } else if (chunk.type === 'finish') {
        const reason = chunk.reason
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
  const prompt = output.trim()
  if (!prompt) {
    throw new ApiError('DSH 模型返回了空结果，请重试', 'AGENT_EMPTY', 502)
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
    return runDshAgent({ ctx, settings, template, agent, text, imageBase64 })
  }
  const systemPrompt =
    typeof agent.systemPrompt === 'string' && agent.systemPrompt.trim()
      ? agent.systemPrompt.trim()
      : DEFAULT_SYSTEM_PROMPT
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
