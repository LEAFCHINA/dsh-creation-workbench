    /* ------------------------------------------------------------------ */
    /* Canvas: infinite vertical flow of turns (5-column preview grid)     */
    /* ------------------------------------------------------------------ */

    function ImageCard(props) {
      const { image, turn, index, count, onOpen, onAddRef, onDelete, onOpenFile, deleting } = props
      const [confirmDelete, setConfirmDelete] = useState(false)
      const timerRef = useRef(null)

      useEffect(() => {
        return () => {
          if (timerRef.current) clearTimeout(timerRef.current)
        }
      }, [])

      const handleDelete = (event) => {
        event.stopPropagation()
        if (deleting) return
        if (confirmDelete) {
          if (timerRef.current) clearTimeout(timerRef.current)
          setConfirmDelete(false)
          onDelete(image, turn)
          return
        }
        setConfirmDelete(true)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setConfirmDelete(false), 3000)
      }

      const footerText =
        count > 1 ? `第 ${index + 1}/${count} 张` : truncate(turn.prompt || image.prompt || '', 46)

      return h(
        'div',
        {
          className: 'iw-card',
          onClick: () => onOpen && onOpen(image, turn),
          title: count > 1 ? `第 ${index + 1}/${count} 张 · 点击查看详情` : '点击查看详情',
        },
        h(
          'div',
          { className: 'iw-thumb' },
          h(ThumbImage, { src: imageSrc(image), alt: footerText }),
          h(
            'div',
            { className: 'iw-card-actions' },
            // v1.4: open the LOCAL file with the system default program.
            image.localPath
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'iw-card-btn',
                    title: '打开文件（本地）',
                    onMouseDown: (event) => event.stopPropagation(),
                    onClick: (event) => {
                      event.stopPropagation()
                      if (onOpenFile) onOpenFile(image)
                    },
                  },
                  h(Icon, { name: 'open', size: 13 }),
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: cx('iw-card-btn', confirmDelete && 'confirm'),
                title: confirmDelete ? '再次点击确认删除' : '删除图片',
                disabled: !!deleting,
                onClick: handleDelete,
                onMouseDown: (event) => event.stopPropagation(),
              },
              confirmDelete
                ? [h(Icon, { key: 'i', name: 'trash', size: 12 }), h('span', { key: 't' }, '确认删除')]
                : h(Icon, { name: 'trash', size: 13 }),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'iw-card-btn',
                title: '加入输入框作为参考图',
                onMouseDown: (event) => event.stopPropagation(),
                onClick: (event) => {
                  event.stopPropagation()
                  if (onAddRef) onAddRef(image, turn)
                },
              },
              h(Icon, { name: 'plus', size: 14 }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'iw-card-foot' },
          h('span', { className: 'iw-card-label', title: turn.prompt || image.prompt || undefined }, footerText),
          count > 1
            ? h(
                'span',
                { className: 'iw-card-meta' },
                fmtClock(image.createdAt || turn.createdAt),
              )
            : null,
        ),
      )
    }

    /**
     * v1.1: count-up elapsed / timeout hint for a running turn. Owns its 1s
     * interval so the parent tree does not re-render every second; the timer is
     * cleared on unmount (terminal status unmounts the skeleton/group head).
     */
    function RunningElapsed(props) {
      const rawTimeout = num(props.timeoutMs, DEFAULT_JOB_TIMEOUT_MS)
      const hasLimit = rawTimeout > 0
      const timeoutSeconds = hasLimit
        ? Math.round(
            clamp(Math.round(rawTimeout), JOB_TIMEOUT_MIN_MS, JOB_TIMEOUT_MAX_MS) / 1000,
          )
        : 0
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [])
      const startedAt = Date.parse(str(props.startedAt))
      const elapsed = isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
      return h(
        'span',
        {
          className: cx('iw-elapsed', props.className),
          title: hasLimit
            ? `已用 ${elapsed} 秒，生成超时上限 ${timeoutSeconds} 秒（可在设置中调整）`
            : `已用 ${elapsed} 秒（本地 ComfyUI 任务不设超时，可手动取消）`,
        },
        hasLimit ? `已用 ${elapsed}s · ${timeoutSeconds}s 超时` : `已用 ${elapsed}s`,
      )
    }

    function SkeletonCard(props) {
      const { index, count, progressText, onCancel, startedAt, timeoutMs, queued } = props
      const showCancel = typeof onCancel === 'function'
      return h(
        'div',
        {
          className: 'iw-card iw-card-skel',
          title: queued ? '排队中' : '正在生成',
        },
        h(
          'div',
          { className: 'iw-thumb iw-skel' },
          h(
            'div',
            { className: 'iw-skel-center' },
            h(Spinner, { size: 16 }),
            h('span', null, queued ? '排队中…' : '生成中…'),
            progressText ? h('span', { className: 'iw-skel-pct' }, progressText) : null,
            !queued && startedAt
              ? h(RunningElapsed, { startedAt, timeoutMs, className: 'iw-skel-elapsed' })
              : null,
          ),
          showCancel
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'iw-skel-stop',
                  title: '取消生成',
                  onMouseDown: (event) => event.stopPropagation(),
                  onClick: (event) => {
                    event.stopPropagation()
                    onCancel()
                  },
                },
                h(Icon, { name: 'stop', size: 12 }),
              )
            : null,
        ),
        h(
          'div',
          { className: 'iw-card-foot' },
          h(
            'span',
            { className: 'iw-card-label' },
            count > 1
              ? `第 ${index + 1}/${count} 张 · ${queued ? '排队中' : '生成中'}`
              : queued
                ? '排队中'
                : '生成中',
          ),
        ),
      )
    }

    function ErrorTurnCard(props) {
      const { turn, onRetry, onDeleteTurn, onOpenSettings, models, settings } = props
      const cancelled = turn.status === 'cancelled'
      const model = (turn.params && turn.params.model) || ''
      // v1.3: error/cancelled turns render as ONE normal grid cell (4:3 face,
      // same footprint as an image card) inside the continuous single flow.
      // Failed batches (n>1) also render exactly this one cell — never a group.
      const apiReady = !!(settings && settings.apiKeySet && settings.baseUrl)
      const [confirmDelete, setConfirmDelete] = useState(false)
      const confirmTimerRef = useRef(null)
      useEffect(() => {
        return () => {
          if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
        }
      }, [])
      const handleDelete = () => {
        if (confirmDelete) {
          if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
          setConfirmDelete(false)
          if (typeof onDeleteTurn === 'function') onDeleteTurn(turn)
          return
        }
        setConfirmDelete(true)
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
        confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000)
      }
      const errorText =
        turn.error || (cancelled ? '本次生成已被取消。' : '上游服务没有返回图片。')
      const metaParts = []
      if (model) metaParts.push(modelLabel(model, models))
      if (turn.createdAt) metaParts.push(fmtDateTime(turn.createdAt))
      return h(
        'section',
        {
          className: cx('iw-error-card', cancelled && 'is-cancelled'),
          title: turn.prompt || undefined,
        },
        h(
          'div',
          { className: 'iw-error-face' },
          h(
            'div',
            { className: 'iw-error-icon' },
            h(Icon, { name: cancelled ? 'stop' : 'alert', size: 18 }),
          ),
          h('div', { className: 'iw-error-title' }, cancelled ? '生成已取消' : '生成失败'),
          h(
            'div',
            { className: 'iw-error-summary', title: errorText },
            errorText,
          ),
        ),
        h(
          'div',
          { className: 'iw-error-foot' },
          h(
            'span',
            { className: 'iw-error-meta', title: metaParts.join(' · ') || undefined },
            metaParts.join(' · ') || '生成记录',
          ),
          h(
            'span',
            { className: 'iw-error-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'iw-error-action',
                title: '使用相同提示词与参数重新生成',
                onClick: () => onRetry(turn),
              },
              h(Icon, { name: 'refresh', size: 11 }),
              '重试',
            ),
            h(
              'button',
              {
                type: 'button',
                className: cx('iw-error-action', confirmDelete ? 'danger-confirm' : 'danger'),
                title: confirmDelete ? '再次点击确认删除该记录' : '删除该生成记录',
                onClick: handleDelete,
              },
              h(Icon, { name: 'trash', size: 11 }),
              confirmDelete ? '确认删除' : '删除',
            ),
            !apiReady || !models.length
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'iw-error-action',
                    title: '打开 API 设置',
                    onClick: onOpenSettings,
                  },
                  '设置',
                )
              : null,
          ),
        ),
      )
    }

    function GroupBlock(props) {
      const {
        turn,
        groupNo,
        job,
        onOpen,
        onAddRef,
        onDelete,
        onOpenFile,
        onCancelJob,
        onAbortTurn,
        deletingImageId,
        models,
        timeoutMs,
      } = props
      const running = turn.status === 'running'
      const requested = requestedCount(turn)
      const images = Array.isArray(turn.images) ? turn.images : []
      const count = running ? requested : images.length
      const progress = job ? clamp(num(job.progress, 0), 0, 1) : 0
      const model = (turn.params && turn.params.model) || ''
      // v1.2.7: a task waiting behind another one shows "排队中" and only starts
      // its timer when it actually executes (host startedAt); local ComfyUI
      // tasks have no timeout cap.
      const queued = running && !!job && (job.status === 'queued' || job.stage === 'queued')
      const timerStart = job && job.startedAt ? job.startedAt : turn.createdAt
      const timerTimeout = isComfyModel(model) ? 0 : timeoutMs
      const queueText =
        job && typeof job.queuePosition === 'number' && job.queuePosition > 0
          ? `排队第 ${job.queuePosition} 位`
          : '排队中'
      const badgeText = running ? `生成中 · ${count} 张` : `批量生成 · ${count} 张`
      const metaParts = []
      if (model) metaParts.push(modelLabel(model, models))
      if (turn.createdAt) metaParts.push(fmtRelative(turn.createdAt))
      if (turn.finishedAt && turn.createdAt) {
        const duration = Date.parse(turn.finishedAt) - Date.parse(turn.createdAt)
        const text = fmtDuration(duration)
        if (text) metaParts.push(`耗时 ${text}`)
      }
      // v1.1: a running turn can always be stopped. Prefer job.cancel while a
      // jobId is known; fall back to turn.abort for orphan turns without one.
      const cancelHandler = () => {
        if (job && job.jobId) onCancelJob(job.jobId)
        else if (turn.jobId) onCancelJob(turn.jobId)
        else if (typeof onAbortTurn === 'function') onAbortTurn(turn)
      }
      const runningProgressText = job
        ? jobProgressText(job)
        : turn.jobId
          ? '正在恢复生成进度…'
          : '等待上游响应…'
      return h(
        'section',
        { className: cx('iw-group', running && 'is-running') },
        h(
          'div',
          { className: 'iw-group-head' },
          h('span', { className: 'iw-group-num' }, pad2(groupNo)),
          h('span', { className: 'iw-group-badge' }, h(Icon, { name: running ? 'spark' : 'image', size: 11 }), badgeText),
          h('span', { className: 'iw-group-prompt', title: turn.prompt }, truncate(turn.prompt, 90)),
          h('span', { className: 'iw-group-meta' }, metaParts.join(' · ')),
          running
            ? queued
              ? h('span', { className: 'iw-group-elapsed' }, queueText)
              : h(RunningElapsed, {
                  startedAt: timerStart,
                  timeoutMs: timerTimeout,
                  className: 'iw-group-elapsed',
                })
            : null,
          running
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'iw-group-cancel',
                  title: '取消本次生成',
                  onClick: cancelHandler,
                },
                h(Icon, { name: 'stop', size: 11 }),
                '取消',
              )
            : null,
        ),
        running
          ? h(
              'div',
              { className: 'iw-group-progress' },
              h('span', { className: 'iw-group-progress-bar', style: { width: `${Math.round(progress * 100)}%` } }),
            )
          : null,
        h(
          'div',
          { className: 'iw-grid' },
          running
            ? Array.from({ length: Math.min(count, 8) }).map((_, index) =>
                h(SkeletonCard, {
                  key: `skel-${index}`,
                  index,
                  count,
                  progressText: runningProgressText,
                  startedAt: timerStart,
                  timeoutMs: timerTimeout,
                  queued,
                }),
              )
            : images.map((image, index) =>
                h(ImageCard, {
                  key: image.id,
                  image,
                  turn,
                  index,
                  count: images.length,
                  onOpen,
                  onAddRef,
                  onDelete,
                  onOpenFile,
                  deleting: deletingImageId === image.id,
                }),
              ),
        ),
      )
    }

    function Canvas(props) {
      const {
        conversation,
        conversationLoading,
        activeWorkspace,
        home,
        models,
        settings,
        jobs,
        deletingImageId,
        onOpenImage,
        onAddRef,
        onDeleteImage,
        onDeleteTurn,
        onOpenFile,
        onCancelJob,
        onAbortTurn,
        onRetryTurn,
        onNewWorkspace,
        onNewConversation,
        onOpenSettings,
        timeoutMs,
      } = props

      const scrollRef = useRef(null)
      const nearBottomRef = useRef(true)
      const previousConversationRef = useRef('')
      const turns = conversation && Array.isArray(conversation.turns) ? conversation.turns : []

      const jobByTurn = {}
      for (const job of Array.isArray(jobs) ? jobs : []) {
        if (job && job.turnId) jobByTurn[job.turnId] = job
      }

      const signature = turns
        .map(
          (turn) =>
            `${turn.id}:${turn.status}:${(turn.images || []).length}:${
              jobByTurn[turn.id] ? Math.round(clamp(num(jobByTurn[turn.id].progress, 0), 0, 1) * 10) : ''
            }`,
        )
        .join('|')

      useEffect(() => {
        const element = scrollRef.current
        if (!element) return
        const conversationId = conversation ? conversation.id : ''
        const changed = conversationId !== previousConversationRef.current
        previousConversationRef.current = conversationId
        if (changed || nearBottomRef.current) {
          element.scrollTop = element.scrollHeight
          nearBottomRef.current = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [signature, conversation && conversation.id, conversationLoading])

      const handleScroll = (event) => {
        const element = event.currentTarget
        const distance = element.scrollHeight - element.scrollTop - element.clientHeight
        nearBottomRef.current = distance < NEAR_BOTTOM_PX
      }

      let content = null
      if (!activeWorkspace) {
        content = h(
          'div',
          { className: 'iw-canvas-empty' },
          h(EmptyState, {
            icon: 'folder',
            title: '还没有工作区',
            desc: '先新建一个工作区，再在会话里生成图片。',
            cta: '新建工作区',
            onCta: onNewWorkspace,
          }),
        )
      } else if (!conversation) {
        content = h(
          'div',
          { className: 'iw-canvas-empty' },
          conversationLoading
            ? h(
                'div',
                { className: 'iw-canvas-loading' },
                h(Spinner, { size: 18 }),
                h('span', null, '正在加载会话…'),
              )
            : home
              ? h('div', { className: 'iw-canvas-home' }, home)
              : h(EmptyState, {
                icon: 'message',
                title: '这个工作区还没有打开的会话',
                desc: '新建一个会话，或从左侧选择一个已有会话。',
                cta: '新建会话',
                onCta: () => onNewConversation(activeWorkspace.id),
              }),
        )
      } else if (turns.length === 0) {
        content = home
          ? h('div', { className: 'iw-canvas-home' }, home)
          : h(
            'div',
            { className: 'iw-canvas-hint' },
            h(Icon, { name: 'spark', size: 18 }),
            h('div', { className: 'iw-canvas-hint-title' }, '开始第一张生成'),
            h(
              'div',
              { className: 'iw-canvas-hint-desc' },
              '在下方输入画面描述，按 Enter 发送。生成的图片会按时间顺序排列在这里。',
            ),
          )
      } else {
        let groupNo = 0
        const nodes = []
        // P3-03: consecutive single-image turns are collected into one
        // full-width `.iw-single-grid` wrapper (still a strict 5-column grid),
        // so inserting a full-width group/error block never leaves empty cells
        // behind in the previous main-grid row.
        let singleCells = []
        let singleKey = ''
        let singlesNo = 0
        const addSingle = (turnId, cell) => {
          if (!singleCells.length) {
            singlesNo += 1
            singleKey = `singles-${singlesNo}-${turnId}`
          }
          singleCells.push(cell)
        }
        const flushSingles = () => {
          if (!singleCells.length) return
          nodes.push(h('div', { key: singleKey, className: 'iw-single-grid' }, singleCells))
          singleCells = []
          singleKey = ''
        }
        const errorCard = (turn, key) =>
          h(ErrorTurnCard, {
            key,
            turn,
            onRetry: onRetryTurn,
            onDeleteTurn,
            models,
            settings,
            onOpenSettings,
          })

        for (const turn of turns) {
          const images = Array.isArray(turn.images) ? turn.images : []
          if (turn.status === 'running') {
            if (isBatchTurn(turn)) {
              flushSingles()
              groupNo += 1
              nodes.push(
                h(GroupBlock, {
                  key: `group-${turn.id}`,
                  turn,
                  groupNo,
                  job: jobByTurn[turn.id] || null,
                  onOpen: onOpenImage,
                  onAddRef,
                  onDelete: onDeleteImage,
                  onOpenFile,
                  onCancelJob,
                  onAbortTurn,
                  deletingImageId,
                  models,
                  timeoutMs,
                }),
              )
            } else {
              const job = jobByTurn[turn.id] || null
              const cancelJobId = job && job.jobId ? job.jobId : turn.jobId
              const singleModel = (turn.params && turn.params.model) || ''
              const singleQueued = !!job && (job.status === 'queued' || job.stage === 'queued')
              addSingle(
                turn.id,
                h(
                  'div',
                  { key: `running-${turn.id}`, className: 'iw-card-wrap' },
                  h(SkeletonCard, {
                    index: 0,
                    count: 1,
                    progressText: job
                      ? jobProgressText(job)
                      : turn.jobId
                        ? '正在恢复生成进度…'
                        : '等待上游响应…',
                    startedAt: job && job.startedAt ? job.startedAt : turn.createdAt,
                    timeoutMs: isComfyModel(singleModel) ? 0 : timeoutMs,
                    queued: singleQueued,
                    onCancel: cancelJobId
                      ? () => onCancelJob(cancelJobId)
                      : () => onAbortTurn(turn),
                  }),
                ),
              )
            }
            continue
          }
          if (turn.status === 'error' || turn.status === 'cancelled') {
            // v1.3: failures join the continuous single-image flow as ONE cell
            // (no full-width break, no group container even for failed batches).
            addSingle(turn.id, errorCard(turn, `error-${turn.id}`))
            continue
          }
          if (images.length >= 2) {
            flushSingles()
            groupNo += 1
            nodes.push(
              h(GroupBlock, {
                key: `group-${turn.id}`,
                turn,
                groupNo,
                job: null,
                onOpen: onOpenImage,
                onAddRef,
                onDelete: onDeleteImage,
                onOpenFile,
                onCancelJob,
                deletingImageId,
                models,
              }),
            )
            continue
          }
          if (images.length === 1) {
            addSingle(
              turn.id,
              h(ImageCard, {
                key: `image-${images[0].id}`,
                image: images[0],
                turn,
                index: 0,
                count: 1,
                onOpen: onOpenImage,
                onAddRef,
                onDelete: onDeleteImage,
                onOpenFile,
                deleting: deletingImageId === images[0].id,
              }),
            )
            continue
          }
          addSingle(
            turn.id,
            errorCard(
              { ...turn, status: 'error', error: turn.error || '生成完成但没有返回图片，请重试。' },
              `empty-${turn.id}`,
            ),
          )
        }
        flushSingles()
        content = nodes
      }

      return h(
        'div',
        { className: 'iw-canvas', ref: scrollRef, onScroll: handleScroll },
        h(
          'div',
          { className: 'iw-canvas-inner' },
          h(
            'div',
            { className: 'iw-canvas-caption' },
            conversation
              ? h(
                  React.Fragment,
                  null,
                  h('span', { className: 'iw-canvas-caption-title' }, conversation.title || '新会话'),
                  h(
                    'span',
                    { className: 'iw-canvas-caption-meta' },
                    `${turns.length} 次生成 · ${turns.reduce((sum, turn) => sum + (Array.isArray(turn.images) ? turn.images.length : 0), 0)} 张图片`,
                  ),
                )
              : null,
          ),
          content,
        ),
      )
    }

    /**
     * v2.7: agent chat conversation view (real workspace conversation).
     */
    function AgentChatCanvas(props) {
      const conversation = props.conversation || null
      const messages = conversation && Array.isArray(conversation.messages) ? conversation.messages : []
      const scrollRef = useRef(null)
      const [selection, setSelection] = useState('')

      useEffect(() => {
        const element = scrollRef.current
        if (!element) return
        element.scrollTop = element.scrollHeight
      }, [messages.length, conversation && conversation.id, props.sending])

      const capture = () => {
        try {
          const selected = String(window.getSelection ? window.getSelection().toString() : '').trim()
          setSelection(selected)
        } catch (error) {
          setSelection('')
        }
      }

      return h(
        'div',
        { className: 'iw-canvas iw-agent-chat' },
        h(
          'div',
          { className: 'iw-canvas-inner iw-agent-chat-inner' },
          h(
            'div',
            { className: 'iw-agent-chat-head' },
            h(Icon, { name: 'spark', size: 13 }),
            h(
              'span',
              { className: 'iw-agent-chat-title' },
              str(conversation && conversation.meta && conversation.meta.templateName) || 'Agent 会话',
            ),
            h('span', { className: 'iw-agent-drawer-badge' }, 'Agent 会话'),
            props.dshLink && props.dshLink.ok
              ? h(
                  'span',
                  {
                    className: 'iw-agent-link',
                    title:
                      '已在 DSH 工作区「' +
                      '创作工作台临时会话' +
                      '」关联会话：' +
                      String(props.dshLink.sessionId || '') +
                      (props.dshLink.reusable ? '（复用已有）' : '（新建）'),
                  },
                  '已关联 DSH 会话',
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'iw-agent-mini',
                title: '清空这段会话的消息（不影响模板）',
                onClick: props.onClear,
              },
              '清空消息',
            ),
          ),
          messages.length === 0
            ? h(
                'div',
                { className: 'iw-agent-empty' },
                h(Icon, { name: 'spark', size: 22 }),
                h('div', null, '这个 Agent 会话还没有消息。'),
                h(
                  'div',
                  { className: 'iw-agent-empty-sub' },
                  '在下方输入想法或粘贴图片，发送后会按对话记录；历史会保存，下次打开还在。',
                ),
              )
            : h(
                'div',
                { className: 'iw-agent-chat-body', ref: scrollRef, onMouseUp: capture },
                messages.map((message) =>
                  message.role === 'user'
                    ? h(
                        'div',
                        { key: message.id, className: 'iw-agent-msg iw-agent-msg-user' },
                        h('div', { className: 'iw-agent-bubble' }, message.text),
                      )
                    : h(
                        'div',
                        { key: message.id, className: 'iw-agent-msg iw-agent-msg-bot' },
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
                            '送入输入框',
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
                                Math.round(message.elapsedMs / 1000) + 's · ' + message.text.length + ' 字',
                              )
                            : null,
                        ),
                      ),
                ),
                props.sending
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
              ),
          selection
            ? h(
                'div',
                { className: 'iw-agent-selection' },
                h('span', null, '已选中 ' + selection.length + ' 字'),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'iw-btn iw-btn-primary iw-btn-sm',
                    onClick: () => props.onInsert(selection),
                  },
                  '送入输入框',
                ),
                h(
                  'button',
                  { type: 'button', className: 'iw-btn iw-btn-sm', onClick: () => setSelection('') },
                  '取消选择',
                ),
              )
            : null,
        ),
      )
    }
