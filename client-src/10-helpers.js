    /* ------------------------------------------------------------------ */
    /* Generic helpers                                                     */
    /* ------------------------------------------------------------------ */

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value)
    const str = (value, fallback) => (typeof value === 'string' ? value : typeof fallback === 'string' ? fallback : '')
    const num = (value, fallback) => (typeof value === 'number' && isFinite(value) ? value : fallback)
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
    const nowIso = () => new Date().toISOString()
    const uid = (prefix) => `${prefix || ''}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    const cx = (...names) => names.filter(Boolean).join(' ')
    const pad2 = (value) => (value < 10 ? `0${value}` : String(value))

    function fmtDate(iso) {
      const date = new Date(iso || '')
      if (isNaN(date.getTime())) return ''
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
    }

    function fmtClock(iso) {
      const date = new Date(iso || '')
      if (isNaN(date.getTime())) return ''
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    function fmtDateTime(iso) {
      const datePart = fmtDate(iso)
      if (!datePart) return ''
      return `${datePart} ${fmtClock(iso)}`
    }

    function fmtRelative(iso) {
      const time = Date.parse(iso || '')
      if (!isFinite(time)) return ''
      const diff = Date.now() - time
      if (diff < 0) return '刚刚'
      if (diff < 60 * 1000) return '刚刚'
      if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
      if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`
      if (diff < 48 * 60 * 60 * 1000) return '昨天'
      if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)} 天前`
      return fmtDate(iso)
    }

    function fmtDuration(ms) {
      const value = num(ms, 0)
      if (value <= 0) return ''
      if (value < 60000) return `${(value / 1000).toFixed(1)} 秒`
      const minutes = Math.floor(value / 60000)
      const seconds = Math.round((value % 60000) / 1000)
      return `${minutes} 分 ${seconds} 秒`
    }

    function truncate(text, max) {
      const value = str(text).replace(/\s+/g, ' ').trim()
      const limit = Math.max(1, max)
      if (value.length <= limit) return value
      return `${value.slice(0, limit - 1)}…`
    }

    function formatBytes(bytes) {
      const value = num(bytes, 0)
      if (value <= 0) return '0 B'
      if (value < 1024) return `${value} B`
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
      return `${(value / 1024 / 1024).toFixed(1)} MB`
    }

    /* ---- v1.4 local files / cost helpers ------------------------------ */

    function formatMoney(value) {
      const number = num(value, 0)
      if (!isFinite(number)) return '¥0.00'
      return `¥${number.toFixed(2)}`
    }

    function formatRate(rate) {
      const number = num(rate, 0)
      if (!isFinite(number)) return '—'
      const pct = Math.max(0, Math.min(1, number)) * 100
      return `${Math.round(pct)}%`
    }

    /** Directory part of a Windows/posix absolute path (for folder.open). */
    function dirNameOf(filePath) {
      const value = str(filePath)
      if (!value) return ''
      const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'))
      if (index <= 0) return value
      return value.slice(0, index)
    }

    function isAbsoluteWindowsPath(value) {
      const text = str(value).trim()
      if (!text) return true // empty = use host default
      return /^[a-zA-Z]:[\\/]/.test(text) || /^\\\\/.test(text)
    }

    /* ------------------------------------------------------------------ */
    /* Model / dialect / params helpers                                    */
    /* ------------------------------------------------------------------ */

    // v1.2: local ComfyUI workflow helpers. Model ids use "comfy:<workflowId>".
    function isComfyModel(modelId) {
      return str(modelId).indexOf(COMFY_PREFIX) === 0
    }

    function comfyWorkflowIdOf(modelId) {
      return isComfyModel(modelId) ? str(modelId).slice(COMFY_PREFIX.length) : ''
    }

    function resolveDialect(modelId, models) {
      // v1.2: ComfyUI workflow models always win — no API dialect applies.
      if (isComfyModel(modelId)) return DIALECT.comfyui
      const list = Array.isArray(models) ? models : []
      const found = list.find((item) => item && item.id === modelId)
      const declared = found && found.dialect
      if (declared === DIALECT.openai || declared === DIALECT.xai) return declared
      if (/grok|xai/i.test(str(modelId))) return DIALECT.xai
      return DIALECT.openai
    }

    /** v1.2: keep only plain scalar workflow param values (host contract). */
    function normalizeWorkflowParams(raw) {
      const out = {}
      if (!isObj(raw)) return out
      for (const key of Object.keys(raw)) {
        const value = raw[key]
        if (typeof value === 'string' || typeof value === 'boolean') out[key] = value
        else if (typeof value === 'number' && isFinite(value)) out[key] = value
      }
      return out
    }

    /** v1.2.4: per-generation randomize flags for numeric workflow params. */
    function normalizeWorkflowRandomize(raw) {
      const out = {}
      if (!isObj(raw)) return out
      for (const key of Object.keys(raw)) {
        if (typeof raw[key] === 'boolean') out[key] = raw[key]
      }
      return out
    }

    /**
     * v1.2.4: the workflow's exposed `batch_size` input (if any). The composer's
     * 张数 selector is only shown when this exists — otherwise one prompt run
     * equals one image and a count selector would be misleading.
     */
    function workflowBatchSpec(workflow) {
      const params = workflow && Array.isArray(workflow.params) ? workflow.params : []
      return (
        params.find(
          (spec) =>
            spec &&
            spec.inputName === 'batch_size' &&
            (spec.type === 'int' || spec.type === 'float'),
        ) || null
      )
    }

    /** v1.2: one exposed parameter of a saved workflow (no `json`). */
    function normalizeWorkflowParamSpec(raw) {
      const source = isObj(raw) ? raw : {}
      const nodeId = str(source.nodeId)
      const inputName = str(source.inputName)
      if (!nodeId || !inputName) return null
      const type =
        ['text', 'int', 'float', 'bool', 'select'].indexOf(source.type) >= 0 ? source.type : 'text'
      const options = (Array.isArray(source.options) ? source.options : [])
        .map((item) =>
          typeof item === 'string' ? item : typeof item === 'number' ? String(item) : '',
        )
        .filter((item) => item !== '')
      const rawDefault = source.default
      let def
      if (type === 'bool') def = !!rawDefault
      else if (type === 'int') {
        def = isFinite(Number(rawDefault)) && rawDefault !== '' && rawDefault !== null
          ? Math.round(Number(rawDefault))
          : ''
      } else if (type === 'float') {
        def = isFinite(Number(rawDefault)) && rawDefault !== '' && rawDefault !== null
          ? Number(rawDefault)
          : ''
      } else def = typeof rawDefault === 'string' ? rawDefault : typeof rawDefault === 'number' ? String(rawDefault) : ''
      return {
        key: str(source.key) || `${nodeId}.${inputName}`,
        nodeId,
        inputName,
        label: str(source.label) || inputName,
        type,
        options,
        min: typeof source.min === 'number' && isFinite(source.min) ? source.min : null,
        max: typeof source.max === 'number' && isFinite(source.max) ? source.max : null,
        step: typeof source.step === 'number' && isFinite(source.step) ? source.step : null,
        default: def,
        role: source.role === 'prompt' ? 'prompt' : 'normal',
        randomize: !!source.randomize,
      }
    }

    /** v1.2: normalize one `comfy.workflow.list` row (defensive). */
    function normalizeWorkflow(raw) {
      const source = isObj(raw) ? raw : {}
      const id = str(source.id)
      if (!id) return null
      const params = (Array.isArray(source.params) ? source.params : [])
        .map(normalizeWorkflowParamSpec)
        .filter(Boolean)
      return {
        id,
        name: str(source.name) || id,
        paramCount: params.length,
        params,
        createdAt: str(source.createdAt),
        updatedAt: str(source.updatedAt),
      }
    }

    function normalizeWorkflowList(raw) {
      const list = Array.isArray(raw)
        ? raw
        : isObj(raw) && Array.isArray(raw.workflows)
          ? raw.workflows
          : []
      return list.map(normalizeWorkflow).filter(Boolean)
    }

    function findWorkflowById(workflows, id) {
      const list = Array.isArray(workflows) ? workflows : []
      const target = str(id)
      if (!target) return null
      return list.find((item) => item && item.id === target) || null
    }

    /* ---- v1.2 ComfyUI parameter-exposure editor draft ------------------ */

    const COMFY_PARAM_TYPES = ['text', 'int', 'float', 'bool', 'select']

    function comfyInputTypeOf(input) {
      const source = isObj(input) ? input : {}
      if (COMFY_PARAM_TYPES.indexOf(source.type) >= 0) return source.type
      if (typeof source.value === 'boolean') return 'bool'
      if (typeof source.value === 'number') {
        return Number.isInteger(source.value) ? 'int' : 'float'
      }
      return 'text'
    }

    function comfyDefaultText(type, value) {
      if (type === 'bool') return value === true || value === 'true' ? 'true' : 'false'
      if (type === 'int') return typeof value === 'number' ? String(Math.round(value)) : str(value)
      if (type === 'float') return typeof value === 'number' ? String(value) : str(value)
      return typeof value === 'number' || typeof value === 'boolean' ? String(value) : str(value)
    }

    function comfyNumberText(value) {
      return typeof value === 'number' && isFinite(value) ? String(value) : ''
    }

    /** v1.2: options for one workflow param (existing draft wins, then suggested, then inspect input). */
    function comfyOptionsOf(existingSpec, suggestedSpec, input) {
      const sources = [
        existingSpec && existingSpec.options,
        suggestedSpec && suggestedSpec.options,
        input && input.options,
      ]
      for (const list of sources) {
        if (!Array.isArray(list) || !list.length) continue
        const options = list
          .map((item) =>
            typeof item === 'string' ? item : typeof item === 'number' ? String(item) : '',
          )
          .filter((item) => item !== '')
        if (options.length) return options
      }
      return []
    }

    /**
     * v1.2: turn an inspect result (+ optional existing saved params) into the
     * editable draft consumed by ComfyParamEditor. Every scalar input of every
     * node is kept as a template; `selected` only marks the exposed ones.
     */
    function buildComfyEditorDraft(options) {
      const opts = isObj(options) ? options : {}
      const inspection = isObj(opts.inspection) ? opts.inspection : {}
      const suggested = Array.isArray(inspection.suggestedParams) ? inspection.suggestedParams : []
      const existing = Array.isArray(opts.existingParams) ? opts.existingParams : []
      const nodes = (Array.isArray(inspection.nodes) ? inspection.nodes : [])
        .filter((node) => isObj(node) && str(node.nodeId))
        .map((node) => ({
          nodeId: str(node.nodeId),
          classType: str(node.classType),
          title: str(node.title) || str(node.classType),
          inputs: (Array.isArray(node.inputs) ? node.inputs : []).filter(
            (input) => isObj(input) && str(input.inputName),
          ),
        }))
      const matchSpec = (list, nodeId, inputName) =>
        list.find(
          (spec) =>
            isObj(spec) && str(spec.nodeId) === nodeId && str(spec.inputName) === inputName,
        ) || null
      const selected = {}
      const templates = {}
      for (const node of nodes) {
        for (const input of node.inputs) {
          const matchKey = `${node.nodeId}.${input.inputName}`
          const existingSpec = matchSpec(existing, node.nodeId, input.inputName)
          const suggestedSpec = matchSpec(suggested, node.nodeId, input.inputName)
          const sourceSpec = existingSpec || suggestedSpec || null
          const type =
            sourceSpec && COMFY_PARAM_TYPES.indexOf(sourceSpec.type) >= 0
              ? sourceSpec.type
              : comfyInputTypeOf(input)
          const optionList = comfyOptionsOf(existingSpec, suggestedSpec, input)
          const min = sourceSpec && typeof sourceSpec.min === 'number'
            ? sourceSpec.min
            : typeof input.min === 'number'
              ? input.min
              : null
          const max = sourceSpec && typeof sourceSpec.max === 'number'
            ? sourceSpec.max
            : typeof input.max === 'number'
              ? input.max
              : null
          const step = sourceSpec && typeof sourceSpec.step === 'number'
            ? sourceSpec.step
            : typeof input.step === 'number'
              ? input.step
              : null
          templates[matchKey] = {
            key: sourceSpec ? str(sourceSpec.key) : '',
            nodeId: node.nodeId,
            inputName: input.inputName,
            label: sourceSpec && str(sourceSpec.label) ? str(sourceSpec.label) : input.inputName,
            type,
            optionsText: optionList.join('\n'),
            minText: comfyNumberText(min),
            maxText: comfyNumberText(max),
            stepText: comfyNumberText(step),
            defaultText: comfyDefaultText(
              type,
              sourceSpec && sourceSpec.default !== undefined ? sourceSpec.default : input.value,
            ),
            role: sourceSpec && sourceSpec.role === 'prompt' ? 'prompt' : 'normal',
            randomize: !!(sourceSpec && sourceSpec.randomize),
          }
          // v1.2.2: when re-editing a saved workflow only ITS OWN params are
          // pre-checked. Suggested params must never re-tick what the user
          // explicitly cleared in an earlier edit round.
          if (existingSpec) selected[matchKey] = true
          else if (!str(opts.id) && suggestedSpec) selected[matchKey] = true
        }
      }
      return {
        id: str(opts.id),
        name: str(opts.name),
        json: isObj(opts.json) ? opts.json : {},
        nodes,
        outputs: Array.isArray(inspection.outputs) ? inspection.outputs : [],
        warnings: (Array.isArray(inspection.warnings) ? inspection.warnings : [])
          .map((item) => str(item))
          .filter(Boolean),
        suggestedParams: suggested,
        selected,
        templates,
        isNew: !str(opts.id),
      }
    }

    function parseComfyNumber(raw) {
      const text = str(raw).trim()
      if (!text) return null
      const value = Number(text)
      return isFinite(value) ? value : null
    }

    function parseComfyDefault(raw, type) {
      const text = str(raw)
      if (type === 'bool') return text.trim() === 'true'
      if (type === 'int') {
        const value = Number(text)
        return isFinite(value) && text.trim() !== '' ? Math.round(value) : 0
      }
      if (type === 'float') {
        const value = Number(text)
        return isFinite(value) && text.trim() !== '' ? value : 0
      }
      return text
    }

    function modelLabel(modelId, models) {
      const list = Array.isArray(models) ? models : []
      const found = list.find((item) => item && item.id === modelId)
      if (found && found.label) return found.label
      return str(modelId) || '未选择模型'
    }

    function qualityOptions(dialect) {
      return dialect === DIALECT.xai ? QUALITY_XAI : QUALITY_OPENAI
    }

    function zeroParams() {
      return {
        model: '',
        size: DEFAULT_PARAMS.size,
        quality: DEFAULT_PARAMS.quality,
        aspectRatio: DEFAULT_PARAMS.aspectRatio,
        resolution: DEFAULT_PARAMS.resolution,
        n: DEFAULT_PARAMS.n,
        workflowId: DEFAULT_PARAMS.workflowId,
        workflowParams: {},
        workflowRandomize: {},
      }
    }

    function normalizeGenParams(raw) {
      const source = isObj(raw) ? raw : {}
      const params = zeroParams()
      for (const key of ['model', 'size', 'quality', 'aspectRatio', 'resolution']) {
        if (typeof source[key] === 'string' && source[key]) params[key] = source[key]
      }
      params.n = clamp(Math.round(num(source.n, DEFAULT_PARAMS.n)), 1, 10)
      // v1.2: ComfyUI workflow mode. `comfy:<id>` models are allowed here (no
      // model validation), and the persisted workflow values are sanitized.
      params.workflowId = comfyWorkflowIdOf(source.model) || str(source.workflowId)
      params.workflowParams = normalizeWorkflowParams(source.workflowParams)
      params.workflowRandomize = normalizeWorkflowRandomize(source.workflowRandomize)
      return params
    }

    function cleanGenParams(params, models, workflows) {
      const source = isObj(params) ? params : {}
      const dialect = resolveDialect(str(source.model), models)
      const result = {
        model: str(source.model),
        n: clamp(Math.round(num(source.n, 1)), 1, 4),
      }
      if (dialect === DIALECT.comfyui) {
        // v1.2: only the workflow payload is sent. The host ignores unknown
        // workflowParams keys, but we narrow to the schema-declared keys when
        // the workflow list is loaded so stale params never linger.
        const workflowId = comfyWorkflowIdOf(source.model) || str(source.workflowId)
        const workflow = findWorkflowById(workflows, workflowId)
        const scalar = normalizeWorkflowParams(source.workflowParams)
        if (workflow && workflow.params.length) {
          const declared = new Set(workflow.params.map((spec) => spec.key))
          const narrowed = {}
          for (const key of Object.keys(scalar)) {
            if (declared.has(key)) narrowed[key] = scalar[key]
          }
          result.workflowParams = narrowed
        } else {
          result.workflowParams = scalar
        }
        result.workflowId = workflowId
        if (workflow && workflow.name) result.displayName = workflow.name
        // v1.2.4: 张数 is only meaningful when the workflow exposes batch_size.
        // Other workflows run exactly once per send (one image per run).
        if (!workflowBatchSpec(workflow)) result.n = 1
        // v1.2.4: send the effective randomize flag for every declared numeric
        // param so the composer toggle works without editing the saved workflow.
        const randomizeSource = normalizeWorkflowRandomize(source.workflowRandomize)
        const randomize = {}
        const declaredParams = workflow && Array.isArray(workflow.params) ? workflow.params : []
        for (const spec of declaredParams) {
          if (!spec) continue
          if (spec.inputName === 'batch_size') continue
          if (spec.type !== 'int' && spec.type !== 'float') continue
          randomize[spec.key] = Object.prototype.hasOwnProperty.call(randomizeSource, spec.key)
            ? !!randomizeSource[spec.key]
            : !!spec.randomize
        }
        result.workflowRandomize = randomize
        return result
      }
      if (dialect === DIALECT.xai) {
        result.aspectRatio = str(source.aspectRatio) || 'auto'
        result.resolution = str(source.resolution) || '1k'
        // C1: defensive clamp — "high" is not a valid xAI quality and would be
        // rejected by the host, so never ship an out-of-dialect value.
        result.quality = QUALITY_XAI.indexOf(str(source.quality)) >= 0 ? str(source.quality) : 'auto'
      } else {
        result.size = str(source.size) || 'auto'
        result.quality = QUALITY_OPENAI.indexOf(str(source.quality)) >= 0 ? str(source.quality) : 'auto'
      }
      return result
    }

    /* ------------------------------------------------------------------ */
    /* Data normalizers (defensive: host payloads may be partial)          */
    /* ------------------------------------------------------------------ */

    function fileUrl(id) {
      return `${API}/file?id=${encodeURIComponent(str(id))}`
    }

    function imageSrc(meta) {
      const url = str(meta && meta.url)
      if (url && (url.startsWith('/') || url.startsWith('data:') || url.startsWith('http'))) return url
      const id = str(meta && meta.id)
      return id ? fileUrl(id) : ''
    }

    function normalizeRef(raw) {
      const source = isObj(raw) ? raw : {}
      const id = str(source.id) || str(source.imageId)
      if (!id) return null
      return {
        id,
        url: str(source.url) || fileUrl(id),
        name: str(source.name) || '参考图',
        mime: str(source.mime),
        w: Math.max(0, Math.round(num(source.w, 0))),
        h: Math.max(0, Math.round(num(source.h, 0))),
        bytes: Math.max(0, Math.round(num(source.bytes, 0))),
        localPath: str(source.localPath),
        source: source.source === 'upload' ? 'upload' : 'generated',
      }
    }

    function normalizeRefList(raw) {
      return (Array.isArray(raw) ? raw : []).map(normalizeRef).filter(Boolean)
    }

    function normalizeImage(raw) {
      const source = isObj(raw) ? raw : {}
      const id = str(source.id)
      if (!id) return null
      return {
        id,
        turnId: str(source.turnId),
        url: str(source.url) || fileUrl(id),
        name: str(source.name) || '生成图',
        mime: str(source.mime),
        w: Math.max(0, Math.round(num(source.w, 0))),
        h: Math.max(0, Math.round(num(source.h, 0))),
        bytes: Math.max(0, Math.round(num(source.bytes, 0))),
        createdAt: str(source.createdAt),
        prompt: str(source.prompt),
        model: str(source.model),
        localPath: str(source.localPath),
        params: normalizeGenParams(source.params),
        refs: normalizeRefList(source.refs),
      }
    }

    function normalizeTurn(raw) {
      const source = isObj(raw) ? raw : {}
      const id = str(source.id)
      if (!id) return null
      const status = ['running', 'done', 'error', 'cancelled'].indexOf(source.status) >= 0 ? source.status : 'done'
      return {
        id,
        // v1.1: persisted job id lets the client resume polling / cancel a
        // running turn after a page reload (old turns may not have one).
        jobId: str(source.jobId),
        createdAt: str(source.createdAt),
        finishedAt: str(source.finishedAt) || null,
        prompt: str(source.prompt),
        // v1.4 §C: keep the host's additive mode marker (e.g. 'image_edit') so
        // the detail overlay can show the 重绘蒙版 section; normalizeGenParams
        // only carries the generation fields.
        params: Object.assign(normalizeGenParams(source.params), {
          mode: isObj(source.params) && typeof source.params.mode === 'string' ? source.params.mode : '',
        }),
        refs: normalizeRefList(source.refs),
        status,
        error: str(source.error) || null,
        // v1.4 §C: inpainted turns persist the uploaded mask metadata.
        mask: source.mask ? normalizeRef(source.mask) : null,
        images: (Array.isArray(source.images) ? source.images : []).map(normalizeImage).filter(Boolean),
      }
    }

    function normalizeConversation(raw) {
      const source = isObj(raw) ? raw : {}
      const id = str(source.id)
      if (!id) return null
      return {
        id,
        workspaceId: str(source.workspaceId),
        title: str(source.title) || '新会话',
        createdAt: str(source.createdAt),
        updatedAt: str(source.updatedAt) || str(source.createdAt),
        turns: (Array.isArray(source.turns) ? source.turns : []).map(normalizeTurn).filter(Boolean),
      }
    }

    function normalizeConversationSummary(raw) {
      const source = isObj(raw) ? raw : {}
      const id = str(source.id)
      if (!id) return null
      return {
        id,
        title: str(source.title) || '新会话',
        createdAt: str(source.createdAt),
        updatedAt: str(source.updatedAt) || str(source.createdAt),
        imageCount: Math.max(0, Math.round(num(source.imageCount, 0))),
        lastPrompt: str(source.lastPrompt),
      }
    }

    function normalizeWorkspace(raw) {
      const source = isObj(raw) ? raw : {}
      const id = str(source.id)
      if (!id) return null
      return {
        id,
        name: str(source.name) || '未命名工作区',
        createdAt: str(source.createdAt),
        updatedAt: str(source.updatedAt) || str(source.createdAt),
        conversations: (Array.isArray(source.conversations) ? source.conversations : [])
          .map(normalizeConversationSummary)
          .filter(Boolean),
      }
    }

    function normalizeWorkspaceList(raw) {
      return (Array.isArray(raw) ? raw : []).map(normalizeWorkspace).filter(Boolean)
    }

    const COST_TIERS = ['1K', '2K', '4K']
    const GPT_IMAGE_RE = /gpt[-_ ]?image/i

    function roundCost(value) {
      return Math.round(value * 10000) / 10000
    }

    /** v1.8: GPT image models support 1K/2K/4K tiered unit prices. */
    function isGptImageModel(modelId) {
      return GPT_IMAGE_RE.test(str(modelId))
    }

    function normalizeModelCosts(raw) {
      const out = {}
      if (!isObj(raw)) return out
      for (const key of Object.keys(raw)) {
        const modelId = str(key).trim()
        if (!modelId) continue
        const value = raw[key]
        if (typeof value === 'number') {
          if (!isFinite(value) || value < 0) continue
          out[modelId] = roundCost(value)
          continue
        }
        if (isObj(value)) {
          const tiers = {}
          for (const tier of COST_TIERS) {
            const tierValue = num(value[tier], 0)
            tiers[tier] = isFinite(tierValue) && tierValue >= 0 ? roundCost(tierValue) : 0
          }
          out[modelId] = tiers
        }
      }
      return out
    }

    /**
     * Normalize any stored modelCosts value (flat number OR tier object) to a
     * complete { '1K': n, '2K': n, '4K': n } set for display/editing. A legacy
     * flat number is mirrored into all three tiers.
     */
    function modelCostTiers(costValue) {
      if (isObj(costValue)) {
        const tiers = {}
        for (const tier of COST_TIERS) {
          const value = num(costValue[tier], 0)
          tiers[tier] = isFinite(value) && value >= 0 ? roundCost(value) : 0
        }
        return tiers
      }
      const flat = num(costValue, 0)
      const value = isFinite(flat) && flat >= 0 ? roundCost(flat) : 0
      return { '1K': value, '2K': value, '4K': value }
    }

    /** v1.8: non-GPT models use a single flat price; an object config's 1K wins. */
    function modelCostFlat(costValue) {
      if (isObj(costValue)) return modelCostTiers(costValue)['1K']
      const value = num(costValue, 0)
      return isFinite(value) && value >= 0 ? roundCost(value) : 0
    }

    function normalizeSettings(raw) {
      const source = isObj(raw) ? raw : {}
      const defaultSource = isObj(source.defaults) ? source.defaults : {}
      const models = (Array.isArray(source.models) ? source.models : [])
        .filter((item) => isObj(item) && str(item.id).trim())
        .map((item) => ({
          id: str(item.id).trim(),
          label: str(item.label).trim() || str(item.id).trim(),
          dialect:
            item.dialect === DIALECT.openai || item.dialect === DIALECT.xai ? item.dialect : 'auto',
        }))
      const defaults = zeroParams()
      for (const key of ['model', 'size', 'quality', 'aspectRatio', 'resolution']) {
        if (typeof defaultSource[key] === 'string' && defaultSource[key]) defaults[key] = defaultSource[key]
      }
      defaults.n = clamp(Math.round(num(defaultSource.n, 1)), 1, 4)
      return {
        baseUrl: str(source.baseUrl),
        apiKeySet: !!source.apiKeySet,
        apiKeyHint: str(source.apiKeyHint),
        models,
        defaults,
        jobTimeoutMs: clamp(
          Math.round(num(source.jobTimeoutMs, DEFAULT_JOB_TIMEOUT_MS)),
          JOB_TIMEOUT_MIN_MS,
          JOB_TIMEOUT_MAX_MS,
        ),
        // v1.2: SafeSettings.proxyUrl is already password-masked by the host;
        // proxySet says whether an explicit proxy is configured.
        proxyUrl: str(source.proxyUrl),
        proxySet: !!source.proxySet,
        // v1.10: first-run proxy onboarding state.
        proxyAuto: !!source.proxyAuto,
        onboardDone: !!source.onboardDone,
        // v1.4: local storage/save directories + per-model estimated cost (¥).
        imageDir: str(source.imageDir),
        saveDir: str(source.saveDir),
        // v1.2: local ComfyUI service address ('' = not configured).
        comfyBaseUrl: str(source.comfyBaseUrl),
        modelCosts: normalizeModelCosts(source.modelCosts),
        envFallback: !!source.envFallback,
      }
    }

    /** v1.10: bootstrap.proxyOnboarding → Client-side onboarding model. */
    function normalizeProxyOnboarding(raw) {
      if (!isObj(raw)) return null
      const mode = raw.mode === 'auto' ? 'auto' : 'prompt'
      const candidates = (Array.isArray(raw.candidates) ? raw.candidates : [])
        .filter((item) => isObj(item) && str(item.url).trim())
        .slice(0, 8)
        .map((item) => ({
          url: str(item.url).trim(),
          source: str(item.source),
          verified: !!item.verified,
          needsAuth: !!item.needsAuth,
        }))
      const configuredUrl = str(raw.configuredUrl)
      if (mode === 'auto' && !configuredUrl) return null
      return {
        mode,
        candidates,
        configuredUrl,
        replacedUrl: str(raw.replacedUrl),
        reason: str(raw.reason),
        target: str(raw.target),
      }
    }

    function refFromImage(image) {
      const source = isObj(image) ? image : {}
      return {
        id: str(source.id),
        url: imageSrc(source),
        name: str(source.name) || '生成图',
        mime: str(source.mime),
        w: Math.max(0, Math.round(num(source.w, 0))),
        h: Math.max(0, Math.round(num(source.h, 0))),
        bytes: Math.max(0, Math.round(num(source.bytes, 0))),
        source: 'generated',
      }
    }

    function requestedCount(turn) {
      return clamp(Math.round(num(turn && turn.params && turn.params.n, 1)), 1, 10)
    }

    function isBatchTurn(turn) {
      if (!turn) return false
      if (turn.status === 'running') return requestedCount(turn) >= 2
      const images = Array.isArray(turn.images) ? turn.images : []
      return images.length >= 2
    }

    function jobProgressText(job) {
      if (!isObj(job)) return '生成中…'
      const status = str(job.status) || 'running'
      const pct = Math.round(clamp(num(job.progress, 0), 0, 1) * 100)
      if (status === 'queued') return '排队中…'
      if (status === 'done') return '已完成'
      const label = JOB_STATUS_LABEL[status] || '生成中'
      return status === 'running' ? `${label} · ${pct}%` : label
    }

    /* ------------------------------------------------------------------ */
    /* Storage                                                             */
    /* ------------------------------------------------------------------ */

    function loadUiState() {
      try {
        const raw = window.localStorage.getItem(UI_STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return isObj(parsed) ? parsed : {}
      } catch (error) {
        return {}
      }
    }

    function saveUiState(payload) {
      try {
        window.localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(payload))
      } catch (error) {
        // localStorage may be unavailable/full: UI state memory is best effort.
      }
    }

    /* ------------------------------------------------------------------ */
    /* Clipboard / files                                                   */
    /* ------------------------------------------------------------------ */

    async function copyText(text) {
      const value = str(text)
      if (!value) throw new Error('没有可复制的内容')
      // No document.body fallback: CONTRACT §2 forbids appending to the app
      // body from a plugin. DSH runs on a secure localhost origin, so the
      // async clipboard API is available; otherwise ask the user to copy
      // manually (the prompt is displayed as selectable text).
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        throw new Error('当前环境不支持剪贴板，请手动选择提示词复制')
      }
      await navigator.clipboard.writeText(value)
    }

    function readFileBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = String(reader.result || '')
          const index = result.indexOf(',')
          resolve(index >= 0 ? result.slice(index + 1) : result)
        }
        reader.onerror = () => reject(new Error('读取文件失败'))
        reader.readAsDataURL(file)
      })
    }

    /* ------------------------------------------------------------------ */
    /* RPC                                                                 */
    /* ------------------------------------------------------------------ */

    async function rpc(op, params) {
      let response
      try {
        response = await fetch(`${API}/rpc`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op, ...(params || {}) }),
        })
      } catch (error) {
        throw new Error('无法连接插件后端，请刷新页面重试')
      }
      let payload = null
      try {
        payload = await response.json()
      } catch (error) {
        payload = null
      }
      if (!response.ok || !payload || payload.ok !== true) {
        const failure = new Error(
          (payload && payload.error) || `请求失败（HTTP ${response.status}）`,
        )
        if (payload && payload.code) failure.code = payload.code
        // C2: expose the HTTP status so callers can fail fast on 404 etc.
        failure.status = response.status
        throw failure
      }
      return payload.data
    }

    function reportLog(level, message) {
      try {
        rpc('client.log', { level, message: String(message).slice(0, 3000) }).catch(() => {})
      } catch (error) {
        // reporting must never break the page
      }
    }

    function localeFrom(ctx) {
      try {
        const snapshot = ctx.locale.getLocale()
        const id = snapshot && (snapshot.id || snapshot.locale || snapshot.current || snapshot.value)
        return String(id || 'zh')
          .toLowerCase()
          .startsWith('en')
          ? 'en'
          : 'zh'
      } catch (error) {
        return 'zh'
      }
    }

