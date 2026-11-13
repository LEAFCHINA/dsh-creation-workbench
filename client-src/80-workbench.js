    /* ------------------------------------------------------------------ */
    /* Top bar                                                             */
    /* ------------------------------------------------------------------ */

    function Topbar(props) {
      // v1.3: 「新对话」「设置」buttons were duplicates of the sidebar entries
      // (新会话 / API 设置) and are removed; only the refresh action remains.
      const {
        activeWorkspace,
        conversation,
        conversationLoading,
        onRefresh,
        refreshing,
        taskCount,
        onOpenTasks,
      } = props
      return h(
        'div',
        { className: 'iw-topbar' },
        h(
          'div',
          { className: 'iw-crumbs' },
          h(
            'span',
            { className: 'iw-crumb' },
            activeWorkspace ? activeWorkspace.name : '未选择工作区',
          ),
          h('span', { className: 'iw-crumb-sep' }, '›'),
          h(
            'span',
            { className: 'iw-crumb-strong' },
            conversation ? conversation.title : activeWorkspace ? '未选择会话' : '',
          ),
          conversationLoading ? h(Spinner, { size: 11 }) : null,
        ),
        h('div', { className: 'iw-topbar-spacer' }),
        h(
          'button',
          {
            type: 'button',
            className: cx('iw-topbar-tasks', taskCount > 0 && 'busy'),
            title:
              taskCount > 0
                ? `${taskCount} 个生成任务进行中（跨会话）`
                : '生成任务（跨会话）',
            onClick: onOpenTasks,
          },
          taskCount > 0 ? h(Spinner, { size: 12 }) : h(Icon, { name: 'dots', size: 14 }),
          h('span', null, taskCount > 0 ? `任务 ${taskCount}` : '任务'),
        ),
        h(IconButton, {
          name: 'refresh',
          title: '刷新当前会话',
          onClick: onRefresh,
          disabled: !activeWorkspace || !!refreshing,
        }),
      )
    }

    /**
     * v1.2.6 (P0-1): cross-session task panel. Rows come from the host's
     * `job.list` (all running/queued jobs, regardless of the open conversation)
     * and can be cancelled from here.
     */
    function TaskPanel(props) {
      const items = Array.isArray(props.items) ? props.items : []
      const workspaceName = (wsId) => {
        const workspace = (props.workspaces || []).find((item) => item.id === wsId)
        return workspace && workspace.name ? workspace.name : '工作区'
      }
      const conversationTitle = (wsId, convId) => {
        const workspace = (props.workspaces || []).find((item) => item.id === wsId)
        const list = workspace && Array.isArray(workspace.conversations) ? workspace.conversations : []
        const conversation = list.find((item) => item.id === convId)
        return conversation && conversation.title ? conversation.title : '会话'
      }
      return h(
        Modal,
        {
          title: '生成任务',
          subtitle: items.length
            ? `${items.length} 个任务进行中（跨会话）`
            : '当前没有进行中的生成任务',
          onClose: props.onClose,
          width: 640,
          className: 'iw-settings',
        },
        items.length
          ? h(
              'div',
              { className: 'iw-task-list' },
              items.map((job) => {
                const name = str(job.displayName) || str(job.model) || '生成任务'
                const queued = job.status === 'queued' || job.stage === 'queued'
                const baseStatus = jobProgressText(job)
                const startedAt = Date.parse(str(job.startedAt))
                const elapsed =
                  !queued && Number.isFinite(startedAt)
                    ? Math.max(0, Math.round((Date.now() - startedAt) / 1000))
                    : 0
                const statusText =
                  !queued && elapsed > 0 && job.status === 'running'
                    ? `${baseStatus} · 已用 ${elapsed}s`
                    : baseStatus
                const pct = Math.round(clamp(num(job.progress, 0), 0, 1) * 100)
                return h(
                  'div',
                  { key: job.jobId, className: 'iw-task-row' },
                  h(
                    'div',
                    { className: 'iw-task-main' },
                    h('div', { className: 'iw-task-title' }, name),
                    h(
                      'div',
                      { className: 'iw-task-meta' },
                      `${workspaceName(job.workspaceId)} › ${conversationTitle(job.workspaceId, job.conversationId)}${
                        str(job.prompt) ? ` · ${truncate(job.prompt, 44)}` : ''
                      }`,
                    ),
                    h(
                      'div',
                      { className: 'iw-task-progress' },
                      h(
                        'span',
                        { className: 'iw-progress-track' },
                        h('span', {
                          className: 'iw-progress-fill',
                          style: { width: `${pct}%` },
                        }),
                      ),
                      h('span', { className: 'iw-task-stage' }, statusText),
                    ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'iw-btn iw-btn-sm',
                      disabled: props.cancellingId === job.jobId,
                      onClick: () => props.onCancel(job.jobId),
                    },
                    props.cancellingId === job.jobId ? '取消中…' : '取消',
                  ),
                )
              }),
            )
          : h(
              'div',
              { className: 'iw-settings-empty' },
              '任务完成后会从列表消失；生成中的任务可以在这里直接取消。',
            ),
      )
    }

    /* ------------------------------------------------------------------ */
    /* Workbench (state container)                                         */
    /* ------------------------------------------------------------------ */

    function greetingText() {
      const hour = new Date().getHours()
      if (hour < 5) return '夜深了'
      if (hour < 11) return '早上好'
      if (hour < 14) return '中午好'
      if (hour < 18) return '下午好'
      if (hour < 23) return '晚上好'
      return '夜深了'
    }

    /**
     * v2.1: workspace home. Shows a greeting + 「编辑 / 生成」intent picker when
     * the conversation is empty; choosing a category pre-selects the newest
     * workflow of that category (or the first API model for image) and focuses
     * the composer.
     */
    function HomeHero(props) {
      const [expanded, setExpanded] = useState(false)
      const workflows = Array.isArray(props.workflows) ? props.workflows : []
      const models = Array.isArray(props.models) ? props.models : []
      const countOf = (category) =>
        workflows.filter((workflow) => str(workflow.category) === category).length
      const categories = [
        { id: 'image', label: '生成图片', icon: 'image', ok: countOf('image') > 0 || models.length > 0 },
        { id: 'video', label: '生成视频', icon: 'chart', ok: countOf('video') > 0 },
        { id: 'audio', label: '生成声音', icon: 'dots', ok: countOf('audio') > 0 },
        { id: 'model', label: '生成模型', icon: 'folder', ok: countOf('model') > 0 },
      ]
      return h(
        'div',
        { className: 'iw-home' },
        h('div', { className: 'iw-home-greet' }, `${greetingText()}~ 现在想干什么呀？`),
        h(
          'div',
          { className: 'iw-home-actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'iw-home-action',
              title: '从一张图开始编辑（后续版本支持参考图输入）',
              onClick: () => props.onEdit(),
            },
            h(Icon, { name: 'pencil', size: 15 }),
            h('span', null, '编辑'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: cx('iw-home-action', 'primary', expanded && 'active'),
              title: '选择生成类型',
              onClick: () => setExpanded((value) => !value),
            },
            h(Icon, { name: 'spark', size: 15 }),
            h('span', null, '生成'),
          ),
        ),
        expanded
          ? h(
              'div',
              { className: 'iw-home-categories' },
              categories.map((category) =>
                h(
                  'button',
                  {
                    key: category.id,
                    type: 'button',
                    className: cx('iw-home-category', category.ok && 'ready'),
                    title: category.ok
                      ? `使用「${workflowCategoryLabel(category.id)}」分类的工作流或模型`
                      : '该分类还没有工作流，点击去设置导入',
                    onClick: () =>
                      category.ok ? props.onGenerate(category.id) : props.onOpenSettings(),
                  },
                  h(Icon, { name: category.icon, size: 13 }),
                  h('span', null, category.label),
                ),
              ),
            )
          : null,
        h(
          'div',
          { className: 'iw-home-hint' },
          '也可以直接在下方输入框描述，按 Enter 发送',
        ),
      )
    }


    /** v2.1: full-page workflow manager grouped by category. */
    function WorkflowBoard(props) {
      const workflows = Array.isArray(props.workflows) ? props.workflows : []
      const byCategory = new Map()
      for (const workflow of workflows) {
        const category = str(workflow.category) || 'image'
        if (!byCategory.has(category)) byCategory.set(category, [])
        byCategory.get(category).push(workflow)
      }
      const categories = [...byCategory.keys()].sort(compareWorkflowCategory)
      return h(
        'div',
        { className: 'iw-board' },
        h(
          'div',
          { className: 'iw-board-head' },
          h('div', { className: 'iw-board-title' }, '工作流'),
          h(
            'div',
            { className: 'iw-board-sub' },
            `共 ${workflows.length} 个，按分类分组。编辑参数、导入新工作流都在设置里。`,
          ),
          h(
            'button',
            { type: 'button', className: 'iw-btn', onClick: props.onOpenSettings },
            h(Icon, { name: 'plus', size: 13 }),
            '导入 / 管理',
          ),
        ),
        workflows.length === 0
          ? h(
              'div',
              { className: 'iw-main-empty' },
              h(Icon, { name: 'chart', size: 30 }),
              h('div', { className: 'iw-main-empty-title' }, '还没有工作流'),
              h(
                'div',
                { className: 'iw-main-empty-desc' },
                '在设置 → ComfyUI 里导入 API 格式的工作流，并选择它的分类。',
              ),
              h(
                'button',
                { type: 'button', className: 'iw-home-action primary', onClick: props.onOpenSettings },
                '打开设置',
              ),
            )
          : categories.map((category) => {
              const list = byCategory.get(category) || []
              return h(
                'section',
                { key: category, className: 'iw-board-group' },
                h(
                  'div',
                  { className: 'iw-board-group-head' },
                  h('span', { className: 'iw-board-group-title' }, workflowCategoryLabel(category)),
                  h('span', { className: 'iw-board-group-count' }, `${list.length} 个`),
                ),
                h(
                  'div',
                  { className: 'iw-workflow-grid' },
                  list.map((workflow) =>
                    h(
                      'div',
                      { key: workflow.id, className: 'iw-workflow-card' },
                      h(
                        'div',
                        { className: 'iw-workflow-card-head' },
                        h(
                          'span',
                          { className: 'iw-workflow-card-name', title: workflow.name },
                          workflow.name,
                        ),
                        h('span', { className: 'iw-tag' }, workflowCategoryLabel(workflow.category)),
                      ),
                      h(
                        'div',
                        { className: 'iw-workflow-card-meta' },
                        `${workflow.paramCount || 0} 个参数 · 更新于 ${
                          workflow.updatedAt ? fmtRelative(workflow.updatedAt) : '—'
                        }`,
                      ),
                      h(
                        'div',
                        { className: 'iw-workflow-card-actions' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'iw-btn',
                            onClick: () => props.onUse(workflow.id),
                          },
                          '使用',
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'iw-btn',
                            onClick: () => props.onEditWorkflow(workflow.id),
                          },
                          '编辑参数',
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'iw-btn iw-btn-danger',
                            onClick: () => props.onDelete(workflow),
                          },
                          '删除',
                        ),
                      ),
                    ),
                  ),
                ),
              )
            }),
      )
    }

    function ComingSoon(props) {
      return h(
        'div',
        { className: 'iw-main-empty' },
        h(Icon, { name: props.icon || 'spark', size: 30 }),
        h('div', { className: 'iw-main-empty-title' }, props.title),
        h('div', { className: 'iw-main-empty-desc' }, props.desc),
        props.badge ? h('div', { className: 'iw-side-tabinfo-badge' }, props.badge) : null,
      )
    }

    /**
     * v2.2: template editor. Detects `{{变量}}` in the content automatically,
     * lets the user set defaults, shows a rendered preview and can insert the
     * result straight into the composer.
     */
    function TemplateBoard(props) {
      const selected = isObj(props.template) ? props.template : null
      const draftKey = selected ? str(selected.id) || 'new-template' : 'no-template'
      const [name, setName] = useState(() => (selected ? str(selected.name) : ''))
      const [category, setCategory] = useState(() => (selected ? str(selected.category) : '通用'))
      const [content, setContent] = useState(() => (selected ? str(selected.content) : ''))
      const [bindCategory, setBindCategory] = useState(() =>
        selected ? str(selected.bindWorkflowCategory) : '',
      )
      const [kind, setKind] = useState(() => (selected && selected.kind === 'agent' ? 'agent' : 'text'))
      const [agentMode, setAgentMode] = useState(() =>
        selected && selected.mode === 'single' ? 'single' : 'chat',
      )
      const [agentSystem, setAgentSystem] = useState(() =>
        selected && isObj(selected.agent) ? str(selected.agent.systemPrompt) : '',
      )
      const [agentUser, setAgentUser] = useState(() =>
        selected && isObj(selected.agent) ? str(selected.agent.userTemplate) : '',
      )
      const [agentFormat, setAgentFormat] = useState(() =>
        selected && isObj(selected.agent) && selected.agent.outputFormat === 'prompt_negative'
          ? 'prompt_negative'
          : 'prompt',
      )
      const [agentModelName, setAgentModelName] = useState(() =>
        selected && isObj(selected.agent) ? str(selected.agent.model) : '',
      )
      const [agentInputs, setAgentInputs] = useState(() => {
        const list =
          selected && isObj(selected.agent) && Array.isArray(selected.agent.inputTypes)
            ? selected.agent.inputTypes
            : ['text', 'image']
        return { text: list.indexOf('text') >= 0, image: list.indexOf('image') >= 0 }
      })
      // Agent connection settings (echoed from safeSettings).
      const agentSettings = isObj(props.agentSettings) ? props.agentSettings : {}
      const [agSource, setAgSource] = useState(() =>
        agentSettings.agentSource === 'dsh' ? 'dsh' : 'api',
      )
      const [agBase, setAgBase] = useState(() => str(agentSettings.agentBaseUrl))
      const [agKey, setAgKey] = useState('')
      const [agModel, setAgModel] = useState(() => str(agentSettings.agentModel))
      const [agRetention, setAgRetention] = useState(() =>
        Number.isFinite(Number(agentSettings.agentRetentionDays))
          ? Number(agentSettings.agentRetentionDays)
          : 0,
      )
      const [agProvider, setAgProvider] = useState(() => str(agentSettings.agentDshProvider))
      const [agDshModel, setAgDshModel] = useState(() => str(agentSettings.agentDshModel))
      const [dshModels, setDshModels] = useState(null)
      const [dshBusy, setDshBusy] = useState(false)
      const [agBusy, setAgBusy] = useState(false)
      const [agMsg, setAgMsg] = useState('')
      const [varDrafts, setVarDrafts] = useState({})
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const loadedKeyRef = useRef('')
      useEffect(() => {
        if (loadedKeyRef.current === draftKey) return
        loadedKeyRef.current = draftKey
        setName(selected ? str(selected.name) : '')
        setCategory(selected ? str(selected.category) : '通用')
        setContent(selected ? str(selected.content) : '')
        setBindCategory(selected ? str(selected.bindWorkflowCategory) : '')
        setKind(selected && selected.kind === 'agent' ? 'agent' : 'text')
        setAgentMode(selected && selected.mode === 'single' ? 'single' : 'chat')
        setAgentSystem(selected && isObj(selected.agent) ? str(selected.agent.systemPrompt) : '')
        setAgentUser(selected && isObj(selected.agent) ? str(selected.agent.userTemplate) : '')
        setAgentFormat(
          selected && isObj(selected.agent) && selected.agent.outputFormat === 'prompt_negative'
            ? 'prompt_negative'
            : 'prompt',
        )
        setAgentModelName(selected && isObj(selected.agent) ? str(selected.agent.model) : '')
        const inputList =
          selected && isObj(selected.agent) && Array.isArray(selected.agent.inputTypes)
            ? selected.agent.inputTypes
            : ['text', 'image']
        setAgentInputs({
          text: inputList.indexOf('text') >= 0,
          image: inputList.indexOf('image') >= 0,
        })
        setVarDrafts({})
        setError('')
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [draftKey])

      const keys = templateVariableKeys(content)
      const variables = keys.map((key) => {
        const draft = isObj(varDrafts[key]) ? varDrafts[key] : {}
        return { key, label: str(draft.label) || key, default: str(draft.default) }
      })
      const values = {}
      for (const variable of variables) values[variable.key] = variable.default
      const rendered = renderTemplate(content, values)

      const save = async () => {
        const cleanName = str(name).trim()
        if (!cleanName) {
          setError('请填写模板名称')
          return
        }
        if (kind !== 'agent' && !str(content).trim()) {
          setError('模板内容不能为空')
          return
        }
        setBusy(true)
        setError('')
        try {
          await props.onSave({
            id: selected && selected.id ? selected.id : '',
            name: cleanName,
            category: str(category).trim() || '通用',
            content: str(content),
            kind,
            mode: agentMode,
            agent: {
              inputTypes: [
                agentInputs.text ? 'text' : '',
                agentInputs.image ? 'image' : '',
              ].filter(Boolean),
              systemPrompt: str(agentSystem),
              userTemplate: str(agentUser),
              outputFormat: agentFormat,
              model: str(agentModelName),
            },
            variables,
            bindWorkflowCategory: bindCategory,
            tags: [],
          })
        } catch (failure) {
          setError((failure && failure.message) || String(failure))
        } finally {
          setBusy(false)
        }
      }

      const loadDshModels = async () => {
        setDshBusy(true)
        try {
          const data = await props.onListDshModels()
          setDshModels(data || { ok: false, error: '没有返回', providers: [], models: [] })
        } catch (failure) {
          setDshModels({ ok: false, error: (failure && failure.message) || String(failure), providers: [], models: [] })
        } finally {
          setDshBusy(false)
        }
      }
      useEffect(() => {
        if (agSource === 'dsh' && !dshModels && !dshBusy) void loadDshModels()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [agSource])

      const saveAgentSettings = async () => {
        setAgBusy(true)
        setAgMsg('')
        try {
          await props.onSaveAgentConfig({
            agentSource: agSource,
            agentBaseUrl: agBase,
            agentModel: agModel,
            agentDshProvider: agProvider,
            agentDshModel: agDshModel,
            agentRetentionDays: Number(agRetention) || 0,
            ...(str(agKey).trim() ? { agentApiKey: str(agKey).trim() } : {}),
          })
          setAgKey('')
          setAgMsg('Agent 设置已保存')
        } catch (failure) {
          setAgMsg((failure && failure.message) || String(failure))
        } finally {
          setAgBusy(false)
        }
      }
      const testAgent = async () => {
        setAgBusy(true)
        setAgMsg('')
        try {
          const result = await props.onTestAgent()
          setAgMsg(str(result && result.hint) || '探测完成')
        } catch (failure) {
          setAgMsg((failure && failure.message) || String(failure))
        } finally {
          setAgBusy(false)
        }
      }

      const dshProviderList = dshModels && Array.isArray(dshModels.providers) ? dshModels.providers : []
      const providerOptions = dshProviderList.map((provider) => ({ value: provider.id, label: provider.name || provider.id }))
      const dshModelList =
        dshModels && Array.isArray(dshModels.models)
          ? dshModels.models.filter((model) => !agProvider || model.provider === agProvider)
          : []
      const modelVisionOf = (model) =>
        Array.isArray(model && model.inputModalities) && model.inputModalities.indexOf('image') >= 0
      const dshModelOptions = dshModelList.map((model) => ({
        value: model.id,
        label: (model.name || model.id) + (modelVisionOf(model) ? ' · 支持图片' : ''),
      }))
      const selectedDshModel = dshModelList.find((model) => model.id === agDshModel) || null
      const selectedDshVision = selectedDshModel ? modelVisionOf(selectedDshModel) : null

      const bindOptions = [
        { value: '', label: '不绑定' },
        ...WORKFLOW_CATEGORY_ORDER.map((id) => ({
          value: id,
          label: WORKFLOW_CATEGORY_LABELS[id] || id,
        })),
      ]

      return h(
        'div',
        { className: 'iw-template-board' },
        h(
          'div',
          { className: 'iw-board-head' },
          h(
            'div',
            { className: 'iw-board-title' },
            selected && selected.id ? '编辑模板' : '新建模板',
          ),
          h(
            'div',
            { className: 'iw-board-sub' },
            '用 {{变量}} 占位，插入输入框时填写；输入框里打 @ 可快速调用。',
          ),
        ),
        h(
          'div',
          { className: 'iw-agent-settings' },
          h(
            'div',
            { className: 'iw-agent-settings-head' },
            h('div', { className: 'iw-agent-settings-title' }, 'Agent 模型（✨ 模板使用）'),
            h(
              'div',
              { className: 'iw-agent-settings-sub' },
              '留空则复用生图 API 的地址与 Key；DSH 通道需要宿主暴露模型服务。',
            ),
          ),
          h(
            'div',
            { className: 'iw-agent-settings-grid' },
            h(Select, {
              className: 'iw-param-select',
              value: agSource,
              options: [
                { value: 'api', label: 'Agent API（OpenAI 兼容）' },
                { value: 'dsh', label: 'DSH 模型（实验）' },
              ],
              onChange: setAgSource,
            }),
            agSource === 'dsh'
              ? h(
                  React.Fragment,
                  null,
                  h(Select, { className: 'iw-param-select', value: agProvider, options: providerOptions, onChange: (value) => { setAgProvider(value); setAgDshModel('') } }),
                  h(Select, { className: 'iw-param-select', value: agDshModel, options: dshModelOptions, onChange: setAgDshModel }),
                  h('button', { type: 'button', className: 'iw-btn', disabled: dshBusy, onClick: () => void loadDshModels() }, dshBusy ? '加载中…' : '刷新 DSH 模型'),
                  h(
                    'span',
                    { className: 'iw-agent-hint' },
                    !dshModels
                      ? '正在读取 DSH 模型…'
                      : !dshModels.ok
                        ? dshModels.error
                        : selectedDshModel
                          ? selectedDshVision
                            ? '使用 DSH 当前模型，无需 API Key；支持文字与图片（反推提示词）'
                            : '该模型只支持文字；图片反推请选择带「支持图片」标记的模型，或改用 Agent API'
                          : '选择 provider 与模型；带「支持图片」的模型可用于图片反推',
                  ),
                )
              : h(
                  React.Fragment,
                  null,
                  h('input', { className: 'iw-input', value: agBase, placeholder: 'Agent API 地址，例如 https://api.example.com/v1', onChange: (event) => setAgBase(event.target.value) }),
                  h('input', { className: 'iw-input', type: 'password', value: agKey, placeholder: agentSettings.agentApiKeySet ? '已配置 ' + str(agentSettings.agentApiKeyHint) + '（留空不改）' : 'Agent API Key', onChange: (event) => setAgKey(event.target.value) }),
                  h('input', { className: 'iw-input', value: agModel, placeholder: 'Agent 模型，例如 gpt-4o-mini', onChange: (event) => setAgModel(event.target.value) }),
                ),
          ),
          h(
            'div',
            { className: 'iw-agent-settings-grid' },
            h(Select, {
              className: 'iw-param-select',
              value: String(agRetention),
              options: [
                { value: '0', label: 'Agent 会话：永久保留' },
                { value: '1', label: 'Agent 会话：按天清理' },
                { value: '7', label: 'Agent 会话：按周清理' },
                { value: '30', label: 'Agent 会话：按月清理' },
              ],
              onChange: (value) => setAgRetention(Number(value) || 0),
            }),
            h(
              'span',
              { className: 'iw-agent-hint' },
              agRetention > 0
                ? '超过 ' + agRetention + ' 天未用的 Agent 会话会在启动时自动删除（只删 Agent 会话，不动生图历史）'
                : 'Agent 会话会一直保留；不想留可以随时在会话里点「清空消息」',
            ),
          ),
          h(
            'div',
            { className: 'iw-agent-settings-actions' },
            h('button', { type: 'button', className: 'iw-btn', disabled: agBusy, onClick: () => void saveAgentSettings() }, agBusy ? '处理中…' : '保存 Agent 设置'),
            h('button', { type: 'button', className: 'iw-btn', disabled: agBusy, onClick: () => void testAgent() }, '测试连接'),
            agMsg ? h('span', { className: 'iw-agent-settings-msg' }, agMsg) : null,
          ),
        ),
        h(
          'div',
          { className: 'iw-template-form' },
          h(
            Field,
            { label: '模板名称' },
            h('input', {
              className: 'iw-input',
              value: name,
              placeholder: '例如：复古胶片人像',
              onChange: (event) => setName(event.target.value),
            }),
          ),
          h(
            Field,
            { label: '分类' },
            h('input', {
              className: 'iw-input',
              value: category,
              placeholder: '通用 / 人像 / 产品 / 海报 / 风格…',
              onChange: (event) => setCategory(event.target.value),
            }),
          ),
          h(
            Field,
            { label: '模板类型' },
            h(Select, {
              className: 'iw-param-select',
              value: kind,
              options: [
                { value: 'text', label: '文本模板' },
                { value: 'agent', label: '✨ Agent 模板' },
              ],
              onChange: (value) => setKind(value),
            }),
          ),
          h(
            Field,
            { label: '绑定工作流分类（可选）' },
            h(Select, {
              className: 'iw-param-select',
              value: bindCategory,
              options: bindOptions,
              onChange: (value) => setBindCategory(value),
            }),
          ),
          kind === 'agent'
            ? h(
                React.Fragment,
                null,
                h(
                  Field,
                  { label: 'Agent System Prompt' },
                  h('textarea', {
                    className: 'iw-input iw-template-content',
                    rows: 4,
                    value: agentSystem,
                    placeholder: '例如：你是资深 AI 绘画提示词工程师…',
                    onChange: (event) => setAgentSystem(event.target.value),
                  }),
                ),
                h(
                  Field,
                  { label: 'Agent 用户模板' },
                  h('textarea', {
                    className: 'iw-input iw-template-content',
                    rows: 3,
                    value: agentUser,
                    placeholder: '根据以下输入生成最终提示词：{{input}}',
                    onChange: (event) => setAgentUser(event.target.value),
                  }),
                ),
                h(
                  Field,
                  { label: '输入类型' },
                  h(
                    'div',
                    { className: 'iw-agent-inputs' },
                    h('label', null, h('input', { type: 'checkbox', checked: agentInputs.text, onChange: (event) => setAgentInputs((previous) => ({ ...previous, text: event.target.checked })) }), '文字'),
                    h('label', null, h('input', { type: 'checkbox', checked: agentInputs.image, onChange: (event) => setAgentInputs((previous) => ({ ...previous, image: event.target.checked })) }), '图片（反推提示词）'),
                  ),
                ),
                h(
                  Field,
                  { label: '交互方式' },
                  h(
                    'div',
                    { className: 'iw-agent-mode-row' },
                    h(Select, {
                      className: 'iw-param-select',
                      value: agentMode,
                      options: [
                        { value: 'chat', label: '临时会话（可多轮追问）' },
                        { value: 'single', label: '快问快答（行内一问一得）' },
                      ],
                      onChange: (value) => setAgentMode(value),
                    }),
                    h(
                      'span',
                      { className: 'iw-agent-hint' },
                      agentMode === 'chat'
                        ? '选中后打开右侧临时会话：可连续追问，结果送入输入框'
                        : '选中后在输入框上方弹出小面板：一问一得',
                    ),
                  ),
                ),
                h(
                  Field,
                  { label: '输出格式' },
                  h(Select, {
                    className: 'iw-param-select',
                    value: agentFormat,
                    options: [
                      { value: 'prompt', label: '单一提示词' },
                      { value: 'prompt_negative', label: '提示词 + 负面词' },
                    ],
                    onChange: (value) => setAgentFormat(value),
                  }),
                ),
                h(
                  Field,
                  { label: '模型覆盖（可选）' },
                  h('input', {
                    className: 'iw-input',
                    value: agentModelName,
                    placeholder: '留空则使用上方 Agent 模型',
                    onChange: (event) => setAgentModelName(event.target.value),
                  }),
                ),
              )
            : null,
          h(
            Field,
            { label: kind === 'agent' ? '附加上下文 / 规则（会一起发给 Agent）' : '模板内容' },
            h('textarea', {
              className: 'iw-input iw-template-content',
              rows: 7,
              value: content,
              placeholder: '{{主体}}，{{风格}}，35mm 胶片，浅景深，柔和自然光…',
              onChange: (event) => setContent(event.target.value),
            }),
          ),
          keys.length
            ? h(
                Field,
                { label: '变量默认值' },
                h(
                  'div',
                  { className: 'iw-template-vars' },
                  variables.map((variable) =>
                    h(
                      'label',
                      { key: variable.key, className: 'iw-template-var' },
                      h('span', { className: 'iw-template-var-key' }, variable.key),
                      h('input', {
                        className: 'iw-input',
                        value: variable.default,
                        placeholder: '默认值（可留空）',
                        onChange: (event) =>
                          setVarDrafts((previous) => ({
                            ...previous,
                            [variable.key]: {
                              ...previous[variable.key],
                              default: event.target.value,
                            },
                          })),
                      }),
                    ),
                  ),
                ),
              )
            : null,
          h(
            'div',
            { className: 'iw-template-preview' },
            h('div', { className: 'iw-template-preview-label' }, '预览'),
            h(
              'div',
              { className: 'iw-template-preview-body' },
              kind === 'agent'
                ? 'Agent 模板：在输入框 @ 选中后，输入文字或图片让 Agent 生成提示词，确认后插入。'
                : rendered
                  ? rendered
                  : '（还没有内容）',
            ),
          ),
          error ? h('div', { className: 'iw-form-error' }, error) : null,
          h(
            'div',
            { className: 'iw-template-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'iw-btn iw-btn-primary',
                disabled: busy,
                onClick: () => void save(),
              },
              busy ? '保存中…' : selected && selected.id ? '保存修改' : '保存模板',
            ),
            str(content).trim()
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'iw-btn',
                    disabled: busy,
                    onClick: () => props.onInsert(rendered),
                  },
                  '插入输入框',
                )
              : null,
            selected && selected.id
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'iw-btn iw-btn-danger',
                    disabled: busy,
                    onClick: () => props.onDelete(selected.id),
                  },
                  '删除',
                )
              : null,
          ),
        ),
      )
    }

    /**
     * v2.4.0: temporary agent session drawer.
     *
     * A chat-style side panel for ✨ Agent templates: the user speaks on the
     * right, the agent answers on the left, follow-ups keep the context. The
     * result is inserted into the composer (whole reply or a selection) and the
     * drawer closes. Nothing here is written to the workspace history.
     */
    function AgentSession(props) {
      const session = isObj(props.session) ? props.session : {}
      const template = isObj(props.template) ? props.template : null
      const messages = Array.isArray(session.messages) ? session.messages : []
      const [text, setText] = useState('')
      const [image, setImage] = useState(null)
      const [selection, setSelection] = useState('')
      const fileRef = useRef(null)
      const bodyRef = useRef(null)
      const agent = template && isObj(template.agent) ? template.agent : {}
      const allowImage =
        Array.isArray(agent.inputTypes) && agent.inputTypes.indexOf('image') >= 0
      const busy = !!session.busy
      const canSend = !busy && (!!str(text).trim() || !!image)

      useEffect(() => {
        const element = bodyRef.current
        if (!element) return
        element.scrollTop = element.scrollHeight
      }, [messages.length, busy, session.error])

      const pickFile = (file) => {
        if (!file) return
        if (!/^image\/(png|jpeg|webp)$/i.test(file.type || '')) {
          props.onToast('error', '只支持 PNG / JPEG / WebP 图片')
          return
        }
        if (file.size > 6 * 1024 * 1024) {
          props.onToast('error', '图片过大（最多 6MB）')
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = String(reader.result || '')
          const comma = dataUrl.indexOf(',')
          const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
          if (!base64) {
            props.onToast('error', '读取图片失败')
            return
          }
          setImage({ dataUrl, base64, mime: file.type, name: file.name || 'image.png' })
        }
        reader.onerror = () => props.onToast('error', '读取图片失败')
        reader.readAsDataURL(file)
      }

      const submit = () => {
        if (!canSend) return
        const payload = {
          text: str(text).trim(),
          imageBase64: image ? image.base64 : '',
          imageMime: image ? image.mime : '',
          imageDataUrl: image ? image.dataUrl : '',
        }
        setText('')
        setImage(null)
        setSelection('')
        props.onSend(payload)
      }

      const captureSelection = () => {
        try {
          const selected = String(window.getSelection ? window.getSelection().toString() : '').trim()
          setSelection(selected)
        } catch (error) {
          setSelection('')
        }
      }

      return h(
        'aside',
        { className: 'iw-agent-drawer' },
        h(
          'div',
          { className: 'iw-agent-drawer-head' },
          h(Icon, { name: 'spark', size: 14 }),
          h(
            'div',
            { className: 'iw-agent-drawer-title' },
            h('span', { className: 'iw-agent-drawer-name' }, str(template && template.name) || 'Agent 会话'),
            h('span', { className: 'iw-agent-drawer-badge' }, '临时会话'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'iw-agent-drawer-x',
              title: '关闭临时会话（不会清空已生成的提示词）',
              onClick: props.onClose,
            },
            h(Icon, { name: 'x', size: 12 }),
          ),
        ),
        h(
          'div',
          { className: 'iw-agent-drawer-body', ref: bodyRef, onMouseUp: captureSelection },
          messages.length === 0
            ? h(
                'div',
                { className: 'iw-agent-empty' },
                h(Icon, { name: 'spark', size: 20 }),
                h('div', null, '把想法或图片发给 Agent，它会按模板规则生成提示词。'),
                h('div', { className: 'iw-agent-empty-sub' }, '多轮追问会保留上下文；结果可直接送入输入框。'),
              )
            : messages.map((message, index) =>
                message.role === 'user'
                  ? h(
                      'div',
                      { key: message.id || index, className: 'iw-agent-msg iw-agent-msg-user' },
                      message.imageDataUrl
                        ? h('img', {
                            className: 'iw-agent-msg-image',
                            src: message.imageDataUrl,
                            alt: '图片',
                          })
                        : null,
                      message.text
                        ? h('div', { className: 'iw-agent-bubble' }, message.text)
                        : null,
                    )
                  : h(
                      'div',
                      { key: message.id || index, className: 'iw-agent-msg iw-agent-msg-bot' },
                      h('div', { className: 'iw-agent-bubble' }, message.text),
                      h(
                        'div',
                        { className: 'iw-agent-msg-actions' },
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'iw-agent-mini',
                            onClick: () => props.onInsert(message.text),
                          },
                          '整段送入',
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'iw-agent-mini',
                            onClick: () => props.onCopy(message.text),
                          },
                          '复制',
                        ),
                        message.elapsedMs
                          ? h(
                              'span',
                              { className: 'iw-agent-msg-meta' },
                              `${Math.round(message.elapsedMs / 1000)}s · ${message.text.length} 字`,
                            )
                          : null,
                      ),
                    ),
              ),
          busy
            ? h(
                'div',
                { className: 'iw-agent-msg iw-agent-msg-bot' },
                h(
                  'div',
                  { className: 'iw-agent-bubble iw-agent-typing' },
                  h(Spinner, { size: 12 }),
                  'Agent 正在思考…',
                ),
              )
            : null,
          session.error
            ? h(
                'div',
                { className: 'iw-agent-error' },
                h('span', null, str(session.error)),
                h(
                  'button',
                  { type: 'button', className: 'iw-agent-mini', onClick: props.onRetry },
                  '重试',
                ),
              )
            : null,
        ),
        selection
          ? h(
              'div',
              { className: 'iw-agent-selection' },
              h('span', null, `已选中 ${selection.length} 字`),
              h(
                'button',
                { type: 'button', className: 'iw-btn iw-btn-primary iw-btn-sm', onClick: () => props.onInsert(selection) },
                '送入选中片段',
              ),
              h(
                'button',
                { type: 'button', className: 'iw-btn iw-btn-sm', onClick: () => setSelection('') },
                '取消选择',
              ),
            )
          : null,
        h(
          'div',
          { className: 'iw-agent-compose' },
          image
            ? h(
                'div',
                { className: 'iw-agent-compose-image' },
                h('img', { src: image.dataUrl, alt: '待发送图片' }),
                h('span', { className: 'iw-agent-compose-name' }, image.name),
                h(
                  'button',
                  { type: 'button', className: 'iw-agent-mini', onClick: () => setImage(null) },
                  '移除',
                ),
              )
            : null,
          h('textarea', {
            className: 'iw-input iw-agent-compose-input',
            rows: 3,
            value: text,
            placeholder: messages.length
              ? '继续追问，或换一个要求…（Enter 发送，Shift+Enter 换行）'
              : '描述你的想法；也可以先放一张图片…',
            onChange: (event) => setText(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Enter') return
              if (event.shiftKey) return
              if (event.nativeEvent && event.nativeEvent.isComposing) return
              if (event.isComposing) return
              event.preventDefault()
              submit()
            },
            onPaste: (event) => {
              if (!allowImage) return
              const clipboard = event.clipboardData
              if (!clipboard) return
              for (const item of Array.from(clipboard.items || [])) {
                if (item.kind === 'file' && /^image\//.test(item.type || '')) {
                  const file = item.getAsFile()
                  if (file) {
                    event.preventDefault()
                    pickFile(file)
                    return
                  }
                }
              }
            },
          }),
          h(
            'div',
            { className: 'iw-agent-compose-actions' },
            allowImage
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'iw-btn iw-btn-sm',
                    disabled: busy,
                    onClick: () => {
                      if (fileRef.current) fileRef.current.click()
                    },
                  },
                  '图片',
                )
              : null,
            h('input', {
              type: 'file',
              accept: 'image/png,image/jpeg,image/webp',
              ref: fileRef,
              className: 'iw-agent-file',
              onChange: (event) => {
                const file = event.target.files && event.target.files[0]
                pickFile(file)
                event.target.value = ''
              },
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'iw-btn iw-btn-sm',
                disabled: busy || messages.length === 0,
                title: '清空这段临时会话',
                onClick: props.onClear,
              },
              '清空',
            ),
            h('div', { className: 'iw-agent-compose-spacer' }),
            busy
              ? h(
                  'button',
                  { type: 'button', className: 'iw-btn iw-btn-sm', onClick: props.onCancel },
                  '取消本次',
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'iw-btn iw-btn-primary iw-btn-sm',
                disabled: !canSend,
                onClick: submit,
              },
              busy ? '生成中…' : '发送',
            ),
          ),
        ),
      )
    }

    function Workbench() {
      // P2-02: lazier localStorage read — passing loadUiState() to useRef would
      // evaluate it on every render (a getItem + JSON.parse per keystroke).
      const storedUiRef = useRef(null)
      if (storedUiRef.current === null) storedUiRef.current = loadUiState()

      const [boot, setBoot] = useState({ status: 'loading', error: '' })
      const [retryToken, setRetryToken] = useState(0)
      const [autoRetryStopped, setAutoRetryStopped] = useState(false)
      const [settings, setSettings] = useState(null)
      const [workspaces, setWorkspaces] = useState([])
      const [limits, setLimits] = useState(DEFAULT_LIMITS)
      const [server, setServer] = useState(null)
      const [activeWorkspaceId, setActiveWorkspaceId] = useState('')
      const [activeConversationId, setActiveConversationId] = useState('')
      const [conversation, setConversation] = useState(null)
      const [conversationLoading, setConversationLoading] = useState(false)
      const [expanded, setExpanded] = useState(() =>
        isObj(storedUiRef.current.expanded) ? storedUiRef.current.expanded : {},
      )
      const [params, setParams] = useState(() => normalizeGenParams(storedUiRef.current.params))
      const [prompt, setPrompt] = useState('')
      const [refs, setRefs] = useState([])
      // v1.2: local ComfyUI workflow list (model dropdown + dynamic params).
      const [workflows, setWorkflows] = useState([])
      const [workflowsLoaded, setWorkflowsLoaded] = useState(false)
      // v2.2: prompt templates (模板 tab + composer @ picker).
      const [templates, setTemplates] = useState([])
      const [templatesLoaded, setTemplatesLoaded] = useState(false)
      const [templateEdit, setTemplateEdit] = useState(null)
      // v2.4: temporary agent session (drawer, not part of workspace history).
      const [agentSession, setAgentSession] = useState(null)
      const agentSessionRef = useRef(null)
      const agentReqRef = useRef(0)
      // v2.5: ComfyUI VRAM usage (models stay resident between runs).
      const [comfyVram, setComfyVram] = useState(null)
      // v2.1: sidebar activity tab; the main area follows it.
      const [activeTab, setActiveTab] = useState(() => {
        const storedTab = str(storedUiRef.current.activeTab)
        return ['workspace', 'assets', 'templates', 'workflows'].indexOf(storedTab) >= 0
          ? storedTab
          : 'workspace'
      })
      const [uploading, setUploading] = useState(false)
      const [sending, setSending] = useState(false)
      const [jobs, setJobs] = useState([])
      // v1.2.6: cross-session task panel (polled from host `job.list`).
      const [taskPanelOpen, setTaskPanelOpen] = useState(false)
      const [taskItems, setTaskItems] = useState([])
      const [cancellingJobId, setCancellingJobId] = useState('')
      const [toasts, setToasts] = useState([])
      const [settingsOpen, setSettingsOpen] = useState(false)
      // v3.1.4: when a workflow is opened from the 工作流 tab we pass its id so the
      // settings modal jumps to ComfyUI instead of landing on the API section.
      const [settingsIntent, setSettingsIntent] = useState(null)
      // v1.10: first-run proxy onboarding (candidates from bootstrap).
      const [onboard, setOnboard] = useState(null)
      const [onboardBusy, setOnboardBusy] = useState(false)
      const [costOpen, setCostOpen] = useState(false)
      const [maskEditor, setMaskEditor] = useState(null)
      const [dialog, setDialog] = useState(null)
      const [dialogBusy, setDialogBusy] = useState(false)
      const [detail, setDetail] = useState(null)
      const [deletingImageId, setDeletingImageId] = useState('')
      const [refreshing, setRefreshing] = useState(false)
      const [busyAction, setBusyAction] = useState('')
      const [, setTick] = useState(0)

      const mountedRef = useRef(true)
      const rootRef = useRef(null)
      const textareaRef = useRef(null)
      const activeWsRef = useRef('')
      const activeConvRef = useRef('')
      const refsRef = useRef([])
      const workspacesRef = useRef([])
      const paramsRef = useRef(params)
      const workflowsRef = useRef([])
      const conversationRef = useRef(null)
      const jobsRef = useRef([])
      // v1.2.6: per-conversation composer drafts (P0-2).
      const promptRef = useRef('')
      const draftRef = useRef(
        isObj(storedUiRef.current.drafts) ? { ...storedUiRef.current.drafts } : {},
      )
      // v1.2.7: composer state (model/workflow/params/张数) is per conversation.
      // Switching conversations used to keep the previous conversation's
      // workflow, so workflow B's settings leaked into workflow A's chat.
      const convParamsRef = useRef(
        isObj(storedUiRef.current.conversationParams)
          ? { ...storedUiRef.current.conversationParams }
          : {},
      )
      const draftConvRef = useRef('')
      const loadSeqRef = useRef(0)
      const pollTokensRef = useRef(new Map())
      const toastTimersRef = useRef(new Map())
      const fallbackTimersRef = useRef(new Set())
      // v1.1: jobIds that already reached a terminal state / 404 — never
      // re-resume polling for them from the conversation-restore effect.
      const deadJobIdsRef = useRef(new Set())
      const bootAttemptsRef = useRef(0)
      const readyReportedRef = useRef('')
      const refreshingRef = useRef(false)
      // v1.10: show the auto-configure toast once per detected URL; suppress a
      // re-prompt caused by the bootstrap refresh that follows "手动配置".
      const autoOnboardToastRef = useRef('')
      const suppressOnboardRef = useRef(false)

      useEffect(() => {
        activeWsRef.current = activeWorkspaceId
      }, [activeWorkspaceId])
      useEffect(() => {
        activeConvRef.current = activeConversationId
      }, [activeConversationId])
      useEffect(() => {
        refsRef.current = refs
      }, [refs])
      useEffect(() => {
        paramsRef.current = params
      }, [params])
      useEffect(() => {
        workflowsRef.current = workflows
      }, [workflows])
      useEffect(() => {
        workspacesRef.current = workspaces
      }, [workspaces])
      useEffect(() => {
        conversationRef.current = conversation
      }, [conversation])
      useEffect(() => {
        jobsRef.current = jobs
      }, [jobs])
      useEffect(() => {
        agentSessionRef.current = agentSession
      }, [agentSession])

      // v2.5: keep the VRAM indicator fresh (ComfyUI keeps models resident).
      useEffect(() => {
        if (boot.status !== 'ready' || !workflowsLoaded) return undefined
        void refreshComfyVram()
        const timer = setInterval(() => {
          if (document && document.hidden) return
          void refreshComfyVram()
        }, 8000)
        return () => clearInterval(timer)
      }, [boot.status, workflowsLoaded])
      useEffect(() => {
        mountedRef.current = true
        const tokens = pollTokensRef.current
        const timers = toastTimersRef.current
        const fallbackTimers = fallbackTimersRef.current
        return () => {
          mountedRef.current = false
          tokens.forEach((token) => {
            token.cancelled = true
          })
          tokens.clear()
          timers.forEach((timer) => clearTimeout(timer))
          timers.clear()
          fallbackTimers.forEach((timer) => clearTimeout(timer))
          fallbackTimers.clear()
        }
      }, [])

      /* ---- toasts ------------------------------------------------------ */

      const pushToast = (kind, text, action) => {
        const id = uid('toast_')
        const safeKind = ['error', 'success', 'info'].indexOf(kind) >= 0 ? kind : 'info'
        const message = str(text) || '操作失败'
        const toastAction =
          action && typeof action.onClick === 'function'
            ? { label: str(action.label) || '打开', title: str(action.title), onClick: action.onClick }
            : null
        setToasts((previous) => [...previous, { id, kind: safeKind, text: message, action: toastAction }].slice(-4))
        const timer = setTimeout(() => {
          toastTimersRef.current.delete(id)
          if (!mountedRef.current) return
          setToasts((previous) => previous.filter((item) => item.id !== id))
        }, toastAction ? 7000 : TOAST_MS)
        toastTimersRef.current.set(id, timer)
      }

      const dismissToast = (id) => {
        const timer = toastTimersRef.current.get(id)
        if (timer) clearTimeout(timer)
        toastTimersRef.current.delete(id)
        setToasts((previous) => previous.filter((item) => item.id !== id))
      }

      /* ---- bootstrap / data refresh ------------------------------------ */

      const normalizeLimits = (raw) => ({
        maxN: clamp(Math.round(num(raw && raw.maxN, 4)), 1, 4),
        maxUploadBytes: Math.max(0, num(raw && raw.maxUploadBytes, DEFAULT_LIMITS.maxUploadBytes)),
      })

      const normalizeServer = (raw) =>
        isObj(raw) ? { build: str(raw.build), hostBuild: str(raw.hostBuild) } : null

      // v1.2: local ComfyUI workflow list, refreshed with every bootstrap.
      async function loadWorkflows() {
        try {
          const data = await rpc('comfy.workflow.list')
          if (!mountedRef.current) return
          setWorkflows(normalizeWorkflowList(data))
        } catch (error) {
          // An older host may not implement the comfy ops yet — stay quiet.
          reportLog('warn', `comfy.workflow.list failed: ${(error && error.message) || error}`)
        } finally {
          if (mountedRef.current) setWorkflowsLoaded(true)
        }
      }

      async function loadTemplates() {
        try {
          const data = await rpc('template.list')
          if (!mountedRef.current) return
          setTemplates(normalizeTemplateList(data))
        } catch (error) {
          reportLog('warn', `template.list failed: ${(error && error.message) || error}`)
        } finally {
          if (mountedRef.current) setTemplatesLoaded(true)
        }
      }

      function syncParamsWithSettings(nextSettings, nextLimits) {
        setParams((previous) => {
          const next = { ...previous }
          const models = nextSettings.models
          // v1.2: a valid `comfy:<workflowId>` model must survive a settings
          // refresh even though it is not in the API model list.
          const comfySelected = isComfyModel(next.model) && COMFY_MODEL_RE.test(str(next.model))
          if (!comfySelected && !models.some((model) => model.id === next.model)) {
            const defaultModel = models.some((model) => model.id === nextSettings.defaults.model)
              ? nextSettings.defaults.model
              : models[0]
                ? models[0].id
                : ''
            next.model = defaultModel
          }
          next.workflowId = comfyWorkflowIdOf(next.model)
          if (!isObj(next.workflowParams)) next.workflowParams = {}
          const defaults = nextSettings.defaults
          if (!next.size) next.size = defaults.size
          if (!next.quality) next.quality = defaults.quality
          if (!next.aspectRatio) next.aspectRatio = defaults.aspectRatio
          if (!next.resolution) next.resolution = defaults.resolution
          const maxN = clamp(Math.round(num(nextLimits && nextLimits.maxN, 4)), 1, 4)
          next.n = clamp(Math.round(num(next.n, defaults.n || 1)), 1, maxN)
          const allowedQuality = qualityOptions(resolveDialect(next.model, models))
          if (allowedQuality.indexOf(next.quality) < 0) next.quality = 'auto'
          return next
        })
      }

      function applyBootstrapData(data, options) {
        const opts = options || {}
        const raw = isObj(data) ? data : {}
        const nextSettings = normalizeSettings(raw.settings)
        const nextWorkspaces = normalizeWorkspaceList(raw.workspaces)
        const nextLimits = normalizeLimits(raw.limits)
        setSettings(nextSettings)
        setWorkspaces(nextWorkspaces)
        setLimits(nextLimits)
        setServer(normalizeServer(raw.server))
        syncParamsWithSettings(nextSettings, nextLimits)

        // v1.10: first-run proxy onboarding payload (prompt / auto / heal).
        const nextOnboard = normalizeProxyOnboarding(raw.proxyOnboarding)
        if (nextOnboard && nextOnboard.mode === 'auto' && nextOnboard.configuredUrl) {
          const toastKey = `${nextOnboard.replacedUrl || ''}|${nextOnboard.configuredUrl}`
          if (autoOnboardToastRef.current !== toastKey) {
            autoOnboardToastRef.current = toastKey
            pushToast(
              'success',
              nextOnboard.replacedUrl
                ? `原代理 ${nextOnboard.replacedUrl} 已不可用，已自动切换到 ${nextOnboard.configuredUrl}`
                : `已自动配置本地代理 ${nextOnboard.configuredUrl}（可在设置中修改）`,
            )
          }
          setOnboard(null)
        } else if (nextOnboard && nextOnboard.mode === 'prompt') {
          setOnboard(suppressOnboardRef.current ? null : nextOnboard)
          suppressOnboardRef.current = false
        } else {
          setOnboard(null)
        }

        const stored = storedUiRef.current
        const currentWs = activeWsRef.current
        const currentConv = activeConvRef.current
        const loadedConversation = conversationRef.current
        const isRefresh = opts.mode === 'refresh'

        let wsId = ''
        if (isRefresh) {
          if (currentWs && nextWorkspaces.some((workspace) => workspace.id === currentWs)) wsId = currentWs
        } else {
          for (const candidate of [stored.activeWorkspaceId, str(raw.activeWorkspaceId)]) {
            if (candidate && nextWorkspaces.some((workspace) => workspace.id === candidate)) {
              wsId = candidate
              break
            }
          }
        }
        if (!wsId && nextWorkspaces.length) wsId = nextWorkspaces[0].id
        const workspace = nextWorkspaces.find((item) => item.id === wsId) || null

        let convId = ''
        if (isRefresh && currentConv) {
          const listed = workspace && workspace.conversations.some((item) => item.id === currentConv)
          const loadedSame =
            loadedConversation &&
            loadedConversation.id === currentConv &&
            (!loadedConversation.workspaceId || loadedConversation.workspaceId === wsId)
          if (listed || loadedSame) convId = currentConv
        } else if (!isRefresh) {
          for (const candidate of [stored.activeConversationId, str(raw.activeConversationId)]) {
            if (
              workspace &&
              candidate &&
              workspace.conversations.some((item) => item.id === candidate)
            ) {
              convId = candidate
              break
            }
          }
        }
        if (!convId && workspace && workspace.conversations.length) {
          convId = workspace.conversations[0].id
        }
        if (typeof opts.selectWorkspaceId === 'string') wsId = opts.selectWorkspaceId
        if (typeof opts.selectConversationId === 'string') convId = opts.selectConversationId

        setActiveWorkspaceId(wsId)
        setActiveConversationId(convId)
        setExpanded((previous) => {
          const next = { ...previous }
          if (wsId) next[wsId] = true
          return next
        })
        // v1.2: keep the local ComfyUI workflow list in sync with bootstrap.
        loadWorkflows()
        loadTemplates()
        return { wsId, convId, workspaces: nextWorkspaces, settings: nextSettings }
      }

      async function refreshData(options) {
        const data = await rpc('bootstrap')
        return applyBootstrapData(data, options || { mode: 'refresh' })
      }

      function refreshDataSilent(options) {
        refreshData(options).catch((error) => {
          reportLog('warn', `bootstrap refresh failed: ${(error && error.message) || error}`)
        })
      }

      const reportReady = (status, result) => {
        const workspaceCount = result && Array.isArray(result.workspaces) ? result.workspaces.length : 0
        const key = `${status}:${workspaceCount}`
        if (readyReportedRef.current === key) return
        readyReportedRef.current = key
        try {
          rpc('client.ready', {
            info: {
              build: BUILD,
              mounted: true,
              hasBootstrap: status === 'ready',
              status,
              workspaces: workspaceCount,
              locale: localeId,
              at: nowIso(),
            },
          }).catch(() => {})
        } catch (error) {
          // never break the page for a diagnostics call
        }
      }

      useEffect(() => {
        let cancelled = false
        setBoot({ status: 'loading', error: '' })
        const run = async () => {
          try {
            const data = await rpc('bootstrap')
            if (cancelled || !mountedRef.current) return
            const result = applyBootstrapData(data, { mode: 'initial' })
            setBoot({ status: 'ready', error: '' })
            reportReady('ready', result)
          } catch (error) {
            if (cancelled || !mountedRef.current) return
            const message = (error && error.message) || String(error)
            setBoot({ status: 'error', error: message })
            reportReady('error', null)
            reportLog('warn', `bootstrap failed: ${message}`)
          }
        }
        run()
        return () => {
          cancelled = true
        }
      }, [retryToken])

      useEffect(() => {
        if (boot.status !== 'error' || autoRetryStopped) {
          bootAttemptsRef.current = 0
          return undefined
        }
        if (bootAttemptsRef.current >= BOOT_RETRY_MAX) {
          setAutoRetryStopped(true)
          return undefined
        }
        const timer = setTimeout(() => {
          bootAttemptsRef.current += 1
          setRetryToken((value) => value + 1)
        }, BOOT_RETRY_MS)
        return () => clearTimeout(timer)
      }, [boot.status, boot.error, autoRetryStopped, retryToken])

      useEffect(() => {
        promptRef.current = prompt
      }, [prompt])

      // v1.2.6 (P0-2): keep a draft per conversation. v1.2.7 also keeps the
      // composer state (model / workflow / params / 张数) per conversation, so
      // workflow B's selection never leaks into workflow A's chat.
      useEffect(() => {
        const nextId = activeConversationId || ''
        const previousId = draftConvRef.current
        if (previousId && previousId !== nextId) {
          draftRef.current[previousId] = promptRef.current
          convParamsRef.current[previousId] = paramsRef.current
        }
        draftConvRef.current = nextId
        if (nextId) {
          setPrompt(str(draftRef.current[nextId]))
          const storedParams = convParamsRef.current[nextId]
          if (isObj(storedParams)) setParams(normalizeGenParams(storedParams))
        } else {
          setPrompt('')
        }
      }, [activeConversationId])

      // v1.2.6 (P0-1): cross-session task list for the toolbar panel. The host
      // is the source of truth (survives reloads); poll faster while open.
      useEffect(() => {
        if (boot.status !== 'ready') return undefined
        let cancelled = false
        const interval = taskPanelOpen ? 2000 : 5000
        const fetchTasks = async () => {
          try {
            const data = await rpc('job.list')
            if (cancelled || !mountedRef.current) return
            setTaskItems(isObj(data) && Array.isArray(data.jobs) ? data.jobs : [])
          } catch (error) {
            // Best effort: keeping the previous list is better than dropping it.
          }
        }
        void fetchTasks()
        const timer = setInterval(fetchTasks, interval)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [boot.status, taskPanelOpen])

      useEffect(() => {
        if (boot.status !== 'ready') return undefined
        const timer = setTimeout(() => {
          if (activeConversationId) {
            draftRef.current[activeConversationId] = prompt
            convParamsRef.current[activeConversationId] = params
          }
          saveUiState({
            activeWorkspaceId,
            activeConversationId,
            expanded,
            params,
            activeTab,
            drafts: draftRef.current,
            conversationParams: convParamsRef.current,
          })
        }, 150)
        return () => clearTimeout(timer)
      }, [boot.status, activeWorkspaceId, activeConversationId, expanded, params, prompt, activeTab])

      // v1.2: a persisted comfy:<id> selection must be validated against the
      // loaded workflow list — if that workflow vanished, fall back to a model.
      useEffect(() => {
        if (boot.status !== 'ready' || !workflowsLoaded) return
        const current = paramsRef.current
        if (!isComfyModel(current.model)) return
        const workflowId = comfyWorkflowIdOf(current.model)
        if (findWorkflowById(workflows, workflowId)) return
        const models = settings && Array.isArray(settings.models) ? settings.models : []
        const fallback = models.length ? models[0].id : ''
        setParams((previous) => ({
          ...previous,
          model: fallback,
          workflowId: '',
          workflowParams: {},
        }))
        pushToast('info', '所选 ComfyUI 工作流已不存在，已切换回默认模型')
      }, [boot.status, workflowsLoaded, workflows, settings])

      useEffect(() => {
        const timer = setInterval(() => {
          if (!mountedRef.current) return
          setTick((value) => value + 1)
        }, 60000)
        return () => clearInterval(timer)
      }, [])

      /* ---- conversation loading ---------------------------------------- */

      async function loadConversation(wsId, convId, options) {
        const opts = options || {}
        const seq = loadSeqRef.current + 1
        loadSeqRef.current = seq
        if (!opts.silent) {
          setConversation(null)
          setConversationLoading(true)
        }
        try {
          const data = await rpc('conversation.get', {
            workspaceId: wsId,
            conversationId: convId,
          })
          if (seq !== loadSeqRef.current || !mountedRef.current) return null
          const next = normalizeConversation(data)
          if (!next) throw new Error('会话数据为空')
          if (activeWsRef.current === wsId && activeConvRef.current === convId) setConversation(next)
          return next
        } catch (error) {
          if (seq !== loadSeqRef.current || !mountedRef.current) return null
          const message = (error && error.message) || String(error)
          if (opts.silent) reportLog('warn', `conversation refresh failed: ${message}`)
          else pushToast('error', `加载会话失败：${message}`)
          return null
        } finally {
          if (seq === loadSeqRef.current && mountedRef.current) setConversationLoading(false)
        }
      }

      useEffect(() => {
        if (boot.status !== 'ready') return
        if (!activeWorkspaceId || !activeConversationId) {
          setConversation(null)
          return
        }
        const loaded = conversationRef.current
        if (loaded && loaded.id === activeConversationId && loaded.workspaceId === activeWorkspaceId) return
        loadConversation(activeWorkspaceId, activeConversationId, { silent: false })
      }, [boot.status, activeWorkspaceId, activeConversationId])

      async function refreshConversationQuiet(wsId, convId) {
        try {
          const data = await rpc('conversation.get', {
            workspaceId: wsId,
            conversationId: convId,
          })
          const next = normalizeConversation(data)
          if (
            next &&
            mountedRef.current &&
            activeWsRef.current === wsId &&
            activeConvRef.current === convId
          ) {
            setConversation(next)
          }
          return next
        } catch (error) {
          reportLog('warn', `quiet conversation refresh failed: ${(error && error.message) || error}`)
          return null
        }
      }

      const runningTurns = conversation
        ? conversation.turns.filter((turn) => turn.status === 'running')
        : []
      // v1.1: turns persisted with a jobId can resume real job polling; only
      // orphan turns without one need the slower conversation fallback.
      const orphanRunningKey = runningTurns
        .filter((turn) => !turn.jobId)
        .map((turn) => turn.id)
        .join(',')
      const hasActiveJobPolling = jobs.some(
        (job) => job.status === 'queued' || job.status === 'running',
      )

      // Resume job polling for restored running turns that carry a jobId
      // (after page reload / HMR the jobs table is gone, the host job is not).
      useEffect(() => {
        if (boot.status !== 'ready' || !conversation) return
        const wsId = conversation.workspaceId || activeWorkspaceId
        const convId = conversation.id
        if (!wsId || !convId) return
        for (const turn of conversation.turns) {
          if (turn.status !== 'running' || !turn.jobId) continue
          startJobPolling(turn.jobId, turn.id, wsId, convId, turn.prompt)
        }
      }, [boot.status, conversation, activeWorkspaceId])

      // Fallback refresh only for orphan running turns (no jobId); while any
      // jobId polling is active we skip it entirely to avoid duplicate polling.
      useEffect(() => {
        if (boot.status !== 'ready' || !orphanRunningKey || hasActiveJobPolling) return undefined
        const targetWs = conversationRef.current
          ? conversationRef.current.workspaceId || activeWsRef.current
          : activeWsRef.current
        const targetConv = conversationRef.current ? conversationRef.current.id : activeConvRef.current
        if (!targetWs || !targetConv) return undefined
        const timer = setInterval(() => {
          refreshConversationQuiet(targetWs, targetConv)
        }, 2500)
        return () => clearInterval(timer)
      }, [boot.status, orphanRunningKey, hasActiveJobPolling, activeWorkspaceId])

      useEffect(() => {
        if (boot.status !== 'ready') return undefined
        reportLog('info', `panel mounted build=${BUILD} workspaces=${workspacesRef.current.length}`)
        // No browser automation here: report the real rendered size so the
        // Lead can verify the panel actually fills the main slot (client.log).
        const timer = setTimeout(() => {
          try {
            const element = rootRef.current
            if (!element || typeof element.getBoundingClientRect !== 'function') return
            const rect = element.getBoundingClientRect()
            const parent = element.parentElement
            const parentRect =
              parent && typeof parent.getBoundingClientRect === 'function'
                ? parent.getBoundingClientRect()
                : null
            const style =
              typeof window.getComputedStyle === 'function' ? window.getComputedStyle(element) : null
            reportLog(
              'info',
              `panel size ${Math.round(rect.width)}x${Math.round(rect.height)} parent ${
                parentRect ? `${Math.round(parentRect.width)}x${Math.round(parentRect.height)}` : '?'
              } bg=${style ? style.backgroundColor : '?'} build=${BUILD}`,
            )
          } catch (error) {
            reportLog('warn', `panel size check failed: ${(error && error.message) || error}`)
          }
        }, 700)
        return () => clearTimeout(timer)
      }, [boot.status])

      useEffect(() => {
        if (boot.status !== 'ready') return
        const current = conversationRef.current
        if (current && current.turns.length === 0) {
          const element = textareaRef.current
          if (element) {
            try {
              element.focus()
            } catch (error) {
              // ignore
            }
          }
        }
      }, [boot.status, conversation])

      /* ---- job polling -------------------------------------------------- */

      function startJobPolling(jobId, turnId, wsId, convId, promptText) {
        if (!jobId) return
        if (deadJobIdsRef.current.has(jobId)) return
        if (pollTokensRef.current.has(jobId)) return
        const token = { cancelled: false }
        pollTokensRef.current.set(jobId, token)
        setJobs((previous) => {
          if (previous.some((job) => job.jobId === jobId)) return previous
          return [
            ...previous,
            {
              jobId,
              turnId,
              status: 'queued',
              progress: 0,
              prompt: str(promptText),
              workspaceId: wsId,
              conversationId: convId,
            },
          ]
        })

        const updateJob = (patch) => {
          if (!mountedRef.current) return
          setJobs((previous) =>
            previous.map((job) => (job.jobId === jobId ? { ...job, ...patch } : job)),
          )
        }

        const settleJob = (status, progress, errorMessage) => {
          updateJob({
            status,
            progress: typeof progress === 'number' ? progress : status === 'done' ? 1 : 0,
            error: errorMessage || null,
          })
          const timer = setTimeout(() => {
            pollTokensRef.current.delete(jobId)
            if (!mountedRef.current) return
            setJobs((previous) => previous.filter((job) => job.jobId !== jobId))
          }, 800)
          toastTimersRef.current.set(`job_${jobId}`, timer)
        }

        const loop = async () => {
          let delay = POLL_MS
          let failures = 0
          while (!token.cancelled && mountedRef.current) {
            const wait = typeof document !== 'undefined' && document.hidden ? POLL_HIDDEN_MS : delay
            await sleep(wait)
            if (token.cancelled || !mountedRef.current) return
            let job = null
            try {
              job = await rpc('job.get', { jobId })
              delay = POLL_MS
              failures = 0
            } catch (error) {
              // C2: a 404 means the host restarted or pruned the job table —
              // it is terminal, not a transient network blip (no 30× retry).
              if (error && error.status === 404) {
                reportLog(
                  'warn',
                  `job ${jobId} not found (host restart/pruned): ${(error && error.message) || error}`,
                )
                // v1.1: the job table entry is gone; reconcile the persisted
                // turn via turn.abort so it cannot stay running forever.
                deadJobIdsRef.current.add(jobId)
                settleJob('error', 0, (error && error.message) || '任务不存在或已结束，请刷新会话')
                try {
                  await rpc('turn.abort', { workspaceId: wsId, conversationId: convId, turnId })
                } catch (abortError) {
                  reportLog(
                    'warn',
                    `turn.abort after dead job failed: ${(abortError && abortError.message) || abortError}`,
                  )
                }
                await refreshConversationQuiet(wsId, convId)
                refreshDataSilent({ mode: 'refresh' })
                pushToast('error', '生成任务已失效（可能后台已重启），请刷新会话查看结果')
                return
              }
              failures += 1
              if (failures === 1) {
                reportLog('warn', `job.get failed (${jobId}): ${(error && error.message) || error}`)
              }
              delay = Math.min(Math.round(delay * 1.6), POLL_FAIL_MAX_MS)
              if (failures >= 30) {
                reportLog('error', `job.get kept failing, stop polling ${jobId}`)
                deadJobIdsRef.current.add(jobId)
                settleJob('error', 0, '无法获取生成进度，请刷新页面查看结果')
                return
              }
              continue
            }
            if (token.cancelled || !mountedRef.current) return
            if (!isObj(job)) continue
            const status = ['queued', 'running', 'done', 'error', 'cancelled'].indexOf(str(job.status)) >= 0
              ? str(job.status)
              : 'running'
            const progress = clamp(num(job.progress, 0), 0, 1)
            updateJob({
              status,
              progress,
              error: str(job.error) || null,
              stage: str(job.stage) || '',
              queuePosition:
                typeof job.queuePosition === 'number' && job.queuePosition > 0
                  ? job.queuePosition
                  : null,
            })
            // v1.2.4: ComfyUI randomized numeric params — show the value that was
            // actually drawn once the run settles, so the number next to the
            // "随机" toggle changes after every generation.
            if (status === 'done' && isObj(job.randomValues)) {
              const randomValues = job.randomValues
              const currentWorkflowId =
                str(paramsRef.current.workflowId) || comfyWorkflowIdOf(paramsRef.current.model)
              const jobWorkflowId = str(job.workflowId)
              if (!jobWorkflowId || !currentWorkflowId || jobWorkflowId === currentWorkflowId) {
                setParams((previous) => ({
                  ...previous,
                  workflowParams: {
                    ...(isObj(previous.workflowParams) ? previous.workflowParams : {}),
                    ...randomValues,
                  },
                }))
              }
            }
            if (status === 'done' || status === 'error' || status === 'cancelled') {
              deadJobIdsRef.current.add(jobId)
              settleJob(status, progress, str(job.error) || null)
              const next = await refreshConversationQuiet(wsId, convId)
              refreshDataSilent({ mode: 'refresh' })
              if (status === 'error') {
                pushToast('error', `生成失败：${truncate(str(job.error) || '上游服务未返回图片', 120)}`)
              } else if (status === 'cancelled') {
                pushToast('info', '本次生成已取消')
              } else if (next) {
                pushToast('success', '图片生成完成' + formatJobTiming(job))
              }
              void refreshComfyVram()
              return
            }
          }
        }
        loop()
      }

      /* ---- image / reference actions ------------------------------------ */

      function addRefs(list) {
        const incoming = (Array.isArray(list) ? list : []).map(normalizeRef).filter(Boolean)
        const result = { added: 0, duplicate: false, overflow: false }
        if (!incoming.length) return result
        const current = refsRef.current.slice()
        const additions = []
        for (const ref of incoming) {
          if (current.some((item) => item.id === ref.id) || additions.some((item) => item.id === ref.id)) {
            result.duplicate = true
            continue
          }
          if (current.length + additions.length >= MAX_REFS) {
            result.overflow = true
            break
          }
          additions.push(ref)
        }
        result.added = additions.length
        if (result.overflow) pushToast('error', `参考图最多 ${Math.min(MAX_REFS, slots)} 张`)
        if (additions.length) setRefs([...current, ...additions])
        return result
      }

      /** v3.1: how many image inputs the currently selected ComfyUI workflow exposes. */
      function currentImageSlots() {
        const current = paramsRef.current
        if (!isComfyModel(current.model)) return MAX_REFS
        const workflow = findWorkflowById(workflowsRef.current, comfyWorkflowIdOf(current.model))
        return workflowImageSpecs(workflow).length
      }

      function handleAddRefFromImage(image) {
        if (!image || !image.id) return
        const slots = currentImageSlots()
        if (slots === 0) {
          pushToast('info', '该工作流没有启用图像输入槽，不能带参考图')
          setDetail(null)
          return
        }
        if (refsRef.current.length >= slots) {
          pushToast('info', `该工作流只启用了 ${slots} 个图像输入`)
          setDetail(null)
          return
        }
        // C3: only claim success when the reference was really added.
        const result = addRefs([refFromImage(image)])
        if (result.added > 0) pushToast('success', '已加入输入框参考图')
        else if (result.duplicate) pushToast('info', '该图片已在输入框参考图中')
        setDetail(null)
        const element = textareaRef.current
        if (element) {
          try {
            element.focus()
          } catch (error) {
            // ignore
          }
        }
      }

      function handleRemoveRef(refId) {
        setRefs((previous) => previous.filter((ref) => ref.id !== refId))
      }

      async function handleAddFiles(files) {
        const slots = currentImageSlots()
        if (slots === 0) {
          pushToast('info', '该工作流没有启用图像输入槽，不能带参考图')
          return
        }
        const list = Array.from(files || []).filter((file) => file && /^image\//.test(file.type || ''))
        if (!list.length) {
          pushToast('error', '仅支持图片文件')
          return
        }
        const allowed = list.filter((file) => UPLOAD_MIME.indexOf(file.type) >= 0)
        if (allowed.length < list.length) pushToast('info', '仅支持 PNG / JPEG / WebP 图片')
        const room = Math.min(MAX_REFS, slots) - refsRef.current.length
        if (room <= 0) {
          pushToast('error', `参考图最多 ${MAX_REFS} 张`)
          return
        }
        if (allowed.length > room) pushToast('info', `参考图最多 ${MAX_REFS} 张，已忽略 ${allowed.length - room} 张`)
        const accepted = allowed.slice(0, room)
        if (!accepted.length) return
        const maxBytes = num(limits && limits.maxUploadBytes, DEFAULT_LIMITS.maxUploadBytes)
        setUploading(true)
        try {
          for (const file of accepted) {
            if (file.size > maxBytes) {
              pushToast('error', `${file.name || '图片'} 超过 ${formatBytes(maxBytes)} 上限`)
              continue
            }
            try {
              const dataBase64 = await readFileBase64(file)
              const result = await rpc('upload', {
                name: file.name || 'image.png',
                mediaType: file.type,
                dataBase64,
              })
              const ref = normalizeRef(result && result.ref)
              if (ref) addRefs([ref])
            } catch (error) {
              pushToast('error', `上传失败：${(error && error.message) || error}`)
            }
          }
        } finally {
          if (mountedRef.current) setUploading(false)
        }
      }

      async function handleDeleteImage(image) {
        const wsId = activeWsRef.current
        const convId = activeConvRef.current
        if (!wsId || !convId || !image || !image.id) return
        setDeletingImageId(image.id)
        try {
          const data = await rpc('image.delete', {
            workspaceId: wsId,
            conversationId: convId,
            imageId: image.id,
          })
          // C8: only write the response back when the user is still on the
          // conversation that initiated the delete (avoid clobbering a switch).
          const stillActive = activeWsRef.current === wsId && activeConvRef.current === convId
          const next = normalizeConversation(data && data.conversation)
          if (next) {
            if (stillActive) setConversation(next)
          } else if (stillActive) {
            await refreshConversationQuiet(wsId, convId)
          }
          setDetail((previous) => (previous && previous.image && previous.image.id === image.id ? null : previous))
          pushToast('success', '图片已删除')
          refreshDataSilent({ mode: 'refresh' })
        } catch (error) {
          pushToast('error', `删除失败：${(error && error.message) || error}`)
        } finally {
          if (mountedRef.current) setDeletingImageId('')
        }
      }

      /**
       * v1.3: delete a whole failed/cancelled (non-running) generation record
       * via RPC turn.delete; host also deletes that turn's images.
       */
      /* ---- v1.4 local file actions ------------------------------------- */

      async function handleOpenLocalFile(meta) {
        const imageId = str(meta && meta.id)
        if (!imageId) return
        try {
          const data = await rpc('file.open', { imageId })
          const path = str(data && data.path) || str(meta && meta.localPath)
          pushToast('success', `已用系统默认程序打开${path ? `：${path}` : '本地文件'}`)
        } catch (error) {
          pushToast('error', `打开文件失败：${(error && error.message) || error}`)
        }
      }

      async function handleRevealLocalFile(meta) {
        const imageId = str(meta && meta.id)
        if (!imageId) return
        try {
          const data = await rpc('file.reveal', { imageId })
          const path = str(data && data.path) || str(meta && meta.localPath)
          pushToast('success', `已在资源管理器中定位${path ? `：${path}` : '本地文件'}`)
        } catch (error) {
          pushToast('error', `打开文件夹失败：${(error && error.message) || error}`)
        }
      }

      async function handleOpenFolder(path) {
        try {
          const data = await rpc('folder.open', path ? { path } : {})
          pushToast('success', `已打开目录：${str(data && data.path) || path || '默认目录'}`)
        } catch (error) {
          pushToast('error', `打开目录失败：${(error && error.message) || error}`)
        }
      }

      async function handleSaveAsLocalFile(meta) {
        const imageId = str(meta && meta.id)
        if (!imageId) return
        try {
          const data = await rpc('file.saveAs', { imageId })
          const path = str(data && data.path)
          pushToast('success', `已保存到：${path || '另存为目录'}`, {
            label: '打开文件夹',
            title: '在资源管理器中打开保存目录',
            onClick: () => handleOpenFolder(dirNameOf(path)),
          })
        } catch (error) {
          pushToast('error', `保存失败：${(error && error.message) || error}`)
        }
      }

      function handleModelCostsSaved(nextCosts) {
        const normalized = normalizeModelCosts(nextCosts)
        setSettings((previous) => (previous ? { ...previous, modelCosts: normalized } : previous))
        refreshDataSilent({ mode: 'refresh' })
      }

      /* ---- v1.4 §C local inpainting ------------------------------------ */

      async function handleInpaintSubmit(payload) {
        const wsId = activeWsRef.current
        const convId = activeConvRef.current
        const image = payload && payload.image
        if (!wsId || !convId || !image || !image.id) {
          pushToast('error', '当前没有打开的会话')
          return
        }
        if (!settings) {
          pushToast('error', '请先在设置中配置模型')
          return
        }
        const modelList = settings.models
        const currentDialect = resolveDialect(params.model, modelList)
        let modelId = params.model
        if (currentDialect !== DIALECT.openai) {
          const openaiModel = modelList.find(
            (model) => model.id && resolveDialect(model.id, modelList) === DIALECT.openai,
          )
          if (!openaiModel) {
            pushToast('error', '没有可用的 OpenAI 图像模型，请先在设置中添加')
            return
          }
          modelId = openaiModel.id
        }
        const prompt = str(payload.prompt).trim()
        if (!prompt) {
          pushToast('error', '请填写重绘提示词')
          return
        }
        try {
          const uploaded = await rpc('upload', {
            name: 'mask.png',
            mediaType: 'image/png',
            dataBase64: payload.maskBase64,
          })
          const maskRef = normalizeRef(uploaded && uploaded.ref)
          if (!maskRef) throw new Error('遮罩上传失败')
          const genParams = cleanGenParams({ ...params, model: modelId }, modelList)
          const result = await rpc('generate', {
            workspaceId: wsId,
            conversationId: convId,
            prompt,
            refs: [{ id: image.id }],
            maskId: maskRef.id,
            params: genParams,
          })
          if (!result || !result.turnId) throw new Error('生成请求没有返回任务 ID')
          const turn = result.turn
            ? normalizeTurn(result.turn)
            : normalizeTurn({
                id: result.turnId,
                createdAt: nowIso(),
                prompt,
                params: genParams,
                refs: [{ id: image.id }],
                status: 'running',
                images: [],
              })
          turn.jobId = turn.jobId || str(result.jobId)
          setConversation((previous) => {
            if (!previous || previous.id !== convId) return previous
            if (previous.turns.some((item) => item.id === turn.id)) return previous
            return { ...previous, turns: [...previous.turns, turn] }
          })
          setMaskEditor(null)
          pushToast('success', '已提交局部重绘，完成后新图片会出现在画布中')
          if (result.jobId) startJobPolling(result.jobId, result.turnId, wsId, convId, prompt)
        } catch (error) {
          pushToast('error', `局部重绘失败：${(error && error.message) || error}`)
        }
      }

      async function handleDeleteTurn(turn) {
        const wsId = activeWsRef.current
        const convId = activeConvRef.current
        if (!wsId || !convId || !turn || !turn.id) return
        try {
          const data = await rpc('turn.delete', {
            workspaceId: wsId,
            conversationId: convId,
            turnId: turn.id,
          })
          const stillActive = activeWsRef.current === wsId && activeConvRef.current === convId
          const next = normalizeConversation(data && data.conversation)
          if (next) {
            if (stillActive) setConversation(next)
          } else if (stillActive) {
            await refreshConversationQuiet(wsId, convId)
          }
          pushToast('success', '已删除该生成记录')
          refreshDataSilent({ mode: 'refresh' })
        } catch (error) {
          pushToast('error', `删除失败：${(error && error.message) || error}`)
        }
      }

      async function handleCancelJob(jobId) {
        if (!jobId) return
        try {
          await rpc('job.cancel', { jobId })
          pushToast('info', '已请求取消本次生成')
        } catch (error) {
          pushToast('error', `取消失败：${(error && error.message) || error}`)
        }
      }

      /** v1.2.6 (P0-1): cancel a job from the cross-session task panel. */
      async function handleCancelTask(jobId) {
        if (!jobId || cancellingJobId) return
        setCancellingJobId(jobId)
        try {
          await rpc('job.cancel', { jobId })
          pushToast('info', '已请求取消任务')
        } catch (error) {
          pushToast('error', `取消失败：${(error && error.message) || error}`)
        } finally {
          if (mountedRef.current) setCancellingJobId('')
        }
        try {
          const data = await rpc('job.list')
          if (mountedRef.current) {
            setTaskItems(isObj(data) && Array.isArray(data.jobs) ? data.jobs : [])
          }
        } catch (error) {
          // keep the previous list
        }
      }

      /* ---- v2.5: ComfyUI VRAM --------------------------------------------- */

      function toGiB(bytes) {
        const value = num(bytes, 0) / (1024 * 1024 * 1024)
        return Math.round(value * 10) / 10
      }

      function normalizeVram(raw) {
        if (!isObj(raw) || !(num(raw.totalBytes, 0) > 0)) return null
        return {
          totalBytes: num(raw.totalBytes, 0),
          usedBytes: num(raw.usedBytes, 0),
          freeBytes: num(raw.freeBytes, 0),
          totalGiB: toGiB(raw.totalBytes),
          usedGiB: toGiB(raw.usedBytes),
          freeGiB: toGiB(raw.freeBytes),
        }
      }

      async function refreshComfyVram() {
        if (!mountedRef.current) return
        try {
          const data = await rpc('comfy.status')
          if (!mountedRef.current) return
          setComfyVram(isObj(data) && data.ok ? normalizeVram(data.vram) : null)
        } catch (error) {
          if (mountedRef.current) setComfyVram(null)
        }
      }

      async function handleReleaseComfyVram() {
        let confirmed = true
        try {
          confirmed =
            typeof window.confirm === 'function'
              ? window.confirm(
                  '释放 ComfyUI 占用的显存？\n\n这会卸载模型（包括你在 ComfyUI 界面里加载的模型），下次生成需要重新加载。',
                )
              : true
        } catch (error) {
          confirmed = true
        }
        if (!confirmed) return
        const before = comfyVram
        try {
          const data = await rpc('comfy.free')
          if (!data || data.ok !== true) {
            pushToast('error', `释放失败：${str(data && data.error) || '未知错误'}`)
            return
          }
          const after = normalizeVram(data.vram)
          setComfyVram(after)
          const freed = before && after ? Math.round((before.usedGiB - after.usedGiB) * 10) / 10 : 0
          pushToast(
            'success',
            freed > 0 ? `已释放约 ${freed}G 显存` : '已请求 ComfyUI 释放显存',
          )
        } catch (error) {
          pushToast('error', `释放失败：${(error && error.message) || error}`)
        }
      }

      /* ---- v2.4: temporary agent session ---------------------------------- */

      function agentStoreKey(convId, templateId) {
        return 'dsh.creation-workbench.v1.agent.' + (convId || 'none') + '.' + templateId
      }

      function loadAgentMessages(convId, templateId) {
        try {
          const raw = window.localStorage.getItem(agentStoreKey(convId, templateId))
          if (!raw) return []
          const parsed = JSON.parse(raw)
          if (!Array.isArray(parsed)) return []
          return parsed
            .filter((item) => isObj(item) && (item.role === 'user' || item.role === 'assistant'))
            .map((item) => ({
              id: str(item.id),
              role: item.role,
              text: str(item.text),
              elapsedMs: num(item.elapsedMs, 0),
            }))
            .slice(-20)
        } catch (error) {
          return []
        }
      }

      function persistAgentMessages(convId, templateId, messages) {
        try {
          const slim = (Array.isArray(messages) ? messages : [])
            .map((item) => ({
              id: str(item.id),
              role: item.role === 'assistant' ? 'assistant' : 'user',
              text: str(item.text).slice(0, 8000),
              elapsedMs: num(item.elapsedMs, 0),
            }))
            .slice(-20)
          window.localStorage.setItem(agentStoreKey(convId, templateId), JSON.stringify(slim))
        } catch (error) {
          // storage may be full/unavailable — the session still works in memory
        }
      }

      /** v2.7: open (or create) the real agent workspace conversation for a template. */
      async function openAgentSession(template) {
        if (!isObj(template) || !str(template.id)) return
        try {
          const data = await rpc('agent.workspace', {
            templateId: str(template.id),
            templateName: str(template.name),
          })
          const workspace = data && data.workspace ? data.workspace : null
          const conv = data && data.conversation ? data.conversation : null
          if (!workspace || !conv) throw new Error('无法创建 Agent 会话')
          setActiveTab('workspace')
          setExpanded((previous) => ({ ...previous, [workspace.id]: true }))
          await refreshData({
            mode: 'refresh',
            selectWorkspaceId: workspace.id,
            selectConversationId: conv.id,
          })
          if (data.created) pushToast('success', '已创建 Agent 会话：' + (str(template.name) || '模板'))
        } catch (error) {
          pushToast('error', '打开 Agent 会话失败：' + ((error && error.message) || String(error)))
        }
      }

      async function sendAgentMessage(payload) {
        const session = agentSessionRef.current
        if (!session || session.busy) return
        const convId = activeConvRef.current || ''
        const templateId = session.templateId
        const input = isObj(payload) ? payload : {}
        const text = str(input.text).trim()
        const imageBase64 = str(input.imageBase64)
        if (!text && !imageBase64) return
        const userMessage = {
          id: uid('agm_'),
          role: 'user',
          text,
          imageDataUrl: str(input.imageDataUrl),
        }
        const history = [...session.messages, userMessage]
        const token = agentReqRef.current + 1
        agentReqRef.current = token
        setAgentSession({ ...session, messages: history, busy: true, error: '' })
        persistAgentMessages(convId, templateId, history)
        const apiMessages = history.map((item) => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          text: str(item.text),
          ...(item === userMessage && imageBase64
            ? { imageBase64, imageMime: str(input.imageMime) || 'image/png' }
            : {}),
        }))
        try {
          const data = await rpc('agent.run', { templateId, messages: apiMessages })
          if (agentReqRef.current !== token) return
          const reply = {
            id: uid('agm_'),
            role: 'assistant',
            text: str(data && data.prompt),
            elapsedMs: num(data && data.elapsedMs, 0),
          }
          const nextMessages = [...history, reply]
          setAgentSession({ ...session, messages: nextMessages, busy: false, error: '' })
          persistAgentMessages(convId, templateId, nextMessages)
          handleUseTemplate(templateId)
        } catch (error) {
          if (agentReqRef.current !== token) return
          setAgentSession({
            ...session,
            messages: history,
            busy: false,
            error: '生成失败：' + ((error && error.message) || String(error)),
          })
        }
      }

      async function retryAgentMessage() {
        const session = agentSessionRef.current
        if (!session || session.busy) return
        const messages = Array.isArray(session.messages) ? session.messages : []
        let lastUserIndex = -1
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index].role === 'user') {
            lastUserIndex = index
            break
          }
        }
        if (lastUserIndex < 0) return
        const lastUser = messages[lastUserIndex]
        const history = messages.slice(0, lastUserIndex)
        const convId = activeConvRef.current || ''
        setAgentSession({ ...session, messages: history, busy: false, error: '' })
        persistAgentMessages(convId, session.templateId, history)
        await sendAgentMessage({ text: lastUser.text })
      }

      function cancelAgentSession() {
        agentReqRef.current += 1
        const session = agentSessionRef.current
        if (!session) return
        setAgentSession({ ...session, busy: false, error: '已取消本次生成' })
      }

      function clearAgentSession() {
        const session = agentSessionRef.current
        if (!session) return
        const convId = activeConvRef.current || ''
        setAgentSession({ ...session, messages: [], busy: false, error: '' })
        persistAgentMessages(convId, session.templateId, [])
      }

      /** v2.7: clear the messages of the current agent conversation. */
      async function handleClearAgentChat() {
        const wsId = activeWsRef.current
        const convId = activeConvRef.current
        if (!wsId || !convId) return
        let confirmed = true
        try {
          confirmed =
            typeof window.confirm === 'function'
              ? window.confirm('清空这个 Agent 会话的所有消息？此操作不可恢复。')
              : true
        } catch (error) {
          confirmed = true
        }
        if (!confirmed) return
        try {
          await rpc('agent.clear', { workspaceId: wsId, conversationId: convId })
          await refreshConversationQuiet(wsId, convId)
          refreshDataSilent({ mode: 'refresh' })
          pushToast('success', '已清空 Agent 会话消息')
        } catch (error) {
          pushToast('error', '清空失败：' + ((error && error.message) || String(error)))
        }
      }

      async function copyAgentText(value) {
        const text = str(value)
        if (!text) return
        try {
          await copyText(text)
          pushToast('success', '已复制')
        } catch (error) {
          pushToast('error', '复制失败')
        }
      }

      /**
       * Insert agent output into the composer at the cursor. The drawer closes so
       * the user can review/edit before sending (per the agreed flow).
       */
      function insertFromAgent(value) {
        const text = str(value)
        if (!text) return
        if (activeTab !== 'workspace') setActiveTab('workspace')
        const element = textareaRef.current
        const current = str(promptRef.current)
        let start = current.length
        let end = current.length
        if (element && typeof element.selectionStart === 'number') {
          start = Math.min(element.selectionStart, current.length)
          end = Math.min(element.selectionEnd, current.length)
        }
        const prefix = current.slice(0, start)
        const suffix = current.slice(end)
        const separator = prefix && !/\n$/.test(prefix) ? '\n' : ''
        const next = prefix + separator + text + suffix
        setPrompt(next)
        setAgentSession(null)
        setTimeout(() => {
          const area = textareaRef.current
          if (area && typeof area.focus === 'function') {
            area.focus()
            const position = (prefix + separator + text).length
            try {
              area.setSelectionRange(position, position)
            } catch {
              // ignore
            }
          }
        }, 60)
      }

      /** v2.2: template tab + composer integration. */
      function handleSelectTemplate(id) {
        const found = (templates || []).find((template) => template.id === id) || null
        setTemplateEdit(found)
        setActiveTab('templates')
      }

      /** v3.1.4: open Settings directly on a workflow's parameter editor. */
      function handleEditWorkflowSettings(workflowId) {
        const id = str(workflowId)
        if (!id) {
          setSettingsOpen(true)
          return
        }
        setSettingsIntent({ workflowId: id })
        setSettingsOpen(true)
      }

      function handleNewTemplate() {
        setTemplateEdit({
          id: '',
          name: '',
          category: '通用',
          content: '',
          variables: [],
          bindWorkflowCategory: '',
          bindWorkflowId: '',
          tags: [],
          usageCount: 0,
        })
        setActiveTab('templates')
      }

      async function handleSaveTemplate(payload) {
        const data = await rpc('template.save', payload)
        const saved = data && data.template ? data.template : null
        if (saved) setTemplateEdit(normalizeTemplate(saved))
        await loadTemplates()
        pushToast('success', payload && payload.id ? '模板已保存' : '模板已创建')
        return saved
      }

      async function handleDeleteTemplate(id) {
        const target = (templates || []).find((template) => template.id === id)
        let confirmed = true
        try {
          confirmed =
            typeof window.confirm === 'function'
              ? window.confirm(
                  `确定删除模板「${str(target && target.name) || '未命名模板'}」？`,
                )
              : true
        } catch (error) {
          confirmed = true
        }
        if (!confirmed) return
        try {
          await rpc('template.delete', { id })
          setTemplateEdit(null)
          await loadTemplates()
          pushToast('success', '模板已删除')
        } catch (error) {
          pushToast('error', `删除失败：${(error && error.message) || error}`)
        }
      }

      function handleInsertTemplate(text) {
        setActiveTab('workspace')
        setPrompt(str(text))
        setTimeout(() => {
          const textarea = textareaRef.current
          if (textarea && typeof textarea.focus === 'function') textarea.focus()
        }, 60)
      }

      function handleUseTemplate(id) {
        void rpc('template.touch', { id }).catch(() => {})
      }

      function handleSaveAsTemplate(text) {
        setTemplateEdit({
          id: '',
          name: '',
          category: '通用',
          content: str(text),
          variables: [],
          bindWorkflowCategory: '',
          bindWorkflowId: '',
          tags: [],
          usageCount: 0,
        })
        setActiveTab('templates')
      }

      async function handleSaveAgentConfig(payload) {
        const data = await rpc('settings.set', payload)
        setSettings(normalizeSettings(data))
        pushToast('success', 'Agent 设置已保存')
      }

      async function handleTestAgent() {
        return rpc('agent.probe')
      }

      async function handleListDshModels() {
        return rpc('agent.models')
      }

      /** v2.1: switch the composer to a ComfyUI workflow and focus the input. */
      async function applyComfyWorkflowId(workflowId) {
        const id = str(workflowId)
        if (!id) return
        const workflow =
          findWorkflowById(workflowsRef.current, id) || findWorkflowById(workflows, id)
        if (!workflow) {
          pushToast('error', '工作流不存在或已删除')
          return
        }
        setActiveTab('workspace')
        setParams((previous) => ({
          ...previous,
          model: `comfy:${workflow.id}`,
          workflowId: workflow.id,
          workflowParams: {},
          workflowRandomize: {},
          n: 1,
        }))
        if (!activeConvRef.current && activeWsRef.current) {
          try {
            await createConversation(activeWsRef.current)
          } catch (error) {
            // conversation creation errors already surface through the toast path
          }
        }
        setTimeout(() => {
          const textarea = textareaRef.current
          if (textarea && typeof textarea.focus === 'function') textarea.focus()
        }, 60)
      }

      function pickWorkflowForCategory(category) {
        const list = (workflowsRef.current || []).filter(
          (item) => str(item.category) === category,
        )
        if (!list.length) return null
        return list
          .slice()
          .sort((left, right) => str(right.updatedAt).localeCompare(str(left.updatedAt)))[0]
      }

      /** v2.1 home hero: 「生成图片 / 视频 / 声音 / 模型」. */
      function handleHomeGenerate(category) {
        const picked = pickWorkflowForCategory(category)
        if (picked) {
          void applyComfyWorkflowId(picked.id)
          return
        }
        if (category === 'image') {
          const models = settings && Array.isArray(settings.models) ? settings.models : []
          if (models.length) {
            setActiveTab('workspace')
            setParams((previous) => ({
              ...previous,
              model: models[0].id,
              workflowId: '',
              workflowParams: {},
            }))
            setTimeout(() => {
              const textarea = textareaRef.current
              if (textarea && typeof textarea.focus === 'function') textarea.focus()
            }, 60)
            return
          }
        }
        pushToast('info', `「${workflowCategoryLabel(category)}」分类还没有工作流，先去设置导入`)
        setSettingsOpen(true)
      }

      /** v2.1 home hero: 「编辑」→ 选一张编辑类工作流（参考图选择在 v2.4）。 */
      function handleHomeEdit() {
        const picked = pickWorkflowForCategory('edit')
        if (!picked) {
          pushToast('info', '还没有「编辑」类工作流，先去设置导入并设置分类')
          setSettingsOpen(true)
          return
        }
        void applyComfyWorkflowId(picked.id)
        pushToast('info', '已选择编辑工作流；参考图输入将在后续版本开放')
      }

      async function handleWorkflowDelete(workflow) {
        const id = str(workflow && workflow.id)
        if (!id) return
        let confirmed = true
        try {
          confirmed =
            typeof window.confirm === 'function'
              ? window.confirm(
                  `确定删除工作流「${str(workflow.name) || '未命名工作流'}」？此操作不可恢复。`,
                )
              : true
        } catch (error) {
          confirmed = true
        }
        if (!confirmed) return
        try {
          await rpc('comfy.workflow.delete', { id })
          pushToast('success', '工作流已删除')
          if (
            isComfyModel(paramsRef.current.model) &&
            comfyWorkflowIdOf(paramsRef.current.model) === id
          ) {
            setParams((previous) => ({
              ...previous,
              model: '',
              workflowId: '',
              workflowParams: {},
            }))
          }
          await loadWorkflows()
        } catch (error) {
          pushToast('error', `删除失败：${(error && error.message) || error}`)
        }
      }

      /**
       * v1.1: stop a running turn that has no resumable jobId (old data or a
       * host restart dropped the in-memory job). Host reconciles the persisted
       * turn to cancelled; we then refresh so the skeleton is replaced.
       */
      async function handleAbortTurn(turn) {
        const wsId = activeWsRef.current
        const convId = activeConvRef.current
        if (!wsId || !convId || !turn || !turn.id) return
        try {
          const result = await rpc('turn.abort', {
            workspaceId: wsId,
            conversationId: convId,
            turnId: turn.id,
          })
          const handled = !!(result && (result.cancelled || result.reconciled))
          pushToast('info', handled ? '已中断该生成任务' : '已请求中断该生成任务')
          await refreshConversationQuiet(wsId, convId)
          refreshDataSilent({ mode: 'refresh' })
        } catch (error) {
          pushToast('error', `取消失败：${(error && error.message) || error}`)
        }
      }

      /* ---- send / retry -------------------------------------------------- */

      function apiReady() {
        if (!settings) return false
        // C5: the host folds IMAGE_API_BASE/IMAGE_API_KEY env fallbacks into
        // baseUrl/apiKeySet; envFallback alone must not be treated as ready.
        return !!(settings.apiKeySet && settings.baseUrl)
      }

      async function handleSend() {
        const text = str(prompt).trim()
        if (!text || sending) return
        const wsId = activeWsRef.current
        // v2.7: agent chat conversations send to the agent channel, not to image generation.
        if (isAgentConversation(conversationRef.current)) {
          const agentConvId = activeConvRef.current
          if (!wsId || !agentConvId) {
            pushToast('info', '请先选择一个 Agent 会话')
            return
          }
          setSending(true)
          try {
            await rpc('agent.send', {
              workspaceId: wsId,
              conversationId: agentConvId,
              text,
              refIds: refsRef.current.map((ref) => ref.id),
            })
            setPrompt('')
            setRefs([])
            await refreshConversationQuiet(wsId, agentConvId)
            refreshDataSilent({ mode: 'refresh' })
          } catch (error) {
            pushToast('error', 'Agent 回复失败：' + ((error && error.message) || String(error)))
            await refreshConversationQuiet(wsId, agentConvId)
          } finally {
            if (mountedRef.current) setSending(false)
          }
          return
        }
        if (!wsId) {
          pushToast('info', '请先新建或选择一个工作区')
          return
        }
        if (!settings || settings.models.length === 0) {
          // v1.2: ComfyUI workflow mode does not need API models.
          if (!isComfyModel(params.model)) {
            pushToast('error', '请先在设置中添加生图模型')
            setSettingsOpen(true)
            return
          }
        }
        // v1.2: ComfyUI workflow mode needs no API key — only a valid workflow.
        const comfySelected = isComfyModel(params.model)
        if (comfySelected && !COMFY_MODEL_RE.test(str(params.model))) {
          pushToast('error', '所选 ComfyUI 工作流无效，请先在设置中重新选择')
          setSettingsOpen(true)
          return
        }
        if (comfySelected) {
          const selectedWorkflow = findWorkflowById(
            workflowsRef.current,
            comfyWorkflowIdOf(params.model),
          )
          const slots = workflowImageSpecs(selectedWorkflow).length
          const refCount = refsRef.current.length
          if (refCount > 0 && slots === 0) {
            pushToast('info', '该工作流没有启用图像输入槽，先移除参考图或在设置里绑定图像输入')
            return
          }
          // v3.1.1: providing an image is optional — the workflow's own LoadImage
          // stays in effect when the composer has none.
          if (refCount > slots) {
            pushToast('info', `该工作流只启用了 ${slots} 个图像输入`)
            return
          }
        }
        if (!comfySelected && !apiReady()) {
          pushToast('error', '请先在设置中填写生图 API 地址与 API Key')
          setSettingsOpen(true)
          return
        }
        setSending(true)
        let convId = activeConvRef.current
        try {
          if (!convId) {
            const created = normalizeConversation(await rpc('conversation.create', { workspaceId: wsId }))
            if (!created) throw new Error('创建会话失败')
            convId = created.id
            setActiveConversationId(convId)
            setConversation(created)
            setExpanded((previous) => ({ ...previous, [wsId]: true }))
            await refreshData({ mode: 'refresh', selectWorkspaceId: wsId, selectConversationId: convId })
          }
          const genParams = cleanGenParams(
            params,
            settings ? settings.models : [],
            workflowsRef.current,
          )
          const payload = {
            workspaceId: wsId,
            conversationId: convId,
            prompt: text,
            refs: refsRef.current.map((ref) => ({ id: ref.id })),
            params: genParams,
          }
          const result = await rpc('generate', payload)
          if (!result || !result.turnId) throw new Error('生成请求没有返回任务 ID')
          const turn = result.turn
            ? normalizeTurn(result.turn)
            : normalizeTurn({
                id: result.turnId,
                createdAt: nowIso(),
                prompt: text,
                params: genParams,
                refs: refsRef.current,
                status: 'running',
                images: [],
              })
          // v1.1: always keep the jobId on the turn so a reload can resume it.
          turn.jobId = turn.jobId || str(result.jobId)
          setConversation((previous) => {
            if (!previous || previous.id !== convId) return previous
            if (previous.turns.some((item) => item.id === turn.id)) return previous
            return { ...previous, turns: [...previous.turns, turn] }
          })
          setPrompt('')
          setRefs([])
          if (result.jobId) {
            startJobPolling(result.jobId, result.turnId, wsId, convId, text)
          } else {
            // P3-07: track the fallback refresh timer so unmount cleans it up.
            const timer = setTimeout(() => {
              fallbackTimersRef.current.delete(timer)
              refreshConversationQuiet(wsId, convId)
            }, 1600)
            fallbackTimersRef.current.add(timer)
          }
          reportLog('info', `generate started turn=${result.turnId} job=${result.jobId || '-'}`)
        } catch (error) {
          pushToast('error', `生成失败：${(error && error.message) || error}`)
        } finally {
          if (mountedRef.current) setSending(false)
        }
      }

      async function handleRetryTurn(turn) {
        if (!turn || sending) return
        const wsId = activeWsRef.current
        const convId = activeConvRef.current
        if (!wsId || !convId) return
        setSending(true)
        try {
          const retryParams = normalizeGenParams(turn.params)
          const genParams = cleanGenParams(
            retryParams,
            settings ? settings.models : [],
            workflowsRef.current,
          )
          const payload = {
            workspaceId: wsId,
            conversationId: convId,
            prompt: turn.prompt || '继续生成',
            refs: (turn.refs || []).map((ref) => ({ id: ref.id })),
            params: genParams,
          }
          const result = await rpc('generate', payload)
          if (!result || !result.turnId) throw new Error('生成请求没有返回任务 ID')
          const nextTurn = result.turn
            ? normalizeTurn(result.turn)
            : normalizeTurn({
                id: result.turnId,
                createdAt: nowIso(),
                prompt: payload.prompt,
                params: genParams,
                refs: turn.refs || [],
                status: 'running',
                images: [],
              })
          nextTurn.jobId = nextTurn.jobId || str(result.jobId)
          setConversation((previous) =>
            previous && previous.id === convId
              ? { ...previous, turns: [...previous.turns, nextTurn] }
              : previous,
          )
          if (result.jobId) startJobPolling(result.jobId, result.turnId, wsId, convId, payload.prompt)
          pushToast('info', '已重新提交生成')
        } catch (error) {
          pushToast('error', `重试失败：${(error && error.message) || error}`)
        } finally {
          if (mountedRef.current) setSending(false)
        }
      }

      /* ---- workspace / conversation operations -------------------------- */

      function openNewWorkspaceDialog() {
        setDialog({
          kind: 'new-workspace',
          title: '新建工作区',
          label: '工作区名称',
          initialValue: `工作区 ${workspacesRef.current.length + 1}`,
          confirmText: '创建',
          hint: '工作区用来隔离不同主题的会话与图片。',
        })
      }

      function openRenameWorkspaceDialog(workspace) {
        setDialog({
          kind: 'rename-workspace',
          wsId: workspace.id,
          title: '重命名工作区',
          label: '工作区名称',
          initialValue: workspace.name,
          confirmText: '保存',
        })
      }

      function openDeleteWorkspaceDialog(workspace) {
        setDialog({
          kind: 'delete-workspace',
          wsId: workspace.id,
          title: '删除工作区',
          message: `确定删除工作区「${workspace.name}」？其中的会话与图片都会一并删除，且不可恢复。`,
          confirmText: '删除工作区',
        })
      }

      function openRenameConversationDialog(workspace, conv) {
        setDialog({
          kind: 'rename-conversation',
          wsId: workspace.id,
          conversationId: conv.id,
          title: '重命名会话',
          label: '会话标题',
          initialValue: conv.title || '新会话',
          confirmText: '保存',
        })
      }

      function openDeleteConversationDialog(workspace, conv) {
        setDialog({
          kind: 'delete-conversation',
          wsId: workspace.id,
          conversationId: conv.id,
          title: '删除会话',
          message: `确定删除会话「${conv.title || '新会话'}」？该会话的生成记录与图片都会被删除。`,
          confirmText: '删除会话',
        })
      }

      async function createConversation(wsId) {
        const targetWs = str(wsId) || activeWsRef.current
        if (!targetWs) {
          openNewWorkspaceDialog()
          return
        }
        if (busyAction) return
        setBusyAction('new-conversation')
        try {
          const created = normalizeConversation(
            await rpc('conversation.create', { workspaceId: targetWs }),
          )
          if (!created) throw new Error('会话创建失败')
          setActiveWorkspaceId(targetWs)
          setActiveConversationId(created.id)
          setConversation(created)
          setExpanded((previous) => ({ ...previous, [targetWs]: true }))
          await refreshData({
            mode: 'refresh',
            selectWorkspaceId: targetWs,
            selectConversationId: created.id,
          })
          pushToast('success', '新会话已创建')
          const element = textareaRef.current
          if (element) {
            try {
              element.focus()
            } catch (error) {
              // ignore
            }
          }
        } catch (error) {
          pushToast('error', `新建会话失败：${(error && error.message) || error}`)
        } finally {
          if (mountedRef.current) setBusyAction('')
        }
      }

      async function handleDialogConfirm(value) {
        if (!dialog || dialogBusy) return
        setDialogBusy(true)
        try {
          if (dialog.kind === 'new-workspace') {
            const created = normalizeWorkspace(await rpc('workspace.create', { name: value || '新工作区' }))
            if (!created) throw new Error('工作区创建失败')
            setConversation(null)
            await refreshData({
              mode: 'refresh',
              selectWorkspaceId: created.id,
              selectConversationId: '',
            })
            pushToast('success', `工作区「${created.name}」已创建`)
          } else if (dialog.kind === 'rename-workspace') {
            await rpc('workspace.rename', { id: dialog.wsId, name: value })
            setWorkspaces((previous) =>
              previous.map((workspace) =>
                workspace.id === dialog.wsId ? { ...workspace, name: value } : workspace,
              ),
            )
            refreshDataSilent({ mode: 'refresh' })
            pushToast('success', '工作区已重命名')
          } else if (dialog.kind === 'delete-workspace') {
            await rpc('workspace.delete', { id: dialog.wsId })
            if (dialog.wsId === activeWsRef.current) {
              setConversation(null)
              setActiveConversationId('')
            }
            await refreshData({ mode: 'refresh' })
            pushToast('success', '工作区已删除')
          } else if (dialog.kind === 'rename-conversation') {
            await rpc('conversation.rename', {
              conversationId: dialog.conversationId,
              title: value,
            })
            setConversation((previous) =>
              previous && previous.id === dialog.conversationId
                ? { ...previous, title: value }
                : previous,
            )
            setWorkspaces((previous) =>
              previous.map((workspace) =>
                workspace.id === dialog.wsId
                  ? {
                      ...workspace,
                      conversations: workspace.conversations.map((conversation) =>
                        conversation.id === dialog.conversationId
                          ? { ...conversation, title: value, updatedAt: nowIso() }
                          : conversation,
                      ),
                    }
                  : workspace,
              ),
            )
            refreshDataSilent({ mode: 'refresh' })
            pushToast('success', '会话已重命名')
          } else if (dialog.kind === 'delete-conversation') {
            await rpc('conversation.delete', {
              workspaceId: dialog.wsId,
              conversationId: dialog.conversationId,
            })
            if (dialog.conversationId === activeConvRef.current) {
              setConversation(null)
              setActiveConversationId('')
            }
            await refreshData({ mode: 'refresh' })
            pushToast('success', '会话已删除')
          }
          setDialog(null)
        } catch (error) {
          pushToast('error', `操作失败：${(error && error.message) || error}`)
        } finally {
          if (mountedRef.current) setDialogBusy(false)
        }
      }

      async function handleRefresh() {
        if (refreshingRef.current) return
        refreshingRef.current = true
        setRefreshing(true)
        try {
          await refreshData({ mode: 'refresh' })
          const wsId = activeWsRef.current
          const convId = activeConvRef.current
          if (wsId && convId) {
            const next = await loadConversation(wsId, convId, { silent: true })
            if (!next) pushToast('error', '刷新会话失败，请稍后重试')
            else pushToast('info', '已刷新')
          } else {
            pushToast('info', '已刷新')
          }
        } catch (error) {
          pushToast('error', `刷新失败：${(error && error.message) || error}`)
        } finally {
          refreshingRef.current = false
          if (mountedRef.current) setRefreshing(false)
        }
      }

      async function saveProxyOnboarding(patch, successText, failPrefix) {
        if (onboardBusy) return
        setOnboardBusy(true)
        try {
          const data = await rpc('settings.set', patch)
          setSettings(normalizeSettings(data))
          setOnboard(null)
          pushToast('success', successText)
        } catch (error) {
          pushToast('error', `${failPrefix}：${(error && error.message) || error}`)
        } finally {
          if (mountedRef.current) setOnboardBusy(false)
        }
      }

      const handleOnboardApply = (url) => {
        const target = str(url).trim()
        if (!target) return
        saveProxyOnboarding({ proxyUrl: target, onboardDone: true }, `已启用本地代理 ${target}`, '启用代理失败')
      }

      const handleOnboardDirect = () =>
        saveProxyOnboarding({ proxyUrl: '', onboardDone: true }, '已选择直连（可随时在设置中配置代理）', '保存失败')

      const handleOnboardManual = () => {
        suppressOnboardRef.current = true
        setOnboard(null)
        setSettingsOpen(true)
      }

      const handleOnboardLater = () => setOnboard(null)

      async function handleSettingsSaved(nextSettings) {
        setSettingsOpen(false)
        if (nextSettings) setSettings(normalizeSettings(nextSettings))
        try {
          await refreshData({ mode: 'refresh' })
        } catch (error) {
          pushToast('error', `设置已保存，但刷新数据失败：${(error && error.message) || error}`)
        }
      }

      const handleToggleWorkspace = (wsId) => {
        setExpanded((previous) => ({ ...previous, [wsId]: !previous[wsId] }))
      }

      const handleSelectWorkspace = (wsId) => {
        const workspace = workspacesRef.current.find((item) => item.id === wsId)
        setExpanded((previous) => ({ ...previous, [wsId]: true }))
        if (activeWsRef.current !== wsId) {
          const conversations =
            workspace && Array.isArray(workspace.conversations) ? workspace.conversations : []
          setActiveWorkspaceId(wsId)
          setActiveConversationId(conversations.length ? conversations[0].id : '')
        }
      }

      const handleSelectConversation = (wsId, convId) => {
        setExpanded((previous) => ({ ...previous, [wsId]: true }))
        setActiveWorkspaceId(wsId)
        setActiveConversationId(convId)
      }

      /* ---- render ------------------------------------------------------- */

      const activeWorkspace =
        workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null
      const conversationTurns =
        conversation && Array.isArray(conversation.turns) ? conversation.turns : []
      const homeNode =
        !conversationLoading && conversationTurns.length === 0
          ? h(HomeHero, {
              workflows,
              models: settings ? settings.models : [],
              onGenerate: handleHomeGenerate,
              onEdit: handleHomeEdit,
              onOpenSettings: () => setSettingsOpen(true),
            })
          : null
      const dial = resolveDialect(params.model, settings ? settings.models : [])
      const activeJobs = jobs.filter(
        (job) =>
          !job.conversationId ||
          !activeConversationId ||
          job.conversationId === activeConversationId,
      )

      const bootView =
        boot.status === 'loading'
          ? h(
              'div',
              { className: 'iw-boot' },
              h('div', { className: 'iw-boot-card' },
                h('div', { className: 'iw-boot-icon' }, h(StudioIcon, { size: 30 })),
                h('div', { className: 'iw-boot-title' }, 'AI 创作工作台'),
                h('div', { className: 'iw-boot-row' }, h(Spinner, { size: 15 }), h('span', null, '正在连接插件后端…'))),
            )
          : boot.status === 'error'
            ? h(
                'div',
                { className: 'iw-boot' },
                h(
                  'div',
                  { className: 'iw-boot-card' },
                  h('div', { className: 'iw-boot-icon error' }, h(Icon, { name: 'alert', size: 28 })),
                  h('div', { className: 'iw-boot-title' }, '无法连接插件后端'),
                  h('div', { className: 'iw-boot-error' }, boot.error || '未知错误'),
                  h(
                    'div',
                    { className: 'iw-boot-desc' },
                    autoRetryStopped
                      ? '自动重试已暂停，请点击下方按钮手动重试。'
                      : '宿主实现可能尚未就绪，页面会自动重试；也可以手动重试。',
                  ),
                  h(
                    'div',
                    { className: 'iw-boot-actions' },
                    h(
                      Btn,
                      {
                        variant: 'primary',
                        onClick: () => {
                          bootAttemptsRef.current = 0
                          setAutoRetryStopped(false)
                          setRetryToken((value) => value + 1)
                        },
                      },
                      h(Icon, { name: 'refresh', size: 13 }),
                      '重试',
                    ),
                    h(
                      Btn,
                      { onClick: () => window.location.reload() },
                      '刷新页面',
                    ),
                  ),
                ),
              )
            : h(
                'div',
                { className: 'iw-body' },
                h(Sidebar, {
                  workspaces,
                  activeWorkspaceId,
                  activeConversationId,
                  expanded,
                  settings,
                  onOpenCosts: () => setCostOpen(true),
                  disabled: !!busyAction,
                  onToggleWorkspace: handleToggleWorkspace,
                  onSelectWorkspace: handleSelectWorkspace,
                  onSelectConversation: handleSelectConversation,
                  onNewWorkspace: openNewWorkspaceDialog,
                  onNewConversation: (wsId) => createConversation(wsId),
                  onRenameWorkspace: openRenameWorkspaceDialog,
                  onDeleteWorkspace: openDeleteWorkspaceDialog,
                  onRenameConversation: openRenameConversationDialog,
                  onDeleteConversation: openDeleteConversationDialog,
                  onOpenSettings: () => setSettingsOpen(true),
                  comfyReady: (workflows || []).length > 0,
                  activeTab,
                  onSelectTab: setActiveTab,
                  workflowCount: workflows.length,
                  templates,
                  activeTemplateId: templateEdit ? str(templateEdit.id) : '',
                  onSelectTemplate: handleSelectTemplate,
                  onNewTemplate: handleNewTemplate,
                }),
                h(
                  'div',
                  { className: 'iw-main' },
                  h(
                    'div',
                    { className: cx('iw-workspace-view', activeTab !== 'workspace' && 'iw-hidden') },
                  h(Topbar, {
                    activeWorkspace,
                    conversation,
                    conversationLoading,
                    refreshing,
                    onRefresh: handleRefresh,
                    taskCount: taskItems.length,
                    onOpenTasks: () => setTaskPanelOpen(true),
                  }),
                  isAgentConversation(conversation)
                    ? h(AgentChatCanvas, {
                        conversation,
                        sending,
                        onClear: handleClearAgentChat,
                        onInsert: insertFromAgent,
                        onCopy: copyAgentText,
                      })
                    : h(Canvas, {
                    home: homeNode,
                    conversation,
                    conversationLoading,
                    activeWorkspace,
                    models: settings ? settings.models : [],
                    settings,
                    jobs: activeJobs,
                    deletingImageId,
                    onOpenImage: (image, turn) => setDetail({ image, turn }),
                    onAddRef: handleAddRefFromImage,
                    onDeleteImage: handleDeleteImage,
                    onDeleteTurn: handleDeleteTurn,
                    onOpenFile: handleOpenLocalFile,
                    onCancelJob: handleCancelJob,
                    onAbortTurn: handleAbortTurn,
                    onRetryTurn: handleRetryTurn,
                    timeoutMs: settings ? settings.jobTimeoutMs : DEFAULT_JOB_TIMEOUT_MS,
                    onNewWorkspace: openNewWorkspaceDialog,
                    onNewConversation: createConversation,
                    onOpenSettings: () => setSettingsOpen(true),
                  }),
                  h(Composer, {
                    settings,
                    models: settings ? settings.models : [],
                    workflows,
                    dialect: dial,
                    params,
                    onParamsChange: setParams,
                    prompt,
                    onPromptChange: setPrompt,
                    refs,
                    onRemoveRef: handleRemoveRef,
                    onAddFiles: handleAddFiles,
                    uploading,
                    sending,
                    jobs: activeJobs,
                    limits,
                    activeWorkspace,
                    conversationLoading,
                    onOpenSettings: () => setSettingsOpen(true),
                    onSend: handleSend,
                    onCancelJob: handleCancelJob,
                    textareaRef,
                    onToast: pushToast,
                    onClearRefs: () => setRefs([]),
                    agentChat: isAgentConversation(conversation),
                    templates,
                    onUseTemplate: handleUseTemplate,
                    onSaveAsTemplate: handleSaveAsTemplate,
                    onOpenAgentSession: openAgentSession,
                    vram: comfyVram,
                    onReleaseVram: () => void handleReleaseComfyVram(),
                  }),
                  ),
                  activeTab === 'workflows'
                    ? h(WorkflowBoard, {
                        workflows,
                        onUse: (id) => void applyComfyWorkflowId(id),
                        onEditWorkflow: handleEditWorkflowSettings,
                        onDelete: handleWorkflowDelete,
                        onOpenSettings: () => setSettingsOpen(true),
                      })
                    : null,
                  activeTab === 'assets'
                    ? h(ComingSoon, {
                        icon: 'image',
                        title: '资产库',
                        desc: '跨会话浏览、收藏与复用生成结果。',
                        badge: 'v2.4 上线',
                      })
                    : null,
                  activeTab === 'templates'
                    ? h(TemplateBoard, {
                        template: templateEdit,
                        onSave: handleSaveTemplate,
                        onDelete: handleDeleteTemplate,
                        onInsert: handleInsertTemplate,
                        agentSettings: settings,
                        onSaveAgentConfig: handleSaveAgentConfig,
                        onTestAgent: handleTestAgent,
                        onListDshModels: handleListDshModels,
                      })
                    : null,
                ),
              )

      const promptDialog = dialog && dialog.kind !== 'delete-workspace' && dialog.kind !== 'delete-conversation'
      const dialogNode = dialog
        ? promptDialog
          ? h(PromptDialog, {
              title: dialog.title,
              label: dialog.label,
              initialValue: dialog.initialValue,
              confirmText: dialog.confirmText,
              hint: dialog.hint,
              busy: dialogBusy,
              onCancel: () => {
                if (!dialogBusy) setDialog(null)
              },
              onConfirm: handleDialogConfirm,
            })
          : h(ConfirmDialog, {
              title: dialog.title,
              message: dialog.message,
              confirmText: dialog.confirmText,
              danger: true,
              busy: dialogBusy,
              onCancel: () => {
                if (!dialogBusy) setDialog(null)
              },
              onConfirm: () => handleDialogConfirm(),
            })
        : null

      return h(
        'div',
        { className: 'iw-root', ref: rootRef },
        h('style', null, CSS),
        bootView,
        settingsOpen && boot.status === 'ready'
          ? h(SettingsModal, {
              settings: settings || normalizeSettings(null),
              limits,
              intent: settingsIntent,
              onIntentHandled: () => setSettingsIntent(null),
              onClose: () => {
                setSettingsOpen(false)
                setSettingsIntent(null)
              },
              onSaved: handleSettingsSaved,
              onToast: pushToast,
              onWorkflowsChanged: () => loadWorkflows(),
            })
          : null,
        onboard && onboard.mode === 'prompt' && boot.status === 'ready' && !settingsOpen
          ? h(ProxyOnboardDialog, {
              onboarding: onboard,
              busy: onboardBusy,
              onApply: handleOnboardApply,
              onDirect: handleOnboardDirect,
              onManual: handleOnboardManual,
              onLater: handleOnboardLater,
            })
          : null,
        detail && boot.status === 'ready'
          ? h(DetailOverlay, {
              image: detail.image,
              turn: detail.turn,
              models: settings ? settings.models : [],
              deleting: deletingImageId === detail.image.id,
              onClose: () => setDetail(null),
              onAddRef: handleAddRefFromImage,
              onDelete: handleDeleteImage,
              onOpenFile: handleOpenLocalFile,
              onRevealFile: handleRevealLocalFile,
              onSaveAs: handleSaveAsLocalFile,
              onInpaint: (image, turn) => {
                // v1.2: ComfyUI workflow mode has no mask / inpaint path.
                if (isComfyModel(paramsRef.current.model)) {
                  pushToast('info', 'ComfyUI 工作流模式暂不支持局部重绘')
                  return
                }
                setDetail(null)
                setMaskEditor({ image, turn })
              },
              onToast: pushToast,
            })
          : null,
        maskEditor && boot.status === 'ready'
          ? h(MaskEditor, {
              image: maskEditor.image,
              turn: maskEditor.turn,
              models: settings ? settings.models : [],
              pushToast,
              onClose: () => setMaskEditor(null),
              onSubmit: handleInpaintSubmit,
            })
          : null,
        agentSession && boot.status === 'ready'
          ? h(AgentSession, {
              session: agentSession,
              template:
                (templates || []).find((item) => item.id === agentSession.templateId) || {
                  name: agentSession.name,
                },
              onSend: sendAgentMessage,
              onCancel: cancelAgentSession,
              onClear: clearAgentSession,
              onRetry: retryAgentMessage,
              onClose: () => setAgentSession(null),
              onInsert: insertFromAgent,
              onCopy: copyAgentText,
              onToast: pushToast,
            })
          : null,
        taskPanelOpen && boot.status === 'ready'
          ? h(TaskPanel, {
              items: taskItems,
              workspaces,
              cancellingId: cancellingJobId,
              onCancel: handleCancelTask,
              onClose: () => setTaskPanelOpen(false),
            })
          : null,
        costOpen && boot.status === 'ready'
          ? h(CostDashboard, {
              settings: settings || normalizeSettings(null),
              onClose: () => setCostOpen(false),
              pushToast,
              onSaveModelCosts: handleModelCostsSaved,
            })
          : null,
        dialogNode,
        h(ToastHost, { toasts, onDismiss: dismissToast }),
      )
    }

