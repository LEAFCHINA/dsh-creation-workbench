/**
 * Prompt template store (v2.2).
 *
 * Templates are stored in `<DATA_DIR>/templates.json` (separate from
 * settings.json and workflows.json), read/written through store helpers with a
 * dedicated `templates` lock. The client uses them in the 模板 tab and in the
 * composer `@` picker.
 *
 * Shape:
 *   { version: 1, templates: [{ id, name, category, content, variables,
 *     bindWorkflowCategory, bindWorkflowId, tags, usageCount, createdAt,
 *     updatedAt }] }
 */

const REV = new URL(import.meta.url).searchParams.get('rev') || '0'
const util = await import(`./util.js?rev=${encodeURIComponent(REV)}`)
const store = await import(`./store.js?rev=${encodeURIComponent(REV)}`)

const { ApiError, nowIso, newUniqueId, assertNonEmptyString, isPlainObject } = util

const TEMPLATES_FILE = () => store.dataDir() + '/templates.json'
const MAX_TEMPLATES = 500
const MAX_CONTENT = 20000
const MAX_VARIABLES = 20
const MAX_VAR_KEY = 30

function templatesPath() {
  return TEMPLATES_FILE()
}

function normalizeVariable(raw, index) {
  const key = typeof raw?.key === 'string' ? raw.key.trim() : ''
  if (!key) return null
  if (key.length > MAX_VAR_KEY) {
    throw new ApiError(`变量名过长（最多 ${MAX_VAR_KEY} 字）`, 'INVALID_REQUEST', 400)
  }
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5]+$/.test(key)) {
    throw new ApiError(`变量名「${key}」只能包含字母、数字、下划线或中文`, 'INVALID_REQUEST', 400)
  }
  const label =
    typeof raw.label === 'string' && raw.label.trim()
      ? raw.label.trim().slice(0, 40)
      : key
  const def = typeof raw.default === 'string' ? raw.default.slice(0, 2000) : ''
  return { key, label, default: def, order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : index }
}

function normalizeVariables(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    const variable = normalizeVariable(item, out.length)
    if (!variable) continue
    if (seen.has(variable.key)) continue
    seen.add(variable.key)
    out.push(variable)
    if (out.length >= MAX_VARIABLES) break
  }
  return out
}

function normalizeAgent(raw) {
  const source = isPlainObject(raw) ? raw : {}
  const inputTypes = Array.isArray(source.inputTypes)
    ? source.inputTypes.filter((type) => type === 'text' || type === 'image')
    : ['text', 'image']
  return {
    inputTypes: inputTypes.length ? [...new Set(inputTypes)] : ['text', 'image'],
    systemPrompt: typeof source.systemPrompt === 'string' ? source.systemPrompt.slice(0, 8000) : '',
    userTemplate: typeof source.userTemplate === 'string' ? source.userTemplate.slice(0, 8000) : '',
    outputFormat: source.outputFormat === 'prompt_negative' ? 'prompt_negative' : 'prompt',
    model: typeof source.model === 'string' ? source.model.trim().slice(0, 200) : '',
  }
}

function normalizeStoredTemplate(item) {
  const createdAt = typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : nowIso()
  const updatedAt = typeof item.updatedAt === 'string' && item.updatedAt ? item.updatedAt : createdAt
  const name =
    typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 100) : '未命名模板'
  const category =
    typeof item.category === 'string' && item.category.trim()
      ? item.category.trim().slice(0, 40)
      : '通用'
  const content = typeof item.content === 'string' ? item.content.slice(0, MAX_CONTENT) : ''
  const variables = normalizeVariables(item.variables)
  const tags = Array.isArray(item.tags)
    ? item.tags
        .filter((tag) => typeof tag === 'string' && tag.trim())
        .map((tag) => tag.trim().slice(0, 24))
        .slice(0, 10)
    : []
  const bindWorkflowCategory =
    typeof item.bindWorkflowCategory === 'string' ? item.bindWorkflowCategory.trim().slice(0, 40) : ''
  const bindWorkflowId =
    typeof item.bindWorkflowId === 'string' && /^wf_[0-9a-z]{8}$/i.test(item.bindWorkflowId)
      ? item.bindWorkflowId
      : ''
  return {
    id: item.id,
    name,
    category,
    kind: item.kind === 'agent' ? 'agent' : 'text',
    agent: normalizeAgent(item.agent),
    content,
    variables,
    bindWorkflowCategory,
    bindWorkflowId,
    tags,
    usageCount: Number.isFinite(Number(item.usageCount)) ? Math.max(0, Number(item.usageCount)) : 0,
    createdAt,
    updatedAt,
  }
}

async function readTemplateFile() {
  const raw = await store.readJsonFile(templatesPath(), null)
  if (!isPlainObject(raw) || !Array.isArray(raw.templates)) return { version: 1, templates: [] }
  const templates = []
  for (const item of raw.templates) {
    if (!isPlainObject(item) || typeof item.id !== 'string') continue
    templates.push(normalizeStoredTemplate(item))
    if (templates.length >= MAX_TEMPLATES) break
  }
  return { version: 1, templates }
}

async function writeTemplateFile(data) {
  await store.writeJsonAtomic(templatesPath(), { version: 1, templates: data.templates })
}

function stripTemplate(template) {
  return {
    ...template,
    variables: template.variables.map((variable) => ({ ...variable })),
    agent: { ...normalizeAgent(template.agent) },
  }
}

export async function getTemplate(id) {
  if (typeof id !== 'string' || !id) throw new ApiError('模板 ID 无效', 'INVALID_REQUEST', 400)
  const data = await readTemplateFile()
  const found = data.templates.find((item) => item.id === id)
  if (!found) throw new ApiError('模板不存在或已删除', 'INVALID_REQUEST', 404)
  return stripTemplate(found)
}

export async function listTemplates() {
  const data = await readTemplateFile()
  const templates = data.templates.slice().sort((left, right) => {
    if (right.usageCount !== left.usageCount) return right.usageCount - left.usageCount
    return String(right.updatedAt).localeCompare(String(left.updatedAt))
  })
  return { templates: templates.map(stripTemplate) }
}

export async function saveTemplate({ id, name, category, kind, agent, content, variables, bindWorkflowCategory, bindWorkflowId, tags } = {}) {
  const cleanName = assertNonEmptyString(name, '模板名称', { max: 100 })
  const cleanKind = kind === 'agent' ? 'agent' : 'text'
  if (cleanKind !== 'agent' && (typeof content !== 'string' || !content.trim())) {
    throw new ApiError('模板内容不能为空', 'INVALID_REQUEST', 400)
  }
  const cleanContent = (typeof content === 'string' ? content : '').slice(0, MAX_CONTENT)
  const cleanAgent = normalizeAgent(agent)
  const cleanVariables = normalizeVariables(variables)
  const cleanTags = Array.isArray(tags)
    ? tags
        .filter((tag) => typeof tag === 'string' && tag.trim())
        .map((tag) => tag.trim().slice(0, 24))
        .slice(0, 10)
    : []
  return store.withLock('templates', async () => {
    const data = await readTemplateFile()
    const now = nowIso()
    const idProvided = id !== undefined && id !== null && id !== ''
    const bind = {
      bindWorkflowCategory:
        typeof bindWorkflowCategory === 'string' ? bindWorkflowCategory.trim().slice(0, 40) : '',
      bindWorkflowId:
        typeof bindWorkflowId === 'string' && /^wf_[0-9a-z]{8}$/i.test(bindWorkflowId)
          ? bindWorkflowId
          : '',
    }
    if (idProvided) {
      const index = data.templates.findIndex((item) => item.id === id)
      if (index < 0) throw new ApiError('模板不存在或已删除', 'INVALID_REQUEST', 404)
      const current = data.templates[index]
      const next = {
        ...current,
        name: cleanName,
        category:
          typeof category === 'string' && category.trim()
            ? category.trim().slice(0, 40)
            : current.category || '通用',
        content: cleanContent,
        kind: cleanKind,
        agent: cleanAgent,
        variables: cleanVariables,
        ...bind,
        tags: cleanTags.length ? cleanTags : current.tags,
        updatedAt: now,
      }
      data.templates[index] = next
      await writeTemplateFile(data)
      return { template: stripTemplate(next) }
    }
    if (data.templates.length >= MAX_TEMPLATES) {
      throw new ApiError(`最多只能保存 ${MAX_TEMPLATES} 个模板`, 'INVALID_REQUEST', 400)
    }
    const templateId = await newUniqueId(
      'tpl',
      (candidate) => data.templates.some((item) => item.id === candidate),
    )
    const template = {
      id: templateId,
      name: cleanName,
      category:
        typeof category === 'string' && category.trim() ? category.trim().slice(0, 40) : '通用',
      content: cleanContent,
      kind: cleanKind,
      agent: cleanAgent,
      variables: cleanVariables,
      ...bind,
      tags: cleanTags,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    data.templates.push(template)
    await writeTemplateFile(data)
    return { template: stripTemplate(template) }
  })
}

export async function deleteTemplate(id) {
  if (typeof id !== 'string' || !id) throw new ApiError('模板 ID 无效', 'INVALID_REQUEST', 400)
  return store.withLock('templates', async () => {
    const data = await readTemplateFile()
    const index = data.templates.findIndex((item) => item.id === id)
    if (index < 0) throw new ApiError('模板不存在或已删除', 'INVALID_REQUEST', 404)
    data.templates.splice(index, 1)
    await writeTemplateFile(data)
    return { ok: true }
  })
}

/** Bump usageCount when a template is inserted into the composer. */
export async function touchTemplate(id) {
  if (typeof id !== 'string' || !id) throw new ApiError('模板 ID 无效', 'INVALID_REQUEST', 400)
  return store.withLock('templates', async () => {
    const data = await readTemplateFile()
    const found = data.templates.find((item) => item.id === id)
    if (!found) return { ok: false, usageCount: 0 }
    found.usageCount = (found.usageCount || 0) + 1
    await writeTemplateFile(data)
    return { ok: true, usageCount: found.usageCount }
  })
}
