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

      const handleKeyDown = (event) => {
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
            { className: cx('iw-composer', focused && 'focused'), ref: composerRef },
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
              : '描述你想生成的画面，/ 调用指令，@ 添加参考图',
              onChange: (event) => onPromptChange(event.target.value),
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
                          ? workflowList.map((workflow) => ({
                              value: `${COMFY_PREFIX}${workflow.id}`,
                              label: `工作流 · ${workflow.name}`,
                              group: 'ComfyUI 工作流',
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

