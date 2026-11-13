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

const { ApiError, isPlainObject } = util

const DEFAULT_SYSTEM_PROMPT =
  '你是资深 AI 视觉创作提示词工程师。根据用户给出的想法或图片，输出一段可直接用于 AI 生图/生视频模型的提示词：' +
  '具体、可执行、包含主体、构图、光线、材质、风格与氛围；不要输出解释、标题或 Markdown。'
const MAX_IMAGE_BASE64 = 8 * 1024 * 1024
const DSH_SERVICE_KEYS = ['llm', 'languageModel', 'model', 'models', 'chat', 'agent', 'ai']

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
          const methods =
            typeof service === 'object'
              ? Object.keys(service)
                  .filter((name) => typeof service[name] === 'function')
                  .slice(0, 12)
              : []
          available.push({ key, methods })
        } catch {
          // ignore individual service lookup failures
        }
      }
    } else if (ctx && typeof ctx === 'object') {
      ctxType = 'object'
      for (const key of DSH_SERVICE_KEYS) {
        if (ctx[key]) {
          const service = ctx[key]
          available.push({
            key,
            methods:
              typeof service === 'object'
                ? Object.keys(service)
                    .filter((name) => typeof service[name] === 'function')
                    .slice(0, 12)
                : [],
          })
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
    const probe = await probeAgent(ctx)
    throw new ApiError(probe.hint, 'AGENT_DSH_UNAVAILABLE', 400)
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
