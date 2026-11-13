    /* ------------------------------------------------------------------ */
    /* Settings modal                                                      */
    /* ------------------------------------------------------------------ */

    function SettingsModal(props) {
      const { settings, limits, onClose, onSaved, onToast, onWorkflowsChanged, intent, onIntentHandled } = props
      // v3.1.4: opened from the 工作流 tab with a target workflow — jump to the
      // ComfyUI section and open that workflow's parameter editor right away.
      const comfySectionRef = useRef(null)
      const intentHandledRef = useRef('')
      const [baseUrl, setBaseUrl] = useState(str(settings && settings.baseUrl))
      const [models, setModels] = useState(() =>
        (settings && Array.isArray(settings.models) ? settings.models : []).map((model) => ({
          id: model.id,
          label: model.label || model.id,
          dialect: model.dialect || 'auto',
        })),
      )
      const [defaults, setDefaults] = useState(() => ({
        ...zeroParams(),
        ...(settings && settings.defaults ? settings.defaults : {}),
      }))
      const [newKey, setNewKey] = useState('')
      const [clearKey, setClearKey] = useState(false)
      const [showKeyInput, setShowKeyInput] = useState(!(settings && settings.apiKeySet))
      // v1.1: generation timeout exposed in seconds (SafeSettings stores ms).
      const [jobTimeoutSeconds, setJobTimeoutSeconds] = useState(() =>
        String(Math.round(num(settings && settings.jobTimeoutMs, DEFAULT_JOB_TIMEOUT_MS) / 1000)),
      )
      // v1.2: built-in proxy for image upstream requests. `proxyUrl` starts as
      // the MASKED SafeSettings value (may contain ***). We only send a
      // `proxyUrl` in settings.set when the user edited / detected / cleared it
      // (`proxyDirty`), so the masked string is never submitted back.
      const [proxyUrl, setProxyUrl] = useState(() => str(settings && settings.proxyUrl))
      const [proxyDirty, setProxyDirty] = useState(false)
      const [proxyCandidates, setProxyCandidates] = useState([])
      const [detectingProxy, setDetectingProxy] = useState(false)
      // v1.10: first-run auto-detect/auto-apply switch (host-side setting).
      const [proxyAuto, setProxyAuto] = useState(() => !!(settings && settings.proxyAuto))
      // v1.4: local image/save directories. Only changed dirs are submitted.
      const [imageDir, setImageDir] = useState(() => str(settings && settings.imageDir))
      const [saveDir, setSaveDir] = useState(() => str(settings && settings.saveDir))
      const [imageDirDirty, setImageDirDirty] = useState(false)
      const [saveDirDirty, setSaveDirDirty] = useState(false)
      const [pickingDir, setPickingDir] = useState('')
      const [saving, setSaving] = useState(false)
      const [testing, setTesting] = useState(false)
      const [pulling, setPulling] = useState(false)
      const [testResult, setTestResult] = useState(null)
      const [error, setError] = useState('')
      // v1.2: local ComfyUI service + workflow library + param-exposure editor.
      const [comfyUrl, setComfyUrl] = useState(() => str(settings && settings.comfyBaseUrl))
      const [comfyDirty, setComfyDirty] = useState(false)
      const [comfyChecking, setComfyChecking] = useState(false)
      const [comfyStatus, setComfyStatus] = useState(null)
      const [comfyWorkflows, setComfyWorkflows] = useState([])
      const [comfyLoaded, setComfyLoaded] = useState(false)
      const [comfyEditor, setComfyEditor] = useState(null)
      const [comfyPaste, setComfyPaste] = useState('')
      const [showComfyPaste, setShowComfyPaste] = useState(false)
      const [comfyImporting, setComfyImporting] = useState(false)
      const comfyFileRef = useRef(null)

      const maxN = clamp(Math.round(num(limits && limits.maxN, 4)), 1, 4)
      const modelIds = models.map((model) => model.id).filter(Boolean)
      const defaultModelId = modelIds.indexOf(defaults.model) >= 0 ? defaults.model : modelIds[0] || ''
      const defaultsDialect = resolveDialect(defaultModelId, models)

      const updateModel = (index, patch) => {
        setModels((previous) =>
          previous.map((model, modelIndex) => (modelIndex === index ? { ...model, ...patch } : model)),
        )
      }

      const removeModel = (index) => {
        setModels((previous) => previous.filter((_, modelIndex) => modelIndex !== index))
      }

      const addModelRow = () => {
        setModels((previous) => [...previous, { id: '', label: '', dialect: 'auto' }])
      }

      /* ---- v1.2 built-in proxy ---------------------------------------- */

      const updateProxy = (value) => {
        setProxyUrl(value)
        setProxyDirty(true)
        setProxyCandidates([])
      }

      const applyProxyCandidate = (candidate) => {
        if (!candidate || !candidate.url) return
        setProxyUrl(candidate.url)
        setProxyDirty(true)
        setProxyCandidates([])
        onToast('info', `已填入代理：${candidate.url}`)
      }

      const handleClearProxy = () => {
        setProxyUrl('')
        setProxyDirty(true)
        setProxyCandidates([])
      }

      const handleDetectProxy = async () => {
        if (detectingProxy) return
        setDetectingProxy(true)
        setProxyCandidates([])
        setError('')
        try {
          const data = await rpc('proxy.detect')
          const rawCandidates = data && Array.isArray(data.candidates) ? data.candidates : []
          const seen = new Set()
          const candidates = []
          for (const item of rawCandidates) {
            const url = str(item && item.url).trim()
            if (!url || seen.has(url)) continue
            seen.add(url)
            candidates.push({
              url,
              source: str(item && item.source),
              verified: !!(item && item.verified),
              needsAuth: !!(item && item.needsAuth),
            })
          }
          if (candidates.length === 0) {
            onToast('info', '未检测到可用代理（系统代理 / 环境变量 / 本机常见端口），请手动填写')
            return
          }
          if (candidates.length === 1) {
            setProxyUrl(candidates[0].url)
            setProxyDirty(true)
            onToast('success', `已填入检测到的代理：${candidates[0].url}`)
            return
          }
          setProxyCandidates(candidates)
          onToast('info', `检测到 ${candidates.length} 个系统代理，请点击选择`)
        } catch (failure) {
          onToast('error', `检测系统代理失败：${(failure && failure.message) || failure}`)
        } finally {
          setDetectingProxy(false)
        }
      }

      /* ---- v1.4 local directories ------------------------------------- */

      const pickDirectory = async (which) => {
        if (pickingDir) return
        setPickingDir(which)
        setError('')
        try {
          const isImage = which === 'image'
          const data = await rpc('folder.pick', {
            title: isImage ? '选择图片保存目录' : '选择另存为目录',
            initial: (isImage ? imageDir : saveDir).trim() || undefined,
          })
          const picked = str(data && data.path)
          if (!picked) return // user cancelled the folder dialog
          if (isImage) {
            setImageDir(picked)
            setImageDirDirty(true)
          } else {
            setSaveDir(picked)
            setSaveDirDirty(true)
          }
        } catch (failure) {
          onToast('error', `选择目录失败：${(failure && failure.message) || failure}`)
        } finally {
          setPickingDir('')
        }
      }

      const openDirectory = async (which) => {
        const isImage = which === 'image'
        const path = (isImage ? imageDir : saveDir).trim()
        try {
          const data = await rpc('folder.open', path ? { path } : {})
          onToast('info', `已打开目录：${str(data && data.path) || path || '默认目录'}`)
        } catch (failure) {
          onToast('error', `打开目录失败：${(failure && failure.message) || failure}`)
        }
      }

      const resetDirectory = (which) => {
        if (which === 'image') {
          setImageDir('')
          setImageDirDirty(true)
        } else {
          setSaveDir('')
          setSaveDirDirty(true)
        }
      }

      /* ---- v1.2 local ComfyUI ----------------------------------------- */

      const loadComfyWorkflows = async () => {
        try {
          const data = await rpc('comfy.workflow.list')
          setComfyWorkflows(normalizeWorkflowList(data))
        } catch (failure) {
          // The host may be older / still starting: never break settings for it.
          reportLog('warn', `comfy.workflow.list failed: ${(failure && failure.message) || failure}`)
        } finally {
          setComfyLoaded(true)
        }
      }

      useEffect(() => {
        loadComfyWorkflows()
      }, [])

      const updateComfyUrl = (value) => {
        setComfyUrl(value)
        setComfyDirty(true)
        setComfyStatus(null)
      }

      const handleComfyCheck = async () => {
        if (comfyChecking) return
        setComfyChecking(true)
        setComfyStatus(null)
        try {
          if (comfyDirty) onToast('info', '检测使用已保存的服务地址；修改地址后请先保存再检测')
          const data = await rpc('comfy.status')
          const payload = isObj(data) ? data : {}
          const devices = Array.isArray(payload.devices) ? payload.devices : []
          const deviceName = str(devices.length ? devices[0] && devices[0].name : '')
          const version = str(payload.version)
          if (payload.ok) {
            setComfyStatus({
              ok: true,
              text: `已连接${version ? ` ComfyUI ${version}` : ' ComfyUI'}${deviceName ? ` · ${deviceName}` : ''}`,
            })
          } else {
            setComfyStatus({
              ok: false,
              text: `${str(payload.error) || '无法连接 ComfyUI'}${str(payload.baseUrl) ? `（${str(payload.baseUrl)}）` : ''}`,
            })
          }
        } catch (failure) {
          setComfyStatus({ ok: false, text: `检测失败：${(failure && failure.message) || failure}` })
        } finally {
          setComfyChecking(false)
        }
      }

      const readComfyFileText = (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(new Error('读取文件失败'))
          reader.readAsText(file)
        })

      const importComfyText = async (text, sourceName) => {
        const raw = str(text).trim()
        if (!raw) {
          onToast('error', '工作流 JSON 为空')
          return
        }
        let json = null
        try {
          json = JSON.parse(raw)
        } catch (parseError) {
          onToast('error', `JSON 解析失败：${(parseError && parseError.message) || parseError}`)
          return
        }
        if (!isObj(json)) {
          onToast('error', '工作流 JSON 必须是一个对象（API 格式）')
          return
        }
        if (Array.isArray(json.nodes)) {
          onToast(
            'error',
            '请用 ComfyUI 的「保存(API格式)」导出，而不是普通保存的界面格式',
          )
          return
        }
        setComfyImporting(true)
        try {
          // Use the live (possibly unsaved) URL for node metadata when edited.
          const inspectParams = { json }
          const liveBase = comfyDirty ? str(comfyUrl).trim() : ''
          if (liveBase) inspectParams.baseUrl = liveBase
          const inspection = await rpc('comfy.workflow.inspect', inspectParams)
          const defaultName = str(sourceName).replace(/\.json$/i, '').trim()
          const draft = buildComfyEditorDraft({ name: defaultName, json, inspection })
          setComfyEditor(draft)
          setComfyPaste('')
          setShowComfyPaste(false)
          if (draft.warnings.length) onToast('info', `已解析工作流，有 ${draft.warnings.length} 条提示`)
          else onToast('success', `已解析工作流：找到 ${draft.nodes.length} 个节点`)
        } catch (failure) {
          onToast('error', `解析工作流失败：${(failure && failure.message) || failure}`)
        } finally {
          setComfyImporting(false)
        }
      }

      const handleComfyFilePicked = (event) => {
        const files = event && event.target ? Array.from(event.target.files || []) : []
        if (event && event.target) event.target.value = ''
        const file = files[0]
        if (!file) return
        readComfyFileText(file)
          .then((text) => importComfyText(text, file.name))
          .catch((failure) => onToast('error', `读取文件失败：${(failure && failure.message) || failure}`))
      }

      const handleComfyPickFile = () => {
        if (comfyImporting) return
        if (comfyFileRef.current) comfyFileRef.current.click()
      }

      useEffect(() => {
        const workflowId = intent && typeof intent.workflowId === 'string' ? intent.workflowId : ''
        if (!workflowId || intentHandledRef.current === workflowId) return
        intentHandledRef.current = workflowId
        let cancelled = false
        const run = async () => {
          try {
            await openComfyWorkflowEditorRef.current(workflowId)
          } catch {
            // the editor reports its own errors
          }
          if (cancelled) return
          setTimeout(() => {
            const element = comfySectionRef.current
            if (!element) return
            try {
              if (typeof element.scrollIntoView === 'function') {
                element.scrollIntoView({ block: 'start', behavior: 'auto' })
              }
            } catch {
              // ignore
            }
            if (typeof onIntentHandled === 'function') onIntentHandled()
          }, 80)
        }
        void run()
        return () => {
          cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [intent && intent.workflowId])

      const openComfyWorkflowEditorRef = useRef(null)
      const openComfyWorkflowEditor = async (workflowId) => {
        if (comfyImporting) return
        setComfyImporting(true)
        setError('')
        try {
          const data = await rpc('comfy.workflow.get', { id: workflowId })
          const workflow =
            isObj(data) && isObj(data.workflow) ? data.workflow : isObj(data) ? data : null
          if (!workflow || !isObj(workflow.json)) throw new Error('工作流数据为空，可能已被删除')
          const inspectParams = { json: workflow.json }
          const liveBase = comfyDirty ? str(comfyUrl).trim() : ''
          if (liveBase) inspectParams.baseUrl = liveBase
          const inspection = await rpc('comfy.workflow.inspect', inspectParams)
          setComfyEditor(
            buildComfyEditorDraft({
              id: str(workflow.id) || workflowId,
              name: str(workflow.name),
              category: str(workflow.category),
              json: workflow.json,
              existingParams: Array.isArray(workflow.params) ? workflow.params : [],
              inspection,
            }),
          )
        } catch (failure) {
          onToast('error', `读取工作流失败：${(failure && failure.message) || failure}`)
        } finally {
          setComfyImporting(false)
        }
      }

      openComfyWorkflowEditorRef.current = openComfyWorkflowEditor

      const saveComfyWorkflow = async (payload) => {
        const body = {
          name: str(payload && payload.name).trim(),
          category: str(payload && payload.category).trim() || 'image',
          params: Array.isArray(payload && payload.params) ? payload.params : [],
        }
        if (payload && payload.id) body.id = str(payload.id)
        else body.json = payload && payload.json
        const data = await rpc('comfy.workflow.save', body)
        await loadComfyWorkflows()
        if (typeof onWorkflowsChanged === 'function') onWorkflowsChanged()
        onToast('success', payload && payload.id ? '工作流已保存' : '工作流已导入')
        return data
      }

      const handleDeleteComfyWorkflow = async (workflow) => {
        const id = str(workflow && workflow.id)
        if (!id) return
        const name = str(workflow && workflow.name) || '该工作流'
        let confirmed = true
        try {
          confirmed = typeof window.confirm === 'function'
            ? window.confirm(`确定删除工作流「${name}」？此操作不可恢复。`)
            : true
        } catch (confirmError) {
          confirmed = true
        }
        if (!confirmed) return
        try {
          await rpc('comfy.workflow.delete', { id })
          await loadComfyWorkflows()
          if (typeof onWorkflowsChanged === 'function') onWorkflowsChanged()
          onToast('success', `已删除工作流「${name}」`)
        } catch (failure) {
          onToast('error', `删除工作流失败：${(failure && failure.message) || failure}`)
        }
      }

      const handlePullModels = async () => {
        if (pulling) return
        setPulling(true)
        setError('')
        try {
          const data = await rpc('models.list')
          const remote = (data && Array.isArray(data.models) ? data.models : [])
            .filter((model) => isObj(model) && str(model.id).trim())
            .map((model) => ({
              id: str(model.id).trim(),
              label: str(model.label).trim() || str(model.id).trim(),
              dialect: model.dialect === DIALECT.openai || model.dialect === DIALECT.xai ? model.dialect : 'auto',
            }))
          setModels((previous) => {
            const existing = new Set(previous.map((model) => model.id))
            const added = remote.filter((model) => !existing.has(model.id))
            if (!added.length) return previous
            return [...previous.filter((model) => model.id), ...added]
          })
          const addedCount = remote.filter(
            (model) => modelIds.indexOf(model.id) < 0,
          ).length
          if (addedCount > 0) {
            onToast('success', `已从上游拉取 ${addedCount} 个模型（点击保存后生效）`)
          } else {
            onToast('info', '上游模型已全部在列表中')
          }
          if (data && data.warning) onToast('info', data.warning)
        } catch (failure) {
          setError((failure && failure.message) || String(failure))
          onToast('error', `拉取模型失败：${(failure && failure.message) || failure}`)
        } finally {
          setPulling(false)
        }
      }

      const handleTest = async () => {
        if (testing) return
        setTesting(true)
        setTestResult(null)
        setError('')
        try {
          const result = await rpc('provider.test')
          if (result && result.ok) {
            const pieces = ['连接成功']
            if (result.status) pieces.push(`HTTP ${result.status}`)
            if (typeof result.models === 'number') pieces.push(`可用模型 ${result.models} 个`)
            setTestResult({ ok: true, text: pieces.join(' · ') })
          } else {
            setTestResult({
              ok: false,
              text: `连接失败${result && result.status ? `（HTTP ${result.status}）` : ''}：${
                (result && result.error) || '未知错误'
              }`,
            })
          }
        } catch (failure) {
          const text = (failure && failure.message) || String(failure)
          setTestResult({ ok: false, text: `连接失败：${text}` })
        } finally {
          setTesting(false)
        }
      }

      const handleSave = async () => {
        if (saving) return
        // v1.1: validate the generation-timeout input before any network call.
        const rawTimeout = Number(jobTimeoutSeconds)
        const timeoutSeconds = Math.round(rawTimeout)
        if (
          !isFinite(rawTimeout) ||
          !isFinite(timeoutSeconds) ||
          timeoutSeconds < JOB_TIMEOUT_MIN_MS / 1000 ||
          timeoutSeconds > JOB_TIMEOUT_MAX_MS / 1000
        ) {
          const message = '生成超时需为 10–600 之间的整数秒'
          setError(message)
          onToast('error', message)
          return
        }
        // v1.2: proxy validation. Only validate when the user changed it; the
        // masked *** placeholder from SafeSettings must never be resubmitted.
        const trimmedProxy = str(proxyUrl).trim()
        if (proxyDirty) {
          if (trimmedProxy.indexOf('***') >= 0) {
            const message = '代理地址中的 *** 是掩码占位符，请重新填写完整代理地址'
            setError(message)
            onToast('error', message)
            return
          }
          if (trimmedProxy) {
            let parsedProxy = null
            try {
              parsedProxy = new URL(trimmedProxy)
            } catch (error) {
              parsedProxy = null
            }
            if (!parsedProxy || (parsedProxy.protocol !== 'http:' && parsedProxy.protocol !== 'https:')) {
              const message = '代理地址需以 http:// 或 https:// 开头'
              setError(message)
              onToast('error', message)
              return
            }
          }
        }
        // v1.2: ComfyUI service address validation. Empty = not configured.
        const trimmedComfyUrl = str(comfyUrl).trim()
        if (comfyDirty && trimmedComfyUrl) {
          let parsedComfy = null
          try {
            parsedComfy = new URL(trimmedComfyUrl)
          } catch (error) {
            parsedComfy = null
          }
          if (!parsedComfy || (parsedComfy.protocol !== 'http:' && parsedComfy.protocol !== 'https:')) {
            const message = 'ComfyUI 服务地址需以 http:// 或 https:// 开头'
            setError(message)
            onToast('error', message)
            return
          }
        }
        // v1.4: directory validation (empty = host default). Absolute only.
        const trimmedImageDir = str(imageDir).trim()
        const trimmedSaveDir = str(saveDir).trim()
        if (imageDirDirty && !isAbsoluteWindowsPath(trimmedImageDir)) {
          const message = '图片保存目录需为绝对路径（如 D:\\images），留空使用默认目录'
          setError(message)
          onToast('error', message)
          return
        }
        if (saveDirDirty && !isAbsoluteWindowsPath(trimmedSaveDir)) {
          const message = '另存为目录需为绝对路径（如 D:\\exports），留空使用默认目录'
          setError(message)
          onToast('error', message)
          return
        }
        const cleanedModels = []
        const seen = new Set()
        for (const model of models) {
          const id = str(model.id).trim()
          if (!id || seen.has(id)) continue
          seen.add(id)
          cleanedModels.push({
            id,
            label: str(model.label).trim() || id,
            dialect: model.dialect === DIALECT.openai || model.dialect === DIALECT.xai ? model.dialect : 'auto',
          })
        }
        const cleanedDefaults = {
          ...defaults,
          model: cleanedModels.some((model) => model.id === defaults.model)
            ? defaults.model
            : cleanedModels[0]
              ? cleanedModels[0].id
              : '',
          n: clamp(Math.round(num(defaults.n, 1)), 1, maxN),
        }
        const payload = {
          baseUrl: str(baseUrl).trim(),
          models: cleanedModels,
          defaults: cleanedDefaults,
          jobTimeoutMs: timeoutSeconds * 1000,
        }
        if (newKey.trim()) payload.apiKey = newKey.trim()
        if (clearKey) payload.clearApiKey = true
        // v1.2: only submit proxyUrl when the user actually touched it.
        if (proxyDirty) payload.proxyUrl = trimmedProxy
        // v1.10: auto-detect/auto-apply switch is always submitted (boolean).
        payload.proxyAuto = !!proxyAuto
        // v1.4: only submit directory values that changed.
        if (imageDirDirty) payload.imageDir = trimmedImageDir
        if (saveDirDirty) payload.saveDir = trimmedSaveDir
        // v1.2: only submit the ComfyUI address when the user touched it.
        if (comfyDirty) payload.comfyBaseUrl = trimmedComfyUrl

        setSaving(true)
        setError('')
        try {
          const data = await rpc('settings.set', payload)
          if (proxyDirty) {
            onToast('success', trimmedProxy ? '代理已保存，对下一次生成生效' : '已清除代理，将直连')
          } else {
            onToast('success', '设置已保存')
          }
          if (onSaved) onSaved(data)
        } catch (failure) {
          const text = (failure && failure.message) || String(failure)
          setError(text)
          onToast('error', `保存失败：${text}`)
        } finally {
          setSaving(false)
        }
      }

      const keyConfigured = !!(settings && settings.apiKeySet)
      // P2-03/C4: test/pull talk to the host with the SAVED config; flag dirty
      // address/key edits so users are not misled by testing stale settings.
      const dirty =
        str(baseUrl).trim() !== str(settings && settings.baseUrl) ||
        !!newKey.trim() ||
        clearKey

      const renderDirField = (which, label, value, placeholder, isDirty, hint) =>
        h(
          'div',
          { className: 'iw-dir-block' },
          h(
            'div',
            { className: 'iw-dir-head' },
            h('div', { className: 'iw-field-label' }, label),
            h(
              'span',
              { className: 'iw-dir-state' },
              str(value).trim() ? (isDirty ? '待保存' : '自定义') : '默认',
            ),
          ),
          h(
            'div',
            { className: 'iw-dir-row' },
            h('input', {
              className: 'iw-input iw-dir-input',
              value,
              placeholder,
              autoComplete: 'off',
              spellCheck: false,
              onChange: (event) => {
                if (which === 'image') {
                  setImageDir(event.target.value)
                  setImageDirDirty(true)
                } else {
                  setSaveDir(event.target.value)
                  setSaveDirDirty(true)
                }
              },
            }),
            h(
              Btn,
              {
                small: true,
                onClick: () => pickDirectory(which),
                disabled: !!pickingDir || saving,
                title: '选择本地目录',
              },
              pickingDir === which ? h(Spinner, { size: 12 }) : h(Icon, { name: 'folder', size: 12 }),
              pickingDir === which ? '选择中…' : '选择目录',
            ),
            h(
              Btn,
              {
                small: true,
                onClick: () => openDirectory(which),
                disabled: saving,
                title: '在资源管理器中打开该目录',
              },
              h(Icon, { name: 'open', size: 12 }),
              '打开目录',
            ),
            h(
              Btn,
              { small: true, onClick: () => resetDirectory(which), disabled: saving, title: '恢复默认目录' },
              '恢复默认',
            ),
          ),
          hint ? h('div', { className: 'iw-field-hint' }, hint) : null,
        )

      return h(
        Modal,
        {
          title: 'API 设置',
          subtitle: '配置第三方生图服务、模型与默认参数',
          onClose: onClose,
          // v1.2: while the nested ComfyUI param editor is open, Esc must close
          // only the editor (the settings Modal listens on window too).
          closeDisabled: saving || !!comfyEditor,
          width: 640,
          className: 'iw-settings',
          footer: h(
            'div',
            { className: 'iw-modal-foot-row' },
            h(
              'div',
              { className: 'iw-modal-foot-leftcol' },
              h(
                'div',
                { className: 'iw-modal-foot-left' },
                h(
                  Btn,
                  { onClick: handleTest, disabled: testing || saving || dirty, title: dirty ? '请先保存修改后的地址或 Key' : '测试已保存配置的连接' },
                  testing ? h(Spinner, { size: 12 }) : h(Icon, { name: 'check', size: 13 }),
                  testing ? '测试中…' : '测试连接',
                ),
                h(
                  Btn,
                  { onClick: handlePullModels, disabled: pulling || saving || dirty, title: dirty ? '请先保存修改后的地址或 Key' : '从上游拉取模型列表' },
                  pulling ? h(Spinner, { size: 12 }) : h(Icon, { name: 'refresh', size: 13 }),
                  pulling ? '拉取中…' : '从上游拉取模型',
                ),
              ),
              h(
                'div',
                { className: 'iw-foot-hint' },
                '测试连接/拉取模型使用已保存的配置；修改地址或 Key 后请先保存。',
              ),
            ),
            h(
              'div',
              { className: 'iw-modal-foot-right' },
              h(Btn, { onClick: onClose, disabled: saving }, '取消'),
              h(
                Btn,
                { variant: 'primary', onClick: handleSave, disabled: saving },
                saving ? h(Spinner, { size: 12 }) : null,
                saving ? '保存中…' : '保存',
              ),
            ),
          ),
        },
        error ? h('div', { className: 'iw-form-error' }, h(Icon, { name: 'alert', size: 13 }), error) : null,
        testResult
          ? h(
              'div',
              { className: cx('iw-test-result', testResult.ok ? 'ok' : 'fail') },
              h(Icon, { name: testResult.ok ? 'check' : 'alert', size: 13 }),
              testResult.text,
            )
          : null,
        h(
          'div',
          { className: 'iw-settings-section' },
          h('div', { className: 'iw-settings-section-title' }, '服务地址与密钥'),
          h(
            Field,
            {
              label: 'API 地址',
              hint: '填写到 /v1 为止，例如 https://your.site/v1；保存时会自动补全 /v1。',
            },
            h('input', {
              className: 'iw-input',
              value: baseUrl,
              placeholder: 'https://your.site/v1',
              autoComplete: 'off',
              onChange: (event) => setBaseUrl(event.target.value),
            }),
          ),
          h(
            Field,
            { label: 'API Key' },
            keyConfigured && !showKeyInput
              ? h(
                  'div',
                  { className: 'iw-key-row' },
                  h(
                    'span',
                    { className: 'iw-key-hint' },
                    h(Icon, { name: 'check', size: 12 }),
                    `已配置 · ${(settings && settings.apiKeyHint) || 'sk-…'}`,
                  ),
                  clearKey
                    ? h('span', { className: 'iw-key-cleared' }, '保存后清除')
                    : h(
                        'button',
                        {
                          type: 'button',
                          className: 'iw-link-btn',
                          onClick: () => {
                            setShowKeyInput(true)
                            setClearKey(false)
                          },
                        },
                        '更换',
                      ),
                  h(
                    Btn,
                    {
                      variant: clearKey ? 'ghost' : 'danger',
                      small: true,
                      onClick: () => {
                        setClearKey(!clearKey)
                        setNewKey('')
                      },
                    },
                    clearKey ? '取消清除' : '清除',
                  ),
                )
              : h(
                  'div',
                  { className: 'iw-key-row' },
                  h('input', {
                    className: 'iw-input',
                    type: 'password',
                    autoComplete: 'new-password',
                    value: newKey,
                    placeholder: keyConfigured ? '输入新的 API Key（留空则保持不变）' : 'sk-...',
                    onChange: (event) => {
                      setNewKey(event.target.value)
                      if (event.target.value) setClearKey(false)
                    },
                  }),
                  keyConfigured
                    ? h(
                        'button',
                        {
                          type: 'button',
                          className: 'iw-link-btn',
                          onClick: () => {
                            setShowKeyInput(false)
                            setNewKey('')
                          },
                        },
                        '收起',
                      )
                    : null,
                ),
          ),
          settings && settings.envFallback
            ? h(
                'div',
                { className: 'iw-field-hint' },
                '已检测到环境变量 IMAGE_API_BASE / IMAGE_API_KEY，留空时可作为兜底。',
              )
            : null,
        ),
        h(
          'div',
          { className: 'iw-settings-section' },
          h(
            'div',
            { className: 'iw-settings-section-head' },
            h('div', { className: 'iw-settings-section-title' }, '模型列表'),
            h(
              Btn,
              { small: true, onClick: addModelRow, disabled: saving },
              h(Icon, { name: 'plus', size: 12 }),
              '添加模型',
            ),
          ),
          models.length === 0
            ? h(
                'div',
                { className: 'iw-settings-empty' },
                '还没有模型。点击「从上游拉取模型」，或手动添加模型 ID。',
              )
            : h(
                'div',
                { className: 'iw-model-list' },
                models.map((model, index) =>
                  h(
                    'div',
                    { key: `model-${index}`, className: 'iw-model-row' },
                    h('input', {
                      className: 'iw-input iw-model-id',
                      value: model.id,
                      placeholder: '模型 ID，例如 gpt-image-1',
                      onChange: (event) => updateModel(index, { id: event.target.value }),
                    }),
                    h(Select, {
                      className: 'iw-model-dialect',
                      value: model.dialect || 'auto',
                      options: DIALECT_OPTIONS,
                      title: '接口方言',
                      onChange: (value) => updateModel(index, { dialect: value }),
                    }),
                    h(IconButton, {
                      name: 'trash',
                      title: '移除该模型',
                      onClick: () => removeModel(index),
                      disabled: saving,
                    }),
                  ),
                ),
              ),
          h(
            'div',
            { className: 'iw-field-hint' },
            '方言决定调用方式：OpenAI Images 用 size / quality；Grok Imagine 用 aspect_ratio / resolution。',
          ),
        ),
        h(
          'div',
          { className: 'iw-settings-section' },
          h('div', { className: 'iw-settings-section-title' }, '默认参数'),
          h(
            'div',
            { className: 'iw-settings-grid' },
            h(
              Field,
              { label: '默认模型' },
              h(Select, {
                value: defaultModelId,
                options: models
                  .filter((model) => str(model.id).trim())
                  .map((model) => ({ value: str(model.id).trim(), label: model.label || model.id })),
                onChange: (value) => setDefaults((previous) => ({ ...previous, model: value })),
                disabled: modelIds.length === 0,
              }),
            ),
            h(
              Field,
              { label: '默认张数' },
              h(Select, {
                value: String(clamp(Math.round(num(defaults.n, 1)), 1, maxN)),
                options: Array.from({ length: maxN }).map((_, index) => ({
                  value: String(index + 1),
                  label: `${index + 1} 张`,
                })),
                onChange: (value) => setDefaults((previous) => ({ ...previous, n: Number(value) || 1 })),
              }),
            ),
            defaultsDialect === DIALECT.xai
              ? h(
                  Field,
                  { label: '默认比例' },
                  h(Select, {
                    value: defaults.aspectRatio,
                    options: ASPECT_OPTIONS,
                    onChange: (value) => setDefaults((previous) => ({ ...previous, aspectRatio: value })),
                  }),
                )
              : h(
                  Field,
                  { label: '默认尺寸' },
                  h(Select, {
                    value: defaults.size,
                    options: SIZE_OPTIONS,
                    onChange: (value) => setDefaults((previous) => ({ ...previous, size: value })),
                  }),
                ),
            defaultsDialect === DIALECT.xai
              ? h(
                  Field,
                  { label: '默认分辨率' },
                  h(Select, {
                    value: defaults.resolution,
                    options: RESOLUTION_OPTIONS,
                    onChange: (value) => setDefaults((previous) => ({ ...previous, resolution: value })),
                  }),
                )
              : null,
            h(
              Field,
              { label: '默认质量' },
              h(Select, {
                value: defaults.quality,
                options: qualityOptions(defaultsDialect),
                onChange: (value) => setDefaults((previous) => ({ ...previous, quality: value })),
              }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'iw-settings-section' },
          h('div', { className: 'iw-settings-section-title' }, '高级'),
          h(
            Field,
            {
              label: '生成超时（秒）',
              hint: '10–600 秒，默认 300 秒。超过该时长仍未返回的任务会被自动标记失败；运行中的任务也可随时点「取消」。',
            },
            h('input', {
              className: 'iw-input iw-input-number',
              type: 'number',
              min: JOB_TIMEOUT_MIN_MS / 1000,
              max: JOB_TIMEOUT_MAX_MS / 1000,
              step: 1,
              value: jobTimeoutSeconds,
              onChange: (event) => setJobTimeoutSeconds(event.target.value),
            }),
          ),
          h(
            'div',
            { className: 'iw-proxy-block' },
            h(
              'div',
              { className: 'iw-proxy-head' },
              h('div', { className: 'iw-field-label' }, '网络代理'),
              h(
                'span',
                { className: cx('iw-proxy-state', settings && settings.proxySet && 'on') },
                settings && settings.proxySet ? '已配置' : '直连（未设置）',
              ),
            ),
            h(
              'div',
              { className: 'iw-proxy-row' },
              h('input', {
                className: 'iw-input iw-proxy-input',
                value: proxyUrl,
                placeholder: 'http://127.0.0.1:7897',
                autoComplete: 'off',
                spellCheck: false,
                onChange: (event) => updateProxy(event.target.value),
              }),
              h(
                Btn,
                {
                  small: true,
                  onClick: handleDetectProxy,
                  disabled: detectingProxy || saving,
                  title: '扫描系统代理 / 环境变量 / 本机常见代理端口，并做一次 CONNECT 连通验证',
                },
                detectingProxy ? h(Spinner, { size: 12 }) : h(Icon, { name: 'refresh', size: 12 }),
                detectingProxy ? '检测中…' : '检测本机代理',
              ),
              h(
                Btn,
                {
                  small: true,
                  onClick: handleClearProxy,
                  disabled: saving,
                  title: '清空代理地址，保存后恢复直连',
                },
                '清除',
              ),
            ),
            proxyCandidates.length
              ? h(
                  'div',
                  { className: 'iw-proxy-candidates' },
                  h(
                    'div',
                    { className: 'iw-proxy-candidates-title' },
                    `检测到 ${proxyCandidates.length} 个可用代理，点击填入：`,
                  ),
                  proxyCandidates.map((candidate) =>
                    h(
                      'button',
                      {
                        key: candidate.url,
                        type: 'button',
                        className: 'iw-proxy-candidate',
                        title: candidate.url,
                        onClick: () => applyProxyCandidate(candidate),
                      },
                      h(Icon, { name: 'check', size: 11 }),
                      h('span', { className: 'iw-proxy-candidate-url' }, candidate.url),
                      h(
                        'span',
                        { className: 'iw-onboard-tags' },
                        candidate.verified
                          ? h('span', { className: 'iw-tag ok' }, '已连通')
                          : candidate.needsAuth
                            ? h('span', { className: 'iw-tag warn' }, '需认证')
                            : null,
                        candidate.source
                          ? h('span', { className: 'iw-tag' }, proxySourceLabel(candidate.source))
                          : null,
                      ),
                    ),
                  ),
                )
              : null,
            h(
              'div',
              { className: 'iw-field-hint' },
              '仅作用于本插件的生图请求，保存后对下一次生成生效，无需重启；支持 http / https 代理（可带账号密码，保存后掩码显示）；企业 SSL 拦截代理需额外配置证书。留空 = 直连（若 DSH 全局配置了代理，仍会走全局代理）。',
            ),
            h(
              'label',
              { className: 'iw-check-row' },
              h('input', {
                type: 'checkbox',
                checked: proxyAuto,
                disabled: saving,
                onChange: (event) => setProxyAuto(!!event.target.checked),
              }),
              h(
                'span',
                { className: 'iw-check-text' },
                h('span', null, '首次启动时自动配置检测到的本机代理'),
                h(
                  'span',
                  { className: 'iw-field-hint' },
                  '开启后：尚未配置代理时，首次打开工作台会自动使用检测到的可用本地代理（优先已通过连通验证的端口）；关闭则弹出引导由你选择。',
                ),
              ),
            ),
          ),
        ),
        h(
          'div',
          { className: 'iw-settings-section' },
          h('div', { className: 'iw-settings-section-title' }, '本地文件'),
          renderDirField(
            'image',
            '图片保存目录',
            imageDir,
            '留空 = 默认（DSH 数据目录/images）',
            imageDirDirty,
          ),
          renderDirField(
            'save',
            '另存为目录',
            saveDir,
            '留空 = 图片保存目录/exports',
            saveDirDirty,
          ),
          h(
            'div',
            { className: 'iw-field-hint' },
            '修改保存目录仅对新生成图片生效；旧图片仍保留在原路径。「另存为/下载到本地」会复制到另存为目录。',
          ),
        ),
        h(
          'div',
          { className: 'iw-settings-section' },
          h(
            'div',
            { className: 'iw-settings-section-head' },
            h('div', { className: 'iw-settings-section-title' }, '本机 ComfyUI'),
            h(
              'span',
              { className: 'iw-field-hint' },
              comfyWorkflows.length ? `${comfyWorkflows.length} 个工作流` : '工作流模式',
            ),
          ),
          h(
            Field,
            {
              label: '服务地址',
              hint: '本机 ComfyUI 服务地址（不加 /v1）；保存后对下一次生成生效，留空 = 不使用工作流模式。',
            },
            h(
              'div',
              { className: 'iw-proxy-row' },
              h('input', {
                className: 'iw-input iw-proxy-input',
                value: comfyUrl,
                placeholder: 'http://127.0.0.1:8188',
                autoComplete: 'off',
                spellCheck: false,
                onChange: (event) => updateComfyUrl(event.target.value),
              }),
              h(
                Btn,
                {
                  small: true,
                  onClick: handleComfyCheck,
                  disabled: comfyChecking || saving,
                  title: '检测已保存的服务地址是否可连通',
                },
                comfyChecking ? h(Spinner, { size: 12 }) : h(Icon, { name: 'refresh', size: 12 }),
                comfyChecking ? '检测中…' : '检测',
              ),
            ),
          ),
          comfyStatus
            ? h(
                'div',
                { className: cx('iw-test-result', comfyStatus.ok ? 'ok' : 'fail') },
                h(Icon, { name: comfyStatus.ok ? 'check' : 'alert', size: 13 }),
                comfyStatus.text,
              )
            : null,
          renderDirField(
            'image',
            '素材保存目录',
            imageDir,
            '留空 = 默认（DSH 数据目录/images）',
            imageDirDirty,
            '生成的图片（含 ComfyUI 输出）保存到这里；留空使用默认目录。',
          ),
          h(
            'div',
            { className: 'iw-settings-section-head' },
            h(
              'div',
              { className: 'iw-settings-section-title', ref: comfySectionRef },
              '工作流列表',
            ),
            h(
              'div',
              { className: 'iw-modal-foot-right' },
              h(
                Btn,
                {
                  small: true,
                  onClick: handleComfyPickFile,
                  disabled: comfyImporting || saving,
                  title: '导入 ComfyUI「保存(API格式)」导出的工作流 JSON',
                },
                comfyImporting ? h(Spinner, { size: 12 }) : h(Icon, { name: 'plus', size: 12 }),
                comfyImporting ? '解析中…' : '导入工作流',
              ),
              h(
                Btn,
                {
                  small: true,
                  onClick: () => setShowComfyPaste((previous) => !previous),
                  disabled: comfyImporting || saving,
                },
                showComfyPaste ? '收起粘贴' : '粘贴 JSON',
              ),
            ),
          ),
          h('input', {
            ref: comfyFileRef,
            className: 'iw-file-input',
            type: 'file',
            accept: '.json,application/json',
            onChange: handleComfyFilePicked,
          }),
          showComfyPaste
            ? h(
                'div',
                { className: 'iw-comfy-import' },
                h('textarea', {
                  className: 'iw-input iw-comfy-paste',
                  value: comfyPaste,
                  placeholder: '粘贴 ComfyUI「保存(API格式)」导出的工作流 JSON',
                  spellCheck: false,
                  onChange: (event) => setComfyPaste(event.target.value),
                }),
                h(
                  'div',
                  { className: 'iw-modal-foot-right' },
                  h(
                    Btn,
                    {
                      small: true,
                      variant: 'primary',
                      onClick: () => importComfyText(comfyPaste, ''),
                      disabled: comfyImporting || !comfyPaste.trim(),
                    },
                    comfyImporting ? h(Spinner, { size: 12 }) : h(Icon, { name: 'upload', size: 12 }),
                    '解析并编辑参数',
                  ),
                ),
              )
            : null,
          comfyWorkflows.length === 0
            ? h(
                'div',
                { className: 'iw-settings-empty' },
                comfyLoaded
                  ? '还没有工作流。点击「导入工作流」上传 ComfyUI 的 API 格式 JSON。'
                  : '正在读取工作流列表…',
              )
            : h(
                'div',
                null,
                comfyWorkflows.map((workflow) =>
                  h(
                    'div',
                    { key: workflow.id, className: 'iw-comfy-workflow-row' },
                    h(
                      'span',
                      { className: 'iw-comfy-workflow-name', title: workflow.name },
                      workflow.name,
                    ),
                    h('span', { className: 'iw-tag' }, workflowCategoryLabel(workflow.category)),
                    h('span', { className: 'iw-field-hint' }, `${workflow.paramCount} 个参数`),
                    h(
                      'span',
                      { className: 'iw-field-hint', title: fmtDateTime(workflow.updatedAt) },
                      workflow.updatedAt ? fmtRelative(workflow.updatedAt) : '',
                    ),
                    h(
                      Btn,
                      {
                        small: true,
                        onClick: () => openComfyWorkflowEditor(workflow.id),
                        disabled: comfyImporting || saving,
                      },
                      '编辑',
                    ),
                    h(
                      Btn,
                      {
                        small: true,
                        variant: 'danger',
                        onClick: () => handleDeleteComfyWorkflow(workflow),
                        disabled: comfyImporting || saving,
                      },
                      '删除',
                    ),
                  ),
                ),
              ),
          h(
            'div',
            { className: 'iw-field-hint' },
            '仅支持 API 格式（ComfyUI 菜单「保存(API格式)」）；导入后可勾选要暴露到对话框的参数。',
          ),
        ),
        h(
          'div',
          { className: 'iw-settings-note' },
          h(Icon, { name: 'alert', size: 13 }),
          h(
            'span',
            null,
            'API Key 以明文保存在本机 <DSH_HOME>/dsh-creation-workbench/settings.json，仅在本地使用，不会上传、不写入请求日志。',
          ),
        ),
        comfyEditor
          ? h(ComfyParamEditor, {
              draft: comfyEditor,
              onCancel: () => setComfyEditor(null),
              onDone: () => setComfyEditor(null),
              onSave: saveComfyWorkflow,
            })
          : null,
      )
    }

    /* ------------------------------------------------------------------ */
    /* v1.2 ComfyUI parameter-exposure editor (nested modal)               */
    /* ------------------------------------------------------------------ */

    /** Natural order for ComfyUI node ids: 14 < 23:1 < 23:2 < 23:10. */
    function compareComfyNodeId(a, b) {
      const left = String(a || '').split(':')
      const right = String(b || '').split(':')
      const length = Math.max(left.length, right.length)
      for (let index = 0; index < length; index += 1) {
        const leftRaw = left[index]
        const rightRaw = right[index]
        if (leftRaw === undefined) return -1
        if (rightRaw === undefined) return 1
        const leftNum = Number(leftRaw)
        const rightNum = Number(rightRaw)
        const leftIsNum = leftRaw.trim() !== '' && isFinite(leftNum)
        const rightIsNum = rightRaw.trim() !== '' && isFinite(rightNum)
        if (leftIsNum && rightIsNum) {
          if (leftNum !== rightNum) return leftNum - rightNum
          continue
        }
        if (leftIsNum !== rightIsNum) return leftIsNum ? -1 : 1
        const diff = String(leftRaw).localeCompare(String(rightRaw))
        if (diff !== 0) return diff
      }
      return 0
    }

    function ComfyParamEditor(props) {
      const draft = isObj(props.draft) ? props.draft : {}
      const [name, setName] = useState(() => str(draft.name))
      // v2.1: fixed 5 presets + free-form custom category name.
      const initialCategory = str(draft.category) || str(draft.suggestedCategory) || 'image'
      const initialIsPreset = WORKFLOW_CATEGORY_ORDER.indexOf(initialCategory) >= 0
      const [category, setCategory] = useState(initialIsPreset ? initialCategory : '__custom__')
      const [customCategory, setCustomCategory] = useState(initialIsPreset ? '' : initialCategory)
      const categoryOptions = [
        ...WORKFLOW_CATEGORY_ORDER.map((id) => ({
          value: id,
          label: WORKFLOW_CATEGORY_LABELS[id] || id,
        })),
        { value: '__custom__', label: '自定义…' },
      ]
      const [selected, setSelected] = useState(() =>
        isObj(draft.selected) ? { ...draft.selected } : {},
      )
      const [templates, setTemplates] = useState(() =>
        isObj(draft.templates) ? { ...draft.templates } : {},
      )
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [search, setSearch] = useState('')
      const nodes = Array.isArray(draft.nodes) ? draft.nodes : []
      const warnings = Array.isArray(draft.warnings) ? draft.warnings : []
      const outputs = Array.isArray(draft.outputs) ? draft.outputs : []
      const selectedKeys = Object.keys(selected).filter(
        (key) => !!selected[key] && isObj(templates[key]),
      )

      const orderedNodes = nodes.slice().sort((left, right) =>
        compareComfyNodeId(left.nodeId, right.nodeId),
      )
      const outputNodeIds = new Set(
        outputs.map((item) => (isObj(item) ? str(item.nodeId) : '')).filter(Boolean),
      )
      const matchKeyOf = (node, input) => `${node.nodeId}.${input.inputName}`
      const selectedCountOf = (node) =>
        (node.inputs || []).filter((input) => !!selected[matchKeyOf(node, input)]).length
      const query = search.trim().toLowerCase()
      const matchesQuery = (node) => {
        if (!query) return true
        const haystack = [
          str(node.nodeId),
          str(node.title),
          str(node.classType),
          ...(node.inputs || []).map((input) => str(input.inputName)),
        ]
          .join(' ')
          .toLowerCase()
        return haystack.indexOf(query) >= 0
      }
      const [activeNodeId, setActiveNodeId] = useState(() => {
        const firstSelected = nodes.find((node) => selectedCountOf(node) > 0)
        const firstWithInputs = nodes.find((node) => (node.inputs || []).length > 0)
        const fallback = firstSelected || firstWithInputs || nodes[0] || null
        return fallback ? str(fallback.nodeId) : ''
      })
      const visibleNodes = orderedNodes.filter(matchesQuery)
      const activeNode =
        orderedNodes.find((node) => str(node.nodeId) === str(activeNodeId)) ||
        visibleNodes[0] ||
        null

      // v1.2.5: composer display order of the selected params, editable by
      // dragging the preview (or with the ↑↓ buttons). Saved params keep this
      // order, so the composer row renders exactly like the preview.
      const [order, setOrder] = useState(() => {
        const fromDraft = Array.isArray(draft.order) ? draft.order : null
        const keys = fromDraft || Object.keys(isObj(draft.selected) ? draft.selected : {})
        return keys.filter((key) => isObj(templates[key]) && !!selected[key])
      })
      const [dragIndex, setDragIndex] = useState(-1)
      const [dropIndex, setDropIndex] = useState(-1)
      const selectedOrder = order.filter((key) => isObj(templates[key]) && !!selected[key])
      const moveOrder = (from, to) => {
        setOrder((previous) => {
          if (from === to || from < 0 || to < 0) return previous
          if (from >= previous.length || to >= previous.length) return previous
          const next = previous.slice()
          const [item] = next.splice(from, 1)
          next.splice(to, 0, item)
          return next
        })
      }

      // v1.2.2: exactly one exposed text input can be bound to the composer
      // box. The binding is explicit (a selector in the toolbar), so the main
      // prompt always lands in a real workflow input instead of being dropped.
      const textBindings = []
      for (const node of orderedNodes) {
        for (const input of node.inputs || []) {
          const key = matchKeyOf(node, input)
          const tpl = isObj(templates[key]) ? templates[key] : null
          if (!tpl || tpl.type !== 'text') continue
          textBindings.push({
            key,
            nodeId: str(node.nodeId),
            inputName: str(input.inputName),
            nodeTitle: str(node.title) || str(node.classType) || str(node.nodeId),
          })
        }
      }
      const suggestedPromptKey = (() => {
        const suggested = Array.isArray(draft.suggestedParams) ? draft.suggestedParams : []
        const spec = suggested.find((item) => isObj(item) && item.role === 'prompt')
        if (!spec) return ''
        const key = `${str(spec.nodeId)}.${str(spec.inputName)}`
        return isObj(templates[key]) ? key : ''
      })()
      const [promptBinding, setPromptBinding] = useState(() => {
        const bound = textBindings.find(
          (item) => isObj(templates[item.key]) && templates[item.key].role === 'prompt',
        )
        if (bound) return bound.key
        return suggestedPromptKey
      })
      const bindPrompt = (key) => {
        const nextKey = str(key)
        setPromptBinding(nextKey)
        if (nextKey) {
          setSelected((previous) => ({ ...previous, [nextKey]: true }))
          setOrder((previous) => (previous.indexOf(nextKey) >= 0 ? previous : [...previous, nextKey]))
        }
      }

      const selectSuggested = () => {
        const suggested = Array.isArray(draft.suggestedParams) ? draft.suggestedParams : []
        if (!suggested.length) {
          setError('该工作流没有可自动建议的参数，请在左侧节点列表中手动勾选')
          return
        }
        const next = { ...selected }
        const added = []
        for (const spec of suggested) {
          if (!isObj(spec)) continue
          const matchKey = `${str(spec.nodeId)}.${str(spec.inputName)}`
          if (!isObj(templates[matchKey])) continue
          if (/^image$/i.test(str(spec.inputName))) continue
          if (!next[matchKey]) added.push(matchKey)
          next[matchKey] = true
        }
        setSelected(next)
        if (added.length) {
          setOrder((previous) => [...previous, ...added.filter((key) => previous.indexOf(key) < 0)])
        }
        setError('')
      }

      const clearSelected = () => {
        const next = {}
        for (const key of Object.keys(selected)) next[key] = false
        setSelected(next)
        setOrder([])
      }

      /* ---- v3.1: image input slots (LoadImage) --------------------------- */

      const nodeImageInput = (node) =>
        (node && Array.isArray(node.inputs) ? node.inputs : []).find(
          (input) => str(input.inputName) === 'image',
        ) || null

      const isImageSlotNode = (node) =>
        !!node && /loadimage/i.test(str(node.classType)) && !!nodeImageInput(node)

      const slotKeyOf = (node) => `${str(node.nodeId)}.image`

      const isImageSlot = (matchKey) => {
        const tpl = isObj(templates[matchKey]) ? templates[matchKey] : null
        return !!tpl && tpl.type === 'image'
      }

      const clearImageSlotsExcept = (keepKey) => {
        setSelected((previous) => {
          const next = { ...previous }
          for (const key of Object.keys(next)) {
            if (key === keepKey) continue
            if (isImageSlot(key)) next[key] = false
          }
          if (keepKey) next[keepKey] = true
          return next
        })
        setTemplates((previous) => {
          const next = { ...previous }
          for (const key of Object.keys(next)) {
            if (key === keepKey) continue
            if (isImageSlot(key)) {
              next[key] = { ...next[key], type: 'text', role: 'normal' }
            }
          }
          if (keepKey) {
            const current = isObj(next[keepKey]) ? next[keepKey] : {}
            next[keepKey] = {
              ...current,
              type: 'image',
              role: 'image',
              label: str(current.label) || '原图',
            }
          }
          return next
        })
        if (keepKey) {
          setOrder((previous) =>
            previous.indexOf(keepKey) >= 0 ? previous : [...previous, keepKey],
          )
        } else {
          setOrder((previous) => previous.filter((key) => !isImageSlot(key)))
        }
      }

      const toggleImageSlot = (node) => {
        if (busy) return
        const key = slotKeyOf(node)
        if (isImageSlot(key) && selected[key]) {
          setSelected((previous) => ({ ...previous, [key]: false }))
          setTemplates((previous) => ({
            ...previous,
            [key]: { ...(isObj(previous[key]) ? previous[key] : {}), type: 'text', role: 'normal' },
          }))
          setOrder((previous) => previous.filter((item) => item !== key))
          return
        }
        clearImageSlotsExcept(key)
        setError('')
      }

      const toggleParam = (matchKey) => {
        const turningOn = !selected[matchKey]
        setSelected((previous) => ({ ...previous, [matchKey]: !previous[matchKey] }))
        if (turningOn) {
          setOrder((previous) => (previous.indexOf(matchKey) >= 0 ? previous : [...previous, matchKey]))
        } else {
          setOrder((previous) => previous.filter((key) => key !== matchKey))
        }
      }

      const updateTemplate = (matchKey, patch) => {
        setTemplates((previous) => ({
          ...previous,
          [matchKey]: {
            ...(isObj(previous[matchKey]) ? previous[matchKey] : {}),
            ...patch,
          },
        }))
      }

      const optionsOfText = (text) =>
        str(text)
          .split(/[\n,]/)
          .map((item) => item.trim())
          .filter(Boolean)

      const handleSave = async () => {
        if (busy) return
        const trimmedName = name.trim()
        if (!trimmedName) {
          setError('请填写工作流名称')
          return
        }
        if (!selectedKeys.length) {
          setError('至少暴露一个参数')
          return
        }
        // v1.2.2: the explicit prompt binding wins; the bound text input is
        // always saved (and marked role=prompt) even if it was left unchecked.
        const effectivePromptKey =
          promptBinding && isObj(templates[promptBinding]) ? promptBinding : ''
        // v1.2.5: the dragged preview order is the saved order (composer renders
        // params in that order). Any still-selected key missing from the order
        // is appended, and the bound prompt input is always included.
        const ordered = order.filter((key) => isObj(templates[key]) && !!selected[key])
        for (const key of selectedKeys) {
          if (ordered.indexOf(key) < 0) ordered.push(key)
        }
        if (effectivePromptKey && ordered.indexOf(effectivePromptKey) < 0) {
          ordered.push(effectivePromptKey)
        }
        const saveKeys = ordered
        const params = []
        for (const matchKey of saveKeys) {
          const tpl = isObj(templates[matchKey]) ? templates[matchKey] : {}
          const label = str(tpl.label).trim()
          if (!label) {
            setError(`参数 ${matchKey} 的名称不能为空`)
            return
          }
          const type = COMFY_PARAM_TYPES.indexOf(tpl.type) >= 0 ? tpl.type : 'text'
          const optionList = optionsOfText(tpl.optionsText)
          if (type === 'select' && optionList.length < 2) {
            setError(`参数「${label}」的候选值至少需要 2 个（每行一个）`)
            return
          }
          const min = parseComfyNumber(tpl.minText)
          const max = parseComfyNumber(tpl.maxText)
          if (min !== null && max !== null && min >= max) {
            setError(`参数「${label}」的最小值需小于最大值`)
            return
          }
          const numeric = type === 'int' || type === 'float'
          params.push({
            key: str(tpl.key),
            nodeId: str(tpl.nodeId),
            inputName: str(tpl.inputName),
            label,
            type,
            options: type === 'select' ? optionList : [],
            min: numeric ? min : null,
            max: numeric ? max : null,
            step: numeric ? parseComfyNumber(tpl.stepText) : null,
            default: parseComfyDefault(tpl.defaultText, type),
            role: matchKey === effectivePromptKey ? 'prompt' : 'normal',
            randomize: numeric ? !!tpl.randomize : false,
          })
        }
        // Unique keys: keep saved ones (edit flow), assign p_<n> to new rows.
        const used = new Set(params.map((param) => param.key).filter(Boolean))
        let counter = 1
        for (const param of params) {
          if (param.key) continue
          while (used.has(`p_${counter}`)) counter += 1
          param.key = `p_${counter}`
          used.add(param.key)
        }
        setBusy(true)
        setError('')
        try {
          const effectiveCategory =
            category === '__custom__' ? str(customCategory).trim() : str(category)
          if (!effectiveCategory) {
            setError('请填写工作流分类')
            setBusy(false)
            return
          }
          await props.onSave({
            id: str(draft.id),
            json: draft.json,
            name: trimmedName,
            category: effectiveCategory,
            params,
          })
          if (props.onDone) props.onDone()
        } catch (failure) {
          setError((failure && failure.message) || String(failure))
        } finally {
          setBusy(false)
        }
      }

      const renderInputRow = (node, input) => {
        const matchKey = `${node.nodeId}.${input.inputName}`
        const tpl = isObj(templates[matchKey]) ? templates[matchKey] : {}
        const checked = !!selected[matchKey]
        const type = COMFY_PARAM_TYPES.indexOf(tpl.type) >= 0 ? tpl.type : 'text'
        const numeric = type === 'int' || type === 'float'
        const disabled = !checked || busy
        return h(
          'div',
          { key: matchKey, className: 'iw-comfy-input-row' },
          h(
            'label',
            { className: 'iw-param-check', title: `${node.nodeId}.${input.inputName}` },
            h('input', {
              type: 'checkbox',
              checked,
              disabled: busy,
              onChange: () => toggleParam(matchKey),
            }),
            h('span', { className: 'iw-comfy-input-name' }, input.inputName),
          ),
          h('input', {
            className: 'iw-input iw-comfy-input-label',
            value: str(tpl.label),
            placeholder: input.inputName,
            disabled,
            title: '在对话框中显示的参数名',
            onChange: (event) => updateTemplate(matchKey, { label: event.target.value }),
          }),
          h(Select, {
            className: 'iw-param-select',
            value: type,
            options: [
              { value: 'text', label: '文本' },
              { value: 'int', label: '整数' },
              { value: 'float', label: '小数' },
              { value: 'bool', label: '开关' },
              { value: 'select', label: '选项' },
            ],
            disabled,
            title: '参数类型',
            onChange: (value) => updateTemplate(matchKey, { type: value }),
          }),
          numeric
            ? h(
                React.Fragment,
                null,
                h('input', {
                  className: 'iw-input iw-comfy-input-num',
                  type: 'number',
                  value: str(tpl.minText),
                  placeholder: '最小',
                  disabled,
                  title: '最小值',
                  onChange: (event) => updateTemplate(matchKey, { minText: event.target.value }),
                }),
                h('input', {
                  className: 'iw-input iw-comfy-input-num',
                  type: 'number',
                  value: str(tpl.maxText),
                  placeholder: '最大',
                  disabled,
                  title: '最大值',
                  onChange: (event) => updateTemplate(matchKey, { maxText: event.target.value }),
                }),
                h('input', {
                  className: 'iw-input iw-comfy-input-num',
                  type: 'number',
                  value: str(tpl.stepText),
                  placeholder: '步长',
                  disabled,
                  title: '步长',
                  onChange: (event) => updateTemplate(matchKey, { stepText: event.target.value }),
                }),
              )
            : null,
          type === 'select'
            ? h('textarea', {
                className: 'iw-input iw-comfy-options',
                value: str(tpl.optionsText),
                placeholder: '候选值，每行一个（或逗号分隔），至少 2 个',
                disabled,
                spellCheck: false,
                onChange: (event) => updateTemplate(matchKey, { optionsText: event.target.value }),
              })
            : null,
          type === 'bool'
            ? h(Select, {
                className: 'iw-param-select',
                value: str(tpl.defaultText) === 'true' ? 'true' : 'false',
                options: [
                  { value: 'true', label: 'True' },
                  { value: 'false', label: 'False' },
                ],
                disabled,
                title: '默认值',
                onChange: (value) => updateTemplate(matchKey, { defaultText: value }),
              })
            : h('input', {
                className: 'iw-input iw-comfy-input-default',
                type: numeric ? 'number' : 'text',
                value: str(tpl.defaultText),
                placeholder: '默认值',
                disabled,
                title: '默认值',
                onChange: (event) => updateTemplate(matchKey, { defaultText: event.target.value }),
              }),
          promptBinding === matchKey
            ? h(
                'span',
                { className: 'iw-comfy-picker-badge', title: '该参数接收对话框主提示词' },
                '主提示词',
              )
            : null,
          numeric
            ? h(
                'label',
                { className: 'iw-param-check', title: '每次生成随机取值（种子）' },
                h('input', {
                  type: 'checkbox',
                  checked: !!tpl.randomize,
                  disabled,
                  onChange: (event) =>
                    updateTemplate(matchKey, { randomize: !!event.target.checked }),
                }),
                '每次随机',
              )
            : null,
        )
      }

      const renderNodeItem = (node) => {
        const count = selectedCountOf(node)
        const isActive = !!activeNode && str(node.nodeId) === str(activeNode.nodeId)
        const isOutput = outputNodeIds.has(str(node.nodeId))
        return h(
          'button',
          {
            key: node.nodeId,
            type: 'button',
            className: cx('iw-comfy-picker-item', isActive && 'active'),
            title: `节点 ${node.nodeId} · ${node.title || node.classType}`,
            onClick: () => setActiveNodeId(str(node.nodeId)),
          },
          h(
            'span',
            { className: 'iw-comfy-picker-item-title' },
            h(
              'span',
              { className: 'iw-comfy-picker-item-name' },
              node.title || node.classType || '未命名节点',
            ),
            h('span', { className: 'iw-comfy-picker-item-id' }, str(node.nodeId)),
          ),
          h(
            'span',
            { className: 'iw-comfy-picker-item-meta' },
            h('span', null, `${(node.inputs || []).length} 个输入`),
            count ? h('span', { className: 'iw-comfy-picker-badge' }, `已选 ${count}`) : null,
            isOutput ? h('span', { className: 'iw-comfy-picker-badge output' }, '输出') : null,
          ),
        )
      }

      const renderDetail = () => {
        if (!activeNode) {
          return h('div', { className: 'iw-comfy-picker-empty' }, '请选择左侧节点以编辑参数。')
        }
        const isOutput = outputNodeIds.has(str(activeNode.nodeId))
        const head = h(
          'div',
          { key: 'head', className: 'iw-comfy-detail-head' },
          h('span', null, activeNode.title || activeNode.classType || '节点'),
          h('span', { className: 'iw-comfy-node-id' }, `节点 ${activeNode.nodeId}`),
          h('span', { className: 'iw-comfy-node-id' }, activeNode.classType),
          isOutput ? h('span', { className: 'iw-comfy-picker-badge output' }, '输出节点') : null,
        )
        const imageInput = nodeImageInput(activeNode)
        const slotKey = slotKeyOf(activeNode)
        const slotOn = isImageSlotNode(activeNode) && isImageSlot(slotKey) && !!selected[slotKey]
        const imageSlotBlock = isImageSlotNode(activeNode)
          ? h(
              'div',
              { key: 'image-slot', className: 'iw-comfy-image-slot' },
              h(
                'label',
                { className: 'iw-param-check' },
                h('input', {
                  type: 'checkbox',
                  checked: slotOn,
                  disabled: busy,
                  onChange: () => toggleImageSlot(activeNode),
                }),
                h('span', { className: 'iw-comfy-input-name' }, '图像输入（接收对话框的图片）'),
              ),
              h(
                'div',
                { className: 'iw-field-hint' },
                slotOn
                  ? '已启用：对话框的 + 会替换这个 LoadImage，其余 LoadImage 节点在生成时自动静音。'
                  : '勾选后，对话框的 + 可提供一张图片；现在只用 1 个槽。',
              ),
              slotOn
                ? h('input', {
                    className: 'iw-input iw-comfy-input-label',
                    value: str(isObj(templates[slotKey]) ? templates[slotKey].label : ''),
                    placeholder: '原图',
                    disabled: busy,
                    title: '在对话框中显示的参数名',
                    onChange: (event) => updateTemplate(slotKey, { label: event.target.value }),
                  })
                : null,
            )
          : null
        const rows = (activeNode.inputs || [])
          .filter((input) => !(isImageSlotNode(activeNode) && str(input.inputName) === (imageInput ? str(imageInput.inputName) : '')))
          .map((input) => renderInputRow(activeNode, input))
        if (!rows.length) {
          rows.push(
            h(
              'div',
              { key: 'empty', className: 'iw-field-hint' },
              '该节点没有可暴露的标量输入，请在左侧选择其它节点。',
            ),
          )
        }
        return h(React.Fragment, null, head, imageSlotBlock, ...rows)
      }

      // v1.2.5: preview of the composer param row. Drag to reorder (HTML5 DnD),
      // with ↑↓ buttons as a keyboard/no-drag fallback; ✕ unchecks the param.
      const orderTypeLabel = { text: '文本', int: '整数', float: '小数', bool: '开关', select: '选项', image: '图像' }
      const renderOrderChip = (key, index) => {
        const tpl = isObj(templates[key]) ? templates[key] : {}
        const label = str(tpl.label) || str(tpl.inputName) || key
        const typeLabel = orderTypeLabel[tpl.type] || str(tpl.type) || ''
        return h(
          'div',
          {
            key,
            className: cx(
              'iw-comfy-order-item',
              dragIndex === index && 'dragging',
              dropIndex === index && dragIndex !== index && 'drop-target',
            ),
            draggable: !busy,
            title: `${label}（${str(tpl.nodeId)}.${str(tpl.inputName)}）`,
            onDragStart: (event) => {
              setDragIndex(index)
              try {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData('text/plain', key)
              } catch {
                // ignore: drag data is a nicety, the index state is the source
              }
            },
            onDragOver: (event) => {
              event.preventDefault()
              if (dropIndex !== index) setDropIndex(index)
            },
            onDragLeave: () => {
              if (dropIndex === index) setDropIndex(-1)
            },
            onDrop: (event) => {
              event.preventDefault()
              moveOrder(dragIndex, index)
              setDragIndex(-1)
              setDropIndex(-1)
            },
            onDragEnd: () => {
              setDragIndex(-1)
              setDropIndex(-1)
            },
          },
          h('span', { className: 'iw-comfy-order-handle', 'aria-hidden': 'true' }, '⋮⋮'),
          h('span', { className: 'iw-comfy-order-label' }, label),
          typeLabel ? h('span', { className: 'iw-comfy-order-type' }, typeLabel) : null,
          h(
            'button',
            {
              type: 'button',
              className: 'iw-comfy-order-btn',
              title: '上移',
              disabled: busy || index === 0,
              onClick: (event) => {
                event.stopPropagation()
                moveOrder(index, index - 1)
              },
            },
            '↑',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'iw-comfy-order-btn',
              title: '下移',
              disabled: busy || index >= selectedOrder.length - 1,
              onClick: (event) => {
                event.stopPropagation()
                moveOrder(index, index + 1)
              },
            },
            '↓',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'iw-comfy-order-btn iw-comfy-order-remove',
              title: '取消勾选',
              disabled: busy,
              onClick: (event) => {
                event.stopPropagation()
                toggleParam(key)
              },
            },
            '✕',
          ),
        )
      }

      return h(
        Modal,
        {
          title: draft.isNew ? '导入 ComfyUI 工作流（参数暴露）' : '编辑 ComfyUI 工作流（参数暴露）',
          subtitle: `共 ${nodes.length} 个节点 · 已勾选 ${selectedKeys.length} 个参数`,
          onClose: props.onCancel,
          closeDisabled: busy,
          width: 1040,
          className: 'iw-settings',
          footer: h(
            'div',
            { className: 'iw-modal-foot-row' },
            h(
              'div',
              { className: 'iw-modal-foot-leftcol' },
              h(
                'div',
                { className: 'iw-modal-foot-left' },
                h(Btn, { onClick: props.onCancel, disabled: busy }, '取消'),
              ),
              h(
                'div',
                { className: 'iw-foot-hint' },
                '至少暴露一个参数；「主提示词 → 节点」把对话框输入的文字写入所选输入（建议绑定）。',
              ),
            ),
            h(
              'div',
              { className: 'iw-modal-foot-right' },
              h(
                Btn,
                { variant: 'primary', onClick: handleSave, disabled: busy },
                busy ? h(Spinner, { size: 12 }) : null,
                busy ? '保存中…' : '保存工作流',
              ),
            ),
          ),
        },
        error ? h('div', { className: 'iw-form-error' }, h(Icon, { name: 'alert', size: 13 }), error) : null,
        warnings.length
          ? h(
              'div',
              { className: 'iw-settings-note' },
              h(Icon, { name: 'alert', size: 13 }),
              h('span', null, warnings.slice(0, 4).join('；')),
            )
          : null,
        h(
          Field,
          { label: '工作流名称' },
          h('input', {
            className: 'iw-input',
            value: name,
            placeholder: '例如 SDXL 文生图',
            disabled: busy,
            onChange: (event) => setName(event.target.value),
          }),
        ),
        h(
          Field,
          { label: '分类' },
          h(
            'div',
            { className: 'iw-comfy-category-row' },
            h(Select, {
              className: 'iw-param-select',
              value: category,
              options: categoryOptions,
              disabled: busy,
              onChange: (value) => setCategory(value),
            }),
            category === '__custom__'
              ? h('input', {
                  className: 'iw-input',
                  value: customCategory,
                  placeholder: '自定义分类名，例如「3D 场景」',
                  disabled: busy,
                  onChange: (event) => setCustomCategory(event.target.value),
                })
              : null,
          ),
        ),
        h(
          'div',
          { className: 'iw-comfy-toolbar' },
          h('input', {
            className: 'iw-input iw-comfy-search',
            value: search,
            placeholder: '搜索节点 / 参数名',
            spellCheck: false,
            disabled: busy,
            onChange: (event) => setSearch(event.target.value),
          }),
          h(Select, {
            className: 'iw-comfy-prompt-bind',
            value: promptBinding,
            options: [
              { value: '', label: '主提示词：不绑定输入框' },
              ...(promptBinding && !textBindings.some((item) => item.key === promptBinding)
                ? [{ value: promptBinding, label: `主提示词 → ${promptBinding}` }]
                : []),
              ...textBindings.map((item) => ({
                value: item.key,
                label: `主提示词 → 节点 ${item.nodeId} ${item.inputName}`,
              })),
            ],
            disabled: busy,
            title: '对话框输入框的文字将写入所选文本输入；不绑定则输入框文字不会写入工作流',
            onChange: (value) => bindPrompt(value),
          }),
          h(
            Btn,
            {
              small: true,
              onClick: selectSuggested,
              disabled: busy,
              title: '勾选系统建议的参数（提示词、种子、步数等）',
            },
            h(Icon, { name: 'spark', size: 12 }),
            '全选建议参数',
          ),
          h(Btn, { small: true, onClick: clearSelected, disabled: busy }, '清空已勾选'),
          h('span', { className: 'iw-field-hint' }, `已勾选 ${selectedKeys.length} 个参数`),
        ),
        h(
          'div',
          { className: 'iw-comfy-order' },
          h(
            'div',
            { className: 'iw-comfy-order-head' },
            h('span', { className: 'iw-comfy-order-title' }, '对话框参数顺序'),
            h('span', { className: 'iw-field-hint' }, '拖动排序（或点 ↑↓）；保存后对话框按此顺序显示'),
          ),
          selectedOrder.length
            ? h('div', { className: 'iw-comfy-order-list' }, selectedOrder.map(renderOrderChip))
            : h(
                'div',
                { className: 'iw-field-hint' },
                '勾选参数后会出现在这里，可拖动调整它们在对话框中的显示顺序。',
              ),
        ),
        nodes.length
          ? h(
              'div',
              { className: 'iw-comfy-picker' },
              h(
                'div',
                { className: 'iw-comfy-picker-list' },
                visibleNodes.length
                  ? visibleNodes.map(renderNodeItem)
                  : h('div', { className: 'iw-comfy-picker-empty' }, '没有匹配的节点，试试清空搜索。'),
              ),
              h('div', { className: 'iw-comfy-picker-detail' }, renderDetail()),
            )
          : h(
              'div',
              { className: 'iw-field-hint' },
              '未解析到任何节点，请检查工作流 JSON 是否为 API 格式。',
            ),
        selectedKeys.length === 0
          ? h(
              'div',
              { className: 'iw-field-hint' },
              '尚未勾选任何参数：左侧选择节点，在右侧勾选要暴露的输入即可。',
            )
          : null,
      )
    }

