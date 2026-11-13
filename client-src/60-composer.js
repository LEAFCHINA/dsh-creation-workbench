    /* ------------------------------------------------------------------ */
    /* Composer (mirrors the DSH native composer)                          */
    /* ------------------------------------------------------------------ */

    function Composer(props) {
      const {
        settings,
        models,
        workflows,
        dialect,
        params,
        onParamsChange,
        prompt,
        onPromptChange,
        templates,
        onUseTemplate,
        onSaveAsTemplate,
        onOpenAgentSession,
        vram,
        onReleaseVram,
        refs,
        onRemoveRef,
        onAddFiles,
        uploading,
        onSend,
        sending,
        jobs,
        limits,
        activeWorkspace,
        conversationLoading,
        onOpenSettings,
        onCancelJob,
        textareaRef,
        onToast,
        onClearRefs,
      } = props
      const [focused, setFocused] = useState(false)
      const fileInputRef = useRef(null)
      // v1.3: refs for the one-time composer layout self-check (no screenshots).
      const composerRef = useRef(null)
      // v2.2: `@` template picker state.
      const templateList = Array.isArray(props.templates) ? props.templates : []
      const [atMenu, setAtMenu] = useState({ open: false, query: '', at: -1 })
      const [atIndex, setAtIndex] = useState(0)
      const [varTemplate, setVarTemplate] = useState(null)
      const [varValues, setVarValues] = useState({})
      // v2.3: ✨ agent template mode.
      const [agentTemplate, setAgentTemplate] = useState(null)
      const [agentAt, setAgentAt] = useState(-1)
      const [agentInput, setAgentInput] = useState('')
      const [agentImage, setAgentImage] = useState(null)
      const [agentBusy, setAgentBusy] = useState(false)
      const [agentResult, setAgentResult] = useState('')
      const [agentError, setAgentError] = useState('')
      const agentFileRef = useRef(null)
      const filteredTemplates = atMenu.open
        ? templateList.filter((template) => {
            const query = str(atMenu.query).toLowerCase()
            if (!query) return true
            const haystack =
              (str(template.name) + ' ' + str(template.category) + ' ' + str(template.content)).toLowerCase()
            return haystack.indexOf(query) >= 0
          })
        : []
      // v2.2: close the @ picker when clicking outside the composer.
      useEffect(() => {
        if (!atMenu.open) return undefined
        const onDocumentDown = (event) => {
          const root = composerRef.current
          if (root && event.target && typeof root.contains === 'function' && root.contains(event.target)) {
            return
          }
          setAtMenu({ open: false, query: '', at: -1 })
          setVarTemplate(null)
          setVarValues({})
        }
        document.addEventListener('mousedown', onDocumentDown)
        return () => document.removeEventListener('mousedown', onDocumentDown)
      }, [atMenu.open])
      const rowRef = useRef(null)
      const sendButtonRef = useRef(null)

      const maxN = clamp(Math.round(num(limits && limits.maxN, 4)), 1, 4)
      const modelList = Array.isArray(models) ? models : []
      const refList = Array.isArray(refs) ? refs : []
      const jobList = Array.isArray(jobs) ? jobs : []
      const latestJob = jobList.length ? jobList[jobList.length - 1] : null
      const canSend = !!str(prompt).trim() && !!activeWorkspace && !uploading && !sending && !conversationLoading
      // v1.2: local ComfyUI workflow mode state.
      const workflowList = Array.isArray(workflows) ? workflows : []
      const comfy = dialect === DIALECT.comfyui
      const activeWorkflowId = comfy
        ? comfyWorkflowIdOf(params.model) || str(params.workflowId)
        : ''
      const activeWorkflow = findWorkflowById(workflowList, activeWorkflowId)
      const workflowParams =
        activeWorkflow && Array.isArray(activeWorkflow.params) ? activeWorkflow.params : []
      const workflowParamValues = isObj(params.workflowParams) ? params.workflowParams : {}
      // v1.2.4: the 张数 selector is tied to the workflow's batch_size input.
      // API dialects always show it; ComfyUI workflows only when batch_size is
      // one of the exposed params.
      const workflowBatch = workflowBatchSpec(activeWorkflow)
      const batchParamKey = workflowBatch ? str(workflowBatch.key) : ''
      const showCount = !comfy || !!workflowBatch
      // v1.2.2: surface the "no prompt binding" case instead of silently
      // dropping the composer text for a ComfyUI workflow.
      const hasPromptBinding = workflowParams.some((spec) => !!spec && spec.role === 'prompt')

      // v1.3b: one-time composer diagnostics proving both geometry and the
      // computed visual state of the send button (no screenshots available):
      //   `composer geom2 {winW,winH,panel,composer,row,send rects,clippedH,
      //    clippedV,clipped,sendStyle{backgroundColor,color,borderColor,
      //    opacity,disabled}}` — logged immediately on mount AND ~500ms later,
      // plus the legacy `composer geom {...}` line once at ~500ms.
      useEffect(() => {
        const rectOf = (element) => {
          if (!element || typeof element.getBoundingClientRect !== 'function') return null
          const rect = element.getBoundingClientRect()
          return {
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
        }
        const styleOf = (element) =>
          element && typeof window.getComputedStyle === 'function'
            ? window.getComputedStyle(element)
            : null
        const collectGeometry = () => {
          try {
            const composerElement = composerRef.current
            const rowElement = rowRef.current
            const sendElement = sendButtonRef.current
            const rootElement =
              composerElement && typeof composerElement.closest === 'function'
                ? composerElement.closest('.iw-root')
                : null
            const composerRect = rectOf(composerElement)
            const rowRect = rectOf(rowElement)
            const sendRect = rectOf(sendElement)
            const panelRect = rectOf(rootElement)
            let clippedH = false
            let clippedV = false
            if (sendRect && composerRect) {
              if (sendRect.right > composerRect.right + 1 || sendRect.left < composerRect.left - 1) {
                clippedH = true
              }
              if (sendRect.bottom > composerRect.bottom + 1 || sendRect.top < composerRect.top - 1) {
                clippedV = true
              }
            }
            if (sendRect && sendElement) {
              let ancestor = sendElement.parentElement
              let guard = 0
              while (ancestor && guard < 30) {
                guard += 1
                const ancestorStyle = styleOf(ancestor)
                const ancestorRect = rectOf(ancestor)
                if (ancestorStyle && ancestorRect) {
                  const overflowX = ancestorStyle.overflowX
                  const overflowY = ancestorStyle.overflowY
                  if (
                    (overflowX === 'hidden' || overflowX === 'auto' || overflowX === 'scroll') &&
                    (sendRect.right > ancestorRect.right + 1 || sendRect.left < ancestorRect.left - 1)
                  ) {
                    clippedH = true
                  }
                  if (
                    (overflowY === 'hidden' || overflowY === 'auto' || overflowY === 'scroll') &&
                    (sendRect.bottom > ancestorRect.bottom + 1 || sendRect.top < ancestorRect.top - 1)
                  ) {
                    clippedV = true
                  }
                }
                if (ancestor === rootElement) break
                ancestor = ancestor.parentElement
              }
            }
            const sendStyleNode = styleOf(sendElement)
            const sendStyle = {
              backgroundColor: sendStyleNode ? sendStyleNode.backgroundColor : null,
              color: sendStyleNode ? sendStyleNode.color : null,
              borderColor: sendStyleNode ? sendStyleNode.borderColor : null,
              opacity: sendStyleNode ? sendStyleNode.opacity : null,
              disabled: sendElement ? !!sendElement.disabled : null,
            }
            // v1.3c: theme tokens + ENABLED computed style from a temporary
            // hidden probe with class iw-send-btn (appended & removed at once),
            // so the enabled colors can be verified without user typing.
            const themeSource =
              rootElement ||
              (typeof document !== 'undefined' ? document.documentElement : null)
            const themeStyleNode =
              themeSource && typeof window.getComputedStyle === 'function'
                ? window.getComputedStyle(themeSource)
                : null
            const themeVars = {
              brandPrimary: themeStyleNode
                ? str(themeStyleNode.getPropertyValue('--dsw-alias-brand-primary')).trim() || null
                : null,
              bgBase: themeStyleNode
                ? str(themeStyleNode.getPropertyValue('--dsw-alias-bg-base')).trim() || null
                : null,
            }
            let sendEnabledStyle = null
            try {
              const ownerDocument =
                composerElement && composerElement.ownerDocument ? composerElement.ownerDocument : null
              if (ownerDocument && composerElement && typeof ownerDocument.createElement === 'function') {
                const probe = ownerDocument.createElement('button')
                probe.className = 'iw-send-btn'
                probe.type = 'button'
                probe.setAttribute('aria-hidden', 'true')
                probe.tabIndex = -1
                if (probe.style) {
                  probe.style.position = 'absolute'
                  probe.style.visibility = 'hidden'
                  probe.style.pointerEvents = 'none'
                  probe.style.left = '-9999px'
                  probe.style.top = '0'
                }
                composerElement.appendChild(probe)
                try {
                  const probeStyleNode =
                    typeof window.getComputedStyle === 'function'
                      ? window.getComputedStyle(probe)
                      : null
                  sendEnabledStyle = {
                    backgroundColor: probeStyleNode ? probeStyleNode.backgroundColor : null,
                    color: probeStyleNode ? probeStyleNode.color : null,
                    borderColor: probeStyleNode ? probeStyleNode.borderColor : null,
                    opacity: probeStyleNode ? probeStyleNode.opacity : null,
                  }
                } finally {
                  try {
                    if (probe.parentNode === composerElement) composerElement.removeChild(probe)
                  } catch (removeError) {
                    // ignore probe cleanup failure
                  }
                }
              }
            } catch (probeError) {
              reportLog(
                'warn',
                `send enabled style probe failed: ${(probeError && probeError.message) || probeError}`,
              )
            }
            const winW =
              typeof window !== 'undefined' && typeof window.innerWidth === 'number'
                ? window.innerWidth
                : null
            const winH =
              typeof window !== 'undefined' && typeof window.innerHeight === 'number'
                ? window.innerHeight
                : null
            const geom = {
              winW,
              panelW: panelRect ? panelRect.width : null,
              composerW: composerRect ? composerRect.width : null,
              rowW: rowRect ? rowRect.width : null,
              sendRight: sendRect ? sendRect.right : null,
              composerRight: composerRect ? composerRect.right : null,
              clipped: clippedH || clippedV,
            }
            const geom2 = {
              winW,
              winH,
              panel: panelRect,
              composer: composerRect,
              row: rowRect,
              send: sendRect,
              clippedH,
              clippedV,
              clipped: clippedH || clippedV,
              sendStyle,
              themeVars,
              sendEnabledStyle,
            }
            reportLog('info', `composer geom2 ${JSON.stringify(geom2)}`)
            return geom
          } catch (error) {
            reportLog('warn', `composer geom2 check failed: ${(error && error.message) || error}`)
            return null
          }
        }
        collectGeometry()
        const timer = setTimeout(() => {
          const geom = collectGeometry()
          if (geom) reportLog('info', `composer geom ${JSON.stringify(geom)}`)
        }, 500)
        return () => clearTimeout(timer)
      }, [])

      useEffect(() => {
        const element = textareaRef.current
        if (!element) return
        element.style.height = 'auto'
        element.style.height = `${Math.min(element.scrollHeight, 180)}px`
      }, [prompt, textareaRef])

      const updateParam = (key, value) => {
        if (!onParamsChange) return
        onParamsChange({ ...params, [key]: value })
      }

      // v1.2: merge one exposed ComfyUI workflow param into params.workflowParams.
      const updateWorkflowParam = (key, value) => {
        if (!onParamsChange) return
        const nextWorkflowParams = {
          ...(isObj(params.workflowParams) ? params.workflowParams : {}),
          [key]: value,
        }
        onParamsChange({
          ...params,
          workflowId: activeWorkflowId,
          workflowParams: nextWorkflowParams,
        })
      }

      // v1.2.4: toggle "每次随机" for one numeric param straight from the composer.
      const updateWorkflowRandomize = (key, value) => {
        if (!onParamsChange) return
        const nextRandomize = {
          ...(isObj(params.workflowRandomize) ? params.workflowRandomize : {}),
          [key]: !!value,
        }
        onParamsChange({
          ...params,
          workflowId: activeWorkflowId,
          workflowRandomize: nextRandomize,
        })
      }

      // v1.2: one dynamic control of the selected ComfyUI workflow.
      const renderWorkflowParam = (spec) => {
        const key = str(spec.key) || `${spec.nodeId}.${spec.inputName}`
        const label = str(spec.label) || str(spec.inputName)
        const title = `${label}（${spec.nodeId}.${spec.inputName}）`
        const hasValue = Object.prototype.hasOwnProperty.call(workflowParamValues, key)
        const rawValue = hasValue ? workflowParamValues[key] : spec.default
        const textValue = rawValue === undefined || rawValue === null ? '' : String(rawValue)
        const randomizeMap = isObj(params.workflowRandomize) ? params.workflowRandomize : {}
        const randomizeOn = Object.prototype.hasOwnProperty.call(randomizeMap, key)
          ? !!randomizeMap[key]
          : !!spec.randomize
        let control = null
        let randomControl = null
        if (spec.type === 'select') {
          control = h(Select, {
            className: 'iw-param-select',
            value: textValue,
            options: (Array.isArray(spec.options) ? spec.options : []).map((option) => String(option)),
            onChange: (value) => updateWorkflowParam(key, value),
            title,
          })
        } else if (spec.type === 'bool') {
          control = h('input', {
            type: 'checkbox',
            checked: rawValue === true || textValue === 'true',
            title,
            onChange: (event) => updateWorkflowParam(key, !!event.target.checked),
          })
        } else if (spec.type === 'int' || spec.type === 'float') {
          control = h('input', {
            className: 'iw-input iw-input-number iw-param-num',
            type: 'number',
            step: spec.step != null ? spec.step : spec.type === 'int' ? 1 : 'any',
            min: spec.min != null ? spec.min : undefined,
            max: spec.max != null ? spec.max : undefined,
            value: textValue,
            title: randomizeOn ? `${title} · 已开启随机（显示上次生成值）` : title,
            onChange: (event) => {
              const nextText = event.target.value
              if (nextText === '') {
                updateWorkflowParam(key, '')
                return
              }
              const number = Number(nextText)
              if (!isFinite(number)) return
              updateWorkflowParam(key, spec.type === 'int' ? Math.round(number) : number)
            },
          })
          // v1.2.4: per-generation randomization for numeric params, right next
          // to the number — no trip to the settings editor required.
          randomControl = h(
            'label',
            { className: 'iw-param-check iw-param-random', title: '每次生成随机取值（如种子）' },
            h('input', {
              type: 'checkbox',
              checked: randomizeOn,
              onChange: (event) => updateWorkflowRandomize(key, !!event.target.checked),
            }),
            '随机',
          )
        } else {
          control = h('input', {
            className: 'iw-input iw-param-text',
            type: 'text',
            value: textValue,
            title,
            onChange: (event) => updateWorkflowParam(key, event.target.value),
          })
        }
        if (spec.type === 'bool') {
          return h(
            'label',
            { key, className: 'iw-param-item iw-param-check', title },
            control,
            h('span', { className: 'iw-param-label' }, label),
          )
        }
        return h(
          'div',
          { key, className: 'iw-param-item', title },
          h('span', { className: 'iw-param-label' }, label),
          control,
          randomControl,
        )
      }

      const closeAtMenu = () => {
        setAtMenu({ open: false, query: '', at: -1 })
        setVarTemplate(null)
        setVarValues({})
        setAtIndex(0)
      }

      const insertTemplate = (template, values) => {
        if (!template) return
        const rendered = renderTemplate(template.content, values)
        const current = str(prompt)
        const at = atMenu.at >= 0 ? atMenu.at : current.length
        const next = current.slice(0, at) + rendered
        onPromptChange(next)
        if (typeof onUseTemplate === 'function') onUseTemplate(template.id)
        closeAtMenu()
        setTimeout(() => {
          const element = textareaRef.current
          if (element && typeof element.focus === 'function') {
            element.focus()
            if (typeof element.setSelectionRange === 'function') {
              const position = next.length
              try {
                element.setSelectionRange(position, position)
              } catch {
                // ignore
              }
            }
          }
        }, 30)
      }

      const pickTemplate = (template) => {
        if (!template) return
        if (template.kind === 'agent') {
          // v2.4: 会话模式的 Agent 模板打开右侧临时会话；快问快答走行内面板。
          if (
            template.mode !== 'single' &&
            typeof onOpenAgentSession === 'function'
          ) {
            setAtMenu({ open: false, query: '', at: -1 })
            setVarTemplate(null)
            setAgentTemplate(null)
            onOpenAgentSession(template)
            return
          }
          setAgentTemplate(template)
          setAgentAt(atMenu.at)
          setAgentInput('')
          setAgentImage(null)
          setAgentResult('')
          setAgentError('')
          setAtMenu({ open: false, query: '', at: -1 })
          setVarTemplate(null)
          return
        }
        if (Array.isArray(template.variables) && template.variables.length) {
          setVarTemplate(template)
          setVarValues(templateVariableDefaults(template))
          return
        }
        insertTemplate(template, null)
      }

      const handlePromptInput = (value) => {
        onPromptChange(value)
        const text = str(value)
        const at = text.lastIndexOf('@')
        const valid = at >= 0 && (at === 0 || /\s/.test(text[at - 1]))
        const query = valid ? text.slice(at + 1) : ''
        if (valid && query.length <= 30 && query.indexOf('\n') < 0) {
          setAtMenu({ open: true, query, at })
          setAtIndex(0)
        } else if (atMenu.open) {
          setAtMenu({ open: false, query: '', at: -1 })
          setVarTemplate(null)
        }
      }

      const allowAgentText = !!(
        agentTemplate &&
        agentTemplate.agent &&
        Array.isArray(agentTemplate.agent.inputTypes) &&
        agentTemplate.agent.inputTypes.indexOf('text') >= 0
      )
      const allowAgentImage = !!(
        agentTemplate &&
        agentTemplate.agent &&
        Array.isArray(agentTemplate.agent.inputTypes) &&
        agentTemplate.agent.inputTypes.indexOf('image') >= 0
      )
      const canRunAgent = !!agentTemplate && ((allowAgentText && str(agentInput).trim()) || (allowAgentImage && agentImage))

      const setAgentImageFromFile = (file) => {
        if (!file) return
        if (!/^image\/(png|jpeg|webp)$/i.test(file.type || '')) {
          setAgentError('只支持 PNG / JPEG / WebP 图片')
          return
        }
        if (file.size > 6 * 1024 * 1024) {
          setAgentError('图片过大（最多 6MB）')
          return
        }
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = String(reader.result || '')
          const comma = dataUrl.indexOf(',')
          const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''
          if (!base64) {
            setAgentError('读取图片失败')
            return
          }
          setAgentImage({ dataUrl, base64, mime: file.type, name: file.name || 'image.png' })
          setAgentError('')
        }
        reader.onerror = () => setAgentError('读取图片失败')
        reader.readAsDataURL(file)
      }
      const runAgentTemplate = async () => {
        if (!agentTemplate || agentBusy) return
        if (!canRunAgent) {
          setAgentError('请输入文字或选择一张图片')
          return
        }
        setAgentBusy(true)
        setAgentError('')
        try {
          const input = {}
          if (allowAgentText) input.text = str(agentInput)
          if (allowAgentImage && agentImage) {
            input.imageBase64 = agentImage.base64
            input.imageMime = agentImage.mime
          }
          const data = await rpc('agent.run', { templateId: agentTemplate.id, input })
          setAgentResult(str(data && data.prompt))
          if (typeof onUseTemplate === 'function') onUseTemplate(agentTemplate.id)
        } catch (failure) {
          setAgentError((failure && failure.message) || String(failure))
        } finally {
          setAgentBusy(false)
        }
      }
      const exitAgent = () => {
        setAgentTemplate(null)
        setAgentAt(-1)
        setAgentInput('')
        setAgentImage(null)
        setAgentResult('')
        setAgentError('')
      }
      const insertAgentResult = () => {
        if (!agentResult) return
        const current = str(prompt)
        const at = agentAt >= 0 ? agentAt : current.length
        onPromptChange(current.slice(0, at) + str(agentResult))
        exitAgent()
        setTimeout(() => {
          const element = textareaRef.current
          if (element && typeof element.focus === 'function') element.focus()
        }, 30)
      }

      const renderAgentPanel = () => {
        if (!agentTemplate) return null
        const agent = isObj(agentTemplate.agent) ? agentTemplate.agent : {}
        return h(
          'div',
          { className: 'iw-agent-panel' },
          h(
            'div',
            { className: 'iw-agent-head' },
            h(Icon, { name: 'spark', size: 13 }),
            h('span', { className: 'iw-agent-name' }, str(agentTemplate.name)),
            h('span', { className: 'iw-agent-kind' }, 'Agent 模板'),
            h(
              'button',
              { type: 'button', className: 'iw-agent-x', title: '退出 Agent 模式', onClick: exitAgent },
              h(Icon, { name: 'x', size: 11 }),
            ),
          ),
          allowAgentText
            ? h('textarea', {
                className: 'iw-input iw-agent-text',
                rows: 3,
                value: agentInput,
                placeholder: '描述你的想法，例如：一张雨夜霓虹街头的人像…',
                onChange: (event) => setAgentInput(event.target.value),
              })
            : null,
          allowAgentImage
            ? h(
                'div',
                { className: 'iw-agent-image-row' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'iw-btn iw-btn-sm',
                    onClick: () => {
                      if (agentFileRef.current) agentFileRef.current.click()
                    },
                  },
                  '选择图片',
                ),
                agentImage
                  ? h('span', { className: 'iw-agent-image-name' }, agentImage.name)
                  : h('span', { className: 'iw-agent-hint' }, '或直接粘贴图片（反推提示词）'),
                agentImage
                  ? h(
                      'button',
                      { type: 'button', className: 'iw-btn iw-btn-sm', onClick: () => setAgentImage(null) },
                      '移除',
                    )
                  : null,
                h('input', {
                  type: 'file',
                  accept: 'image/png,image/jpeg,image/webp',
                  ref: agentFileRef,
                  className: 'iw-agent-file',
                  onChange: (event) => {
                    const file = event.target.files && event.target.files[0]
                    setAgentImageFromFile(file)
                    event.target.value = ''
                  },
                }),
              )
            : null,
          str(agent.outputFormat) === 'prompt_negative'
            ? h('div', { className: 'iw-agent-hint' }, '输出会包含正向提示词与负面词，确认后插入输入框。')
            : null,
          agentError ? h('div', { className: 'iw-agent-error' }, agentError) : null,
          agentResult
            ? h(
                'div',
                { className: 'iw-agent-result' },
                h('div', { className: 'iw-agent-result-label' }, 'Agent 结果（可编辑后插入）'),
                h('textarea', {
                  className: 'iw-input iw-agent-result-text',
                  rows: 5,
                  value: agentResult,
                  onChange: (event) => setAgentResult(event.target.value),
                }),
              )
            : null,
          h(
            'div',
            { className: 'iw-agent-actions' },
            h('button', { type: 'button', className: 'iw-btn', onClick: exitAgent }, '取消'),
            agentResult
              ? h('button', { type: 'button', className: 'iw-btn iw-btn-primary', onClick: insertAgentResult }, '确认插入')
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'iw-btn iw-btn-primary',
                    disabled: agentBusy || !canRunAgent,
                    onClick: () => void runAgentTemplate(),
                  },
                  agentBusy ? '生成中…' : '生成提示词',
                ),
            agentResult
              ? h(
                  'button',
                  { type: 'button', className: 'iw-btn', disabled: agentBusy, onClick: () => void runAgentTemplate() },
                  '重新生成',
                )
              : null,
          ),
        )
      }

      const renderAtMenu = () => {
        if (varTemplate) {
          const keys = Array.isArray(varTemplate.variables) ? varTemplate.variables : []
          return h(
            'div',
            { className: 'iw-at-menu' },
            h('div', { className: 'iw-at-head' }, `填写「${str(varTemplate.name)}」的变量`),
            keys.map((variable) =>
              h(
                'label',
                { key: variable.key, className: 'iw-at-var-row' },
                h('span', { className: 'iw-at-var-key' }, str(variable.label) || variable.key),
                h('input', {
                  className: 'iw-input iw-at-var-input',
                  value: str(varValues[variable.key]),
                  placeholder: str(variable.default) || '默认值',
                  onChange: (event) =>
                    setVarValues((previous) => ({ ...previous, [variable.key]: event.target.value })),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      insertTemplate(varTemplate, varValues)
                    }
                  },
                }),
              ),
            ),
            h(
              'div',
              { className: 'iw-at-actions' },
              h('button', { type: 'button', className: 'iw-btn', onClick: closeAtMenu }, '取消'),
              h(
                'button',
                { type: 'button', className: 'iw-btn iw-btn-primary', onClick: () => insertTemplate(varTemplate, varValues) },
                '插入',
              ),
            ),
          )
        }
        const agentFirst = filteredTemplates
          .slice()
          .sort((left, right) => {
            const rank = (item) => (item.kind === 'agent' ? 0 : 1)
            return rank(left) - rank(right)
          })
        const list = agentFirst.slice(0, 10)
        return h(
          'div',
          { className: 'iw-at-menu' },
          h(
            'div',
            { className: 'iw-at-head' },
            h(Icon, { name: 'spark', size: 12 }),
            atMenu.query ? `模板：${atMenu.query}` : '选择模板（✨ Agent 模板优先）',
          ),
          list.length
            ? list.map((template, index) =>
                h(
                  'button',
                  {
                    key: template.id,
                    type: 'button',
                    className: cx('iw-at-item', index === atIndex && 'active'),
                    onMouseEnter: () => setAtIndex(index),
                    onClick: () => pickTemplate(template),
                  },
                  h('span', { className: 'iw-at-name' }, str(template.name)),
                  h('span', { className: 'iw-at-cat' }, str(template.category)),
                  template.kind === 'agent'
                    ? h(
                        'span',
                        { className: 'iw-at-agent' },
                        template.mode === 'single' ? '✨ Agent · 快问快答' : '✨ Agent · 会话',
                      )
                    : template.variables.length
                    ? h('span', { className: 'iw-at-vars' }, `${template.variables.length} 个变量`)
                    : null,
                ),
              )
            : h(
                'div',
                { className: 'iw-at-empty' },
                templateList.length ? '没有匹配的模板' : '还没有模板，去「模板」标签新建一个',
              ),
          h(
            'div',
            { className: 'iw-at-foot' },
            h(
              'button',
              {
                type: 'button',
                className: 'iw-at-save',
                onClick: () => {
                  const text = str(prompt).trim()
                  closeAtMenu()
                  if (!text) {
                    if (onToast) onToast('info', '先输入提示词再存为模板')
                    return
                  }
                  if (typeof onSaveAsTemplate === 'function') onSaveAsTemplate(text)
                },
              },
              '＋ 把当前输入存为模板',
            ),
          ),
        )
      }

      const handleKeyDown = (event) => {
        if (atMenu.open && !varTemplate) {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeAtMenu()
            return
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const total = Math.max(1, filteredTemplates.length)
            setAtIndex((index) =>
              event.key === 'ArrowDown' ? (index + 1) % total : (index - 1 + total) % total,
            )
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            const template = filteredTemplates[atIndex]
            if (template) pickTemplate(template)
            return
          }
        }

        if (event.key !== 'Enter') return
        if (event.shiftKey) return
        if (event.nativeEvent && event.nativeEvent.isComposing) return
        if (event.isComposing) return
        event.preventDefault()
        if (canSend) onSend()
      }

      const handlePaste = (event) => {
        const clipboard = event.clipboardData
        if (!clipboard) return
        const files = []
        for (const item of Array.from(clipboard.items || [])) {
          if (item.kind === 'file' && /^image\//.test(item.type || '')) {
            const file = item.getAsFile()
            if (file) files.push(file)
          }
        }
        if (files.length) {
          event.preventDefault()
          // v2.3: while an agent template is active, paste fills its image input.
          if (agentTemplate && allowAgentImage) {
            setAgentImageFromFile(files[0])
            return
          }
          // v1.2: ComfyUI workflows do not accept reference images (v1 scope).
          if (comfy) {
            if (onToast) onToast('info', 'ComfyUI 工作流模式暂不支持参考图')
            return
          }
          onAddFiles(files)
        }
      }

      const openFilePicker = () => {
        // v1.2: reference images are not supported in ComfyUI workflow mode.
        if (comfy) {
          if (onToast) onToast('info', 'ComfyUI 工作流模式暂不支持参考图')
          return
        }
        if (fileInputRef.current) fileInputRef.current.click()
      }

      const pct = latestJob
        ? Math.round(clamp(num(latestJob.progress, 0), 0, 1) * 100)
        : 0

      return h(
        'div',
        { className: 'iw-composer-dock' },
        h(
          'div',
          { className: 'iw-composer-wrap' },
          h(
            'div',
            { className: cx('iw-composer', focused && 'focused', agentTemplate && 'iw-agent-mode'), ref: composerRef },
            agentTemplate ? renderAgentPanel() : atMenu.open ? renderAtMenu() : null,
            refList.length
              ? h(
                  'div',
                  { className: 'iw-ref-tray' },
                  refList.map((ref) =>
                    h(
                      'div',
                      { key: ref.id, className: 'iw-ref-chip', title: ref.name || '参考图' },
                      h(ThumbImage, { src: imageSrc(ref), alt: ref.name || '参考图' }),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'iw-ref-x',
                          title: '移除参考图',
                          onClick: (event) => {
                            event.stopPropagation()
                            onRemoveRef(ref.id)
                          },
                        },
                        h(Icon, { name: 'x', size: 10 }),
                      ),
                    ),
                  ),
                  h('span', { className: 'iw-ref-count' }, `${refList.length}/${MAX_REFS}`),
                )
              : null,
            h('textarea', {
              ref: textareaRef,
              className: 'iw-composer-textarea',
              rows: 1,
              value: prompt,
              placeholder: comfy
              ? '描述你想生成的画面（ComfyUI 工作流模式：文字写入绑定的提示词节点）'
              : '描述你想生成的画面，/ 调用指令，@ 插入提示词模板',
              onChange: (event) => handlePromptInput(event.target.value),
              onKeyDown: handleKeyDown,
              onPaste: handlePaste,
              onFocus: () => setFocused(true),
              onBlur: () => setFocused(false),
              spellCheck: false,
            }),
            h(
              'div',
              { className: 'iw-composer-row', ref: rowRef },
              h(
                'div',
                { className: 'iw-composer-left' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'iw-plus-btn',
                    title: comfy
                      ? 'ComfyUI 工作流模式暂不支持参考图'
                      : '添加参考图（也支持粘贴图片）',
                    onClick: openFilePicker,
                    disabled: !!uploading || comfy,
                  },
                  uploading ? h(Spinner, { size: 14 }) : h(Icon, { name: 'plus', size: 16 }),
                ),
                h('input', {
                  ref: fileInputRef,
                  className: 'iw-file-input',
                  type: 'file',
                  accept: 'image/*',
                  multiple: true,
                  onChange: (event) => {
                    const files = Array.from(event.target.files || [])
                    if (files.length) onAddFiles(files)
                    event.target.value = ''
                  },
                }),
                h(
                  'span',
                  { className: 'iw-composer-hint' },
                  comfy
                    ? '工作流模式'
                    : refList.length
                      ? `参考图 ${refList.length}/${MAX_REFS}`
                      : '可粘贴图片',
                ),
              ),
              h(
                'div',
                { className: 'iw-composer-controls' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'iw-composer-link',
                    title: '把当前输入保存为提示词模板',
                    onClick: () => {
                      const text = str(prompt).trim()
                      if (!text) {
                        if (onToast) onToast('info', '先输入提示词再存为模板')
                        return
                      }
                      if (typeof onSaveAsTemplate === 'function') onSaveAsTemplate(text)
                    },
                  },
                  h(Icon, { name: 'spark', size: 11 }),
                  '存为模板',
                ),
                modelList.length === 0 && workflowList.length === 0
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'iw-control-warn',
                        title: '尚未配置模型，点击打开设置',
                        onClick: onOpenSettings,
                      },
                      h(Icon, { name: 'alert', size: 12 }),
                      '未配置模型',
                    )
                  : h(Select, {
                      className: 'iw-select-model',
                      value: params.model,
                      options: [
                        ...modelList.map((model) => ({
                          value: model.id,
                          label: model.label || model.id,
                        })),
                        ...(workflowList.length
                          ? workflowList
                              .slice()
                              .sort(
                                (left, right) =>
                                  compareWorkflowCategory(left.category, right.category) ||
                                  str(left.name).localeCompare(str(right.name)),
                              )
                              .map((workflow) => ({
                                value: `${COMFY_PREFIX}${workflow.id}`,
                                label: workflow.name,
                                group: `工作流 · ${workflowCategoryLabel(workflow.category)}`,
                              }))
                          : [
                              {
                                value: COMFY_UNCONFIGURED_VALUE,
                                label: '未配置 ComfyUI 工作流（点击设置）',
                                group: 'ComfyUI 工作流',
                              },
                            ]),
                      ],
                      onChange: (value) => {
                        // v1.2: the pseudo entry opens settings instead of
                        // changing the model.
                        if (value === COMFY_UNCONFIGURED_VALUE) {
                          if (onOpenSettings) onOpenSettings()
                          return
                        }
                        // C1: switching model may switch dialect — re-clamp
                        // quality against the new dialect's allowed set so the
                        // select and the generate payload always agree.
                        const nextDialect = resolveDialect(value, modelList)
                        const allowed = qualityOptions(nextDialect)
                        const nextQuality =
                          allowed.indexOf(str(params.quality)) >= 0 ? params.quality : 'auto'
                        const nextWorkflowId = comfyWorkflowIdOf(value)
                        // v1.2: entering workflow mode drops reference images
                        // (unsupported) and the previous workflow's values.
                        if (nextWorkflowId && typeof onClearRefs === 'function') onClearRefs()
                        const nextWorkflow = findWorkflowById(workflowList, nextWorkflowId)
                        const nextHasBatch = !!workflowBatchSpec(nextWorkflow)
                        // v1.2.5: remember the current workflow's state and restore
                        // the target workflow's own state. Param keys (p_1, p_2, …)
                        // are identical in every workflow, so carrying values over
                        // silently ran the new workflow with the old one's settings
                        // (wrong seed/size, and a "张数" that belonged to another
                        // workflow). A workflow without batch_size always runs once.
                        const cache = isObj(params.workflowCache) ? { ...params.workflowCache } : {}
                        const previousWorkflowId =
                          comfyWorkflowIdOf(params.model) || str(params.workflowId)
                        if (previousWorkflowId) {
                          cache[previousWorkflowId] = {
                            values: isObj(params.workflowParams) ? { ...params.workflowParams } : {},
                            randomize: isObj(params.workflowRandomize)
                              ? { ...params.workflowRandomize }
                              : {},
                            n: params.n,
                          }
                        }
                        const restored =
                          nextWorkflowId && isObj(cache[nextWorkflowId]) ? cache[nextWorkflowId] : null
                        const restoredValues =
                          restored && isObj(restored.values) ? { ...restored.values } : {}
                        const restoredRandomize =
                          restored && isObj(restored.randomize) ? { ...restored.randomize } : {}
                        const restoredN = restored
                          ? clamp(Math.round(num(restored.n, 1)), 1, maxN)
                          : 1
                        onParamsChange({
                          ...params,
                          model: value,
                          quality: nextQuality,
                          n: nextWorkflowId && nextHasBatch ? restoredN : nextWorkflowId ? 1 : params.n,
                          workflowId: nextWorkflowId,
                          workflowParams: restoredValues,
                          workflowRandomize: restoredRandomize,
                          workflowCache: cache,
                        })
                      },
                      title: '模型',
                    }),
                // v1.2: size / aspect / resolution / quality only apply to the
                // API dialects — ComfyUI workflows carry their own node inputs.
                comfy
                  ? null
                  : dialect === DIALECT.xai
                    ? h(Select, {
                        className: 'iw-select-ratio',
                        value: params.aspectRatio,
                        options: ASPECT_OPTIONS,
                        onChange: (value) => updateParam('aspectRatio', value),
                        title: '比例',
                      })
                    : h(Select, {
                        className: 'iw-select-ratio',
                        value: params.size,
                        options: SIZE_OPTIONS,
                        onChange: (value) => updateParam('size', value),
                        title: '尺寸',
                      }),
                comfy
                  ? null
                  : dialect === DIALECT.xai
                    ? h(Select, {
                        className: 'iw-select-resolution',
                        value: params.resolution,
                        options: RESOLUTION_OPTIONS,
                        onChange: (value) => updateParam('resolution', value),
                        title: '分辨率',
                      })
                    : null,
                comfy
                  ? null
                  : h(Select, {
                      className: 'iw-select-quality',
                      value: params.quality,
                      options: qualityOptions(dialect),
                      onChange: (value) => updateParam('quality', value),
                      title: '质量',
                    }),
                showCount
                  ? h(Select, {
                      className: 'iw-select-count',
                      value: String(params.n),
                      options: Array.from({ length: maxN }).map((_, index) => ({
                        value: String(index + 1),
                        label: `${index + 1} 张`,
                      })),
                      onChange: (value) => updateParam('n', Number(value) || 1),
                      title: '生成张数',
                    })
                  : null,
              ),
              comfy && vram && (vram.totalBytes > 0 || vram.totalGiB > 0)
                ? h(
                    'span',
                    { className: 'iw-vram', title: 'ComfyUI 显存占用（模型常驻时会保持高位）' },
                    h('span', { className: 'iw-vram-text' },
                      `显存 ${vram.usedGiB}/${vram.totalGiB}G`,
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'iw-vram-release',
                        title: '释放 ComfyUI 占用的显存（包括你在 ComfyUI 里加载的模型）',
                        onClick: onReleaseVram,
                      },
                      '释放',
                    ),
                  )
                : null,
              // v1.3: send button is a sibling of the wrapping controls group
              // (fixed flex item at the row end) so it can never be clipped.
              h(
                'button',
                {
                  type: 'button',
                  ref: sendButtonRef,
                  className: 'iw-send-btn',
                  title: canSend ? '发送 (Enter)' : '请输入提示词',
                  'aria-label': '发送',
                  disabled: !canSend,
                  onClick: () => {
                    if (canSend) onSend()
                  },
                },
                sending
                  ? h(Spinner, { size: 14 })
                  : h(Icon, { name: 'arrowUp', size: 18, strokeWidth: 2.2 }),
              ),
            ),
            comfy
              ? h(
                  'div',
                  { className: 'iw-composer-params' },
                  activeWorkflow && workflowParams.length
                    ? workflowParams
                        .filter(
                          (spec) =>
                            spec && spec.role !== 'prompt' && str(spec.key) !== batchParamKey,
                        )
                        .map((spec) => renderWorkflowParam(spec))
                    : h(
                        'span',
                        { className: 'iw-composer-hint' },
                        activeWorkflowId
                          ? '该工作流没有可调参数（提示词由输入框提供）'
                          : '工作流未加载，请在设置中检查 ComfyUI 工作流',
                      ),
                  activeWorkflow && workflowParams.length && !hasPromptBinding
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'iw-composer-hint iw-composer-warn-hint',
                          title: '打开设置，为该工作流绑定主提示词',
                          onClick: onOpenSettings,
                        },
                        '⚠ 未绑定主提示词：输入框文字不会写入工作流，点击绑定',
                      )
                    : null,
                )
              : null,
          ),
          jobList.length
            ? h(
                'div',
                { className: 'iw-progress-line' },
                h(Spinner, { size: 11 }),
                h(
                  'span',
                  { className: 'iw-progress-text' },
                  jobList.length === 1
                    ? `${jobProgressText(latestJob)}${
                        latestJob.prompt ? ` · ${truncate(latestJob.prompt, 36)}` : ''
                      }`
                    : `${jobList.length} 个生成任务进行中 · ${jobProgressText(latestJob)}`,
                ),
                h(
                  'span',
                  { className: 'iw-progress-track' },
                  h('span', { className: 'iw-progress-fill', style: { width: `${pct}%` } }),
                ),
                typeof onCancelJob === 'function' && latestJob && latestJob.jobId
                  ? h(
                      'button',
                      {
                        type: 'button',
                        className: 'iw-progress-cancel',
                        title: '取消当前生成',
                        onClick: () => onCancelJob(latestJob.jobId),
                      },
                      h(Icon, { name: 'stop', size: 10 }),
                      '取消',
                    )
                  : null,
              )
            : h(
                'div',
                { className: 'iw-composer-tips' },
                h(
                  'span',
                  null,
                  comfy
                    ? 'Enter 发送 · Shift+Enter 换行 · ComfyUI 工作流模式'
                    : 'Enter 发送 · Shift+Enter 换行 · 支持粘贴图片',
                ),
                h(
                  'span',
                  { className: 'iw-composer-tips-right' },
                  comfy
                    ? settings && settings.comfyBaseUrl
                      ? 'ComfyUI 已配置'
                      : 'ComfyUI 未配置地址，请先在设置中填写'
                    : settings && (settings.apiKeySet || settings.envFallback)
                      ? 'API 已配置'
                      : 'API 未配置，请先在设置中填写',
                ),
              ),
        ),
      )
    }

