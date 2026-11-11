    /* ------------------------------------------------------------------ */
    /* Detail overlay: right 3/4 large image, left 1/4 info column         */
    /* ------------------------------------------------------------------ */

    function DetailOverlay(props) {
      const {
        image,
        turn,
        onClose,
        onAddRef,
        onDelete,
        onOpenFile,
        onRevealFile,
        onSaveAs,
        onInpaint,
        deleting,
        onToast,
      } = props
      const hasLocalPath = !!str(image && image.localPath)
      const [previewIndex, setPreviewIndex] = useState(-1)
      const [previewMask, setPreviewMask] = useState(false)
      const [confirmDelete, setConfirmDelete] = useState(false)
      const [copied, setCopied] = useState(false)
      // P3-02: copy feedback and delete confirmation must not share a timer,
      // otherwise copying then deleting leaves「已复制」stuck forever.
      const copyTimerRef = useRef(null)
      const confirmTimerRef = useRef(null)

      const refs = image && Array.isArray(image.refs) && image.refs.length
        ? image.refs
        : turn && Array.isArray(turn.refs)
          ? turn.refs
          : []
      const params =
        image && image.params && image.params.model
          ? image.params
          : turn && turn.params
            ? turn.params
            : zeroParams()
      const prompt = (image && image.prompt) || (turn && turn.prompt) || imageSrc(image)
      const modelId = (image && image.model) || params.model || ''
      const paramDialect = resolveDialect(modelId, props.models || [])
      const createdAt = (image && image.createdAt) || (turn && turn.createdAt) || ''
      // v1.4 §C: inpainted turns may carry the uploaded mask metadata.
      const maskMeta = turn && turn.mask ? turn.mask : null
      const showMaskSection = !!(turn && turn.params && turn.params.mode === 'image_edit')
      const duration =
        turn && turn.finishedAt && turn.createdAt
          ? Date.parse(turn.finishedAt) - Date.parse(turn.createdAt)
          : 0
      const activeRef = !previewMask && previewIndex >= 0 ? refs[previewIndex] : null
      const bigSrc = previewMask
        ? imageSrc(maskMeta)
        : activeRef
          ? imageSrc(activeRef)
          : imageSrc(image)
      // v1.4 §C: 局部重绘 is only supported by the OpenAI images dialect.
      const inpaintSupported = paramDialect === DIALECT.openai
      const inpaintAvailable = !!(
        image &&
        image.id &&
        (image.localPath || imageSrc(image)) &&
        typeof onInpaint === 'function'
      )

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && onClose) onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      useEffect(() => {
        return () => {
          if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
          if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
        }
      }, [])

      const handleCopyPrompt = async () => {
        try {
          await copyText(prompt)
          setCopied(true)
          if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
          copyTimerRef.current = setTimeout(() => setCopied(false), 1600)
        } catch (error) {
          if (onToast) onToast('error', `复制失败：${(error && error.message) || error}`)
        }
      }

      const handleDelete = () => {
        if (deleting) return
        if (!confirmDelete) {
          setConfirmDelete(true)
          if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
          confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000)
          return
        }
        if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
        setConfirmDelete(false)
        if (onDelete) onDelete(image)
      }

      return h(
        'div',
        {
          className: 'iw-overlay iw-detail-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && onClose) onClose()
          },
        },
        h(
          'div',
          { className: 'iw-detail', onMouseDown: (event) => event.stopPropagation() },
          h(
            'aside',
            { className: 'iw-detail-info' },
            h(
              'div',
              { className: 'iw-detail-info-head' },
              h(Icon, { name: 'image', size: 15 }),
              h('span', { className: 'iw-detail-title' }, '生成信息'),
              h(IconButton, { name: 'x', title: '关闭 (Esc)', onClick: onClose }),
            ),
            h(
              'div',
              { className: 'iw-detail-scroll' },
              h(
                'div',
                { className: 'iw-detail-section' },
                h(
                  'div',
                  { className: 'iw-detail-section-head' },
                  h('span', { className: 'iw-detail-section-title' }, '提示词'),
                  h(
                    'button',
                    { type: 'button', className: 'iw-link-btn', onClick: handleCopyPrompt },
                    h(Icon, { name: copied ? 'check' : 'copy', size: 11 }),
                    copied ? '已复制' : '复制',
                  ),
                ),
                h('div', { className: 'iw-detail-prompt' }, prompt || '（无提示词）'),
              ),
              refs.length
                ? h(
                    'div',
                    { className: 'iw-detail-section' },
                    h(
                      'div',
                      { className: 'iw-detail-section-head' },
                      h('span', { className: 'iw-detail-section-title' }, `参考图 · ${refs.length} 张`),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'iw-link-btn',
                          onClick: () => {
                            setPreviewMask(false)
                            setPreviewIndex(previewIndex >= 0 ? -1 : 0)
                          },
                        },
                        previewIndex >= 0 ? '看生成图' : '看参考图',
                      ),
                    ),
                    h(
                      'div',
                      { className: 'iw-detail-refs' },
                      refs.map((ref, index) =>
                        h(
                          'div',
                          {
                            key: ref.id || `ref-${index}`,
                            className: cx('iw-detail-ref', previewIndex === index && 'active'),
                            title: ref.name || `参考图 ${index + 1}`,
                            role: 'button',
                            tabIndex: 0,
                            onClick: () => {
                              setPreviewMask(false)
                              setPreviewIndex(index)
                            },
                            onKeyDown: (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                setPreviewIndex(index)
                              }
                            },
                          },
                          h(ThumbImage, { src: imageSrc(ref), alt: ref.name || '' }),
                          h('span', { className: 'iw-detail-ref-badge' }, index + 1),
                          // v1.4: minimal "open local file" affordance per reference.
                          onOpenFile
                            ? h(
                                'button',
                                {
                                  type: 'button',
                                  className: 'iw-detail-ref-open',
                                  title: '打开参考图本地文件',
                                  onClick: (event) => {
                                    event.stopPropagation()
                                    onOpenFile(ref)
                                  },
                                },
                                h(Icon, { name: 'open', size: 10 }),
                              )
                            : null,
                        ),
                      ),
                    ),
                  )
                : null,
              showMaskSection
                ? h(
                    'div',
                    { className: 'iw-detail-section' },
                    h(
                      'div',
                      { className: 'iw-detail-section-head' },
                      h('span', { className: 'iw-detail-section-title' }, '重绘蒙版'),
                      maskMeta
                        ? h(
                            'button',
                            {
                              type: 'button',
                              className: 'iw-link-btn',
                              onClick: () =>
                                onOpenFile &&
                                onOpenFile({
                                  id: maskMeta.id,
                                  localPath: maskMeta.localPath,
                                  name: maskMeta.name || 'mask.png',
                                }),
                            },
                            h(Icon, { name: 'open', size: 11 }),
                            '打开文件',
                          )
                        : null,
                    ),
                    maskMeta
                      ? h(
                          'div',
                          { className: 'iw-detail-mask' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: cx('iw-detail-mask-thumb', previewMask && 'active'),
                              title: '查看蒙版大图（红色半透明=被重绘区域）',
                              onClick: () => {
                                setPreviewMask(true)
                                setPreviewIndex(-1)
                              },
                            },
                            h(ThumbImage, { src: imageSrc(maskMeta), alt: '重绘蒙版' }),
                          ),
                          h(
                            'div',
                            { className: 'iw-detail-mask-meta' },
                            `${Math.round(num(maskMeta.w, 0))} × ${Math.round(num(maskMeta.h, 0))} · PNG`,
                          ),
                        )
                      : h('div', { className: 'iw-field-hint' }, '本次生成记录缺少蒙版信息'),
                  )
                : null,
              h(
                'div',
                { className: 'iw-detail-section' },
                h(
                  'div',
                  { className: 'iw-detail-section-head' },
                  h('span', { className: 'iw-detail-section-title' }, '参数'),
                ),
                h(
                  'div',
                  { className: 'iw-param-table' },
                  h(ParamRow, { label: '模型', value: modelId ? modelLabel(modelId, props.models) : '' }),
                  paramDialect === DIALECT.xai
                    ? params.aspectRatio
                      ? h(ParamRow, { label: '比例', value: params.aspectRatio })
                      : null
                    : params.size
                      ? h(ParamRow, { label: '尺寸', value: params.size })
                      : null,
                  paramDialect === DIALECT.xai && params.resolution
                    ? h(ParamRow, { label: '分辨率', value: params.resolution })
                    : null,
                  params.quality ? h(ParamRow, { label: '质量', value: params.quality }) : null,
                  h(ParamRow, { label: '张数', value: String(params.n || 1) }),
                  duration > 0 ? h(ParamRow, { label: '耗时', value: fmtDuration(duration) }) : null,
                  createdAt ? h(ParamRow, { label: '时间', value: fmtDateTime(createdAt) }) : null,
                  image && image.w && image.h
                    ? h(ParamRow, { label: '像素', value: `${image.w} × ${image.h}` })
                    : null,
                ),
              ),
            ),
            h(
              'div',
              { className: 'iw-detail-actions' },
              h(
                Btn,
                {
                  variant: 'primary',
                  onClick: () => onAddRef && onAddRef(image, turn),
                  title: '把这张图加入输入框作为参考图',
                },
                h(Icon, { name: 'plus', size: 13 }),
                '加入输入框',
              ),
              // v1.4 §C: 局部重绘 entry (OpenAI dialect only, disabled for xAI).
              inpaintAvailable
                ? h(
                    Btn,
                    {
                      variant: 'primary',
                      onClick: () => {
                        if (inpaintSupported) onInpaint(image, turn)
                      },
                      disabled: !inpaintSupported,
                      title: inpaintSupported
                        ? '涂抹需要重绘的区域（仅 OpenAI 图像模型）'
                        : '该模型不支持局部重绘，请选择 OpenAI 图像模型',
                    },
                    h(Icon, { name: 'spark', size: 13 }),
                    '局部重绘',
                  )
                : null,
              !inpaintSupported && inpaintAvailable
                ? h(
                    'span',
                    { className: 'iw-inpaint-hint' },
                    '局部重绘仅支持 OpenAI 图像模型',
                  )
                : null,
              h(
                Btn,
                {
                  variant: confirmDelete ? 'danger-solid' : 'danger',
                  onClick: handleDelete,
                  disabled: !!deleting,
                },
                deleting ? h(Spinner, { size: 12 }) : h(Icon, { name: 'trash', size: 13 }),
                confirmDelete ? '确认删除' : '删除',
              ),
              h(
                Btn,
                { variant: 'ghost', onClick: handleCopyPrompt },
                h(Icon, { name: copied ? 'check' : 'copy', size: 13 }),
                copied ? '已复制提示词' : '复制提示词',
              ),
              // v1.4: local file actions. Cache-only images (no localPath) hide
              // the open actions and expose「下载到本地」via file.saveAs.
              hasLocalPath
                ? h(
                    Btn,
                    {
                      variant: 'ghost',
                      onClick: () => onOpenFile && onOpenFile(image),
                      title: '用系统默认程序打开本地图片文件',
                    },
                    h(Icon, { name: 'open', size: 13 }),
                    '打开文件',
                  )
                : null,
              hasLocalPath
                ? h(
                    Btn,
                    {
                      variant: 'ghost',
                      onClick: () => onRevealFile && onRevealFile(image),
                      title: '在资源管理器中定位该文件',
                    },
                    h(Icon, { name: 'folder', size: 13 }),
                    '打开文件夹',
                  )
                : null,
              h(
                Btn,
                {
                  variant: 'ghost',
                  onClick: () => onSaveAs && onSaveAs(image),
                  title: '复制到另存为目录（保存目录可在设置中修改）',
                },
                h(Icon, { name: 'download', size: 13 }),
                hasLocalPath ? '另存为' : '下载到本地',
              ),
            ),
          ),
          h(
            'div',
            { className: 'iw-detail-media' },
            h(IconButton, {
              name: 'x',
              title: '关闭 (Esc)',
              className: 'iw-detail-close',
              onClick: onClose,
            }),
            h(ThumbImage, { src: bigSrc, alt: prompt, className: 'iw-detail-img' }),
            h(
              'div',
              { className: 'iw-detail-caption' },
              previewMask
                ? '重绘蒙版 · 红色区域将重绘'
                : activeRef
                  ? `参考图 ${previewIndex + 1}/${refs.length} · ${activeRef.name || '本地参考图'}`
                  : '生成图',
            ),
            refs.length
              ? h(
                  'div',
                  { className: 'iw-detail-hint' },
                  previewIndex >= 0 ? '点击「看生成图」返回大图' : '点击左侧参考图可在此预览',
                )
              : null,
          ),
        ),
      )
    }

