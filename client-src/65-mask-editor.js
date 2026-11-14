    /* ------------------------------------------------------------------ */
    /* v1.4 §C: 局部重绘 (mask editor overlay)                             */
    /* ------------------------------------------------------------------ */

    function MaskEditor(props) {
      const { image, turn, models, onClose, onSubmit, pushToast } = props
      const [tool, setTool] = useState('brush')
      const [brushSize, setBrushSize] = useState(36)
      const [prompt, setPrompt] = useState(str((image && image.prompt) || (turn && turn.prompt)))
      const [hasStroke, setHasStroke] = useState(false)
      const [submitting, setSubmitting] = useState(false)

      const containerRef = useRef(null)
      const imageRef = useRef(null)
      const previewCanvasRef = useRef(null)
      const maskCanvasRef = useRef(null)
      const redCanvasRef = useRef(null)
      const drawingRef = useRef(false)
      const lastPointRef = useRef(null)

      const metaW = Math.round(num(image && image.w, 0))
      const metaH = Math.round(num(image && image.h, 0))
      // v1.4b: when legacy ImageMeta lacks pixel dimensions (w/h = 0), the mask
      // canvas is re-initialised from the loaded <img> natural size instead of
      // guessing; without that the host would reject a mismatched mask.
      const [maskSize, setMaskSize] = useState(() => ({
        w: metaW > 0 && metaH > 0 ? metaW : 0,
        h: metaW > 0 && metaH > 0 ? metaH : 0,
      }))
      const [imageLoadError, setImageLoadError] = useState(false)
      const maskReady = maskSize.w > 0 && maskSize.h > 0
      const fallbackModel = (() => {
        const list = Array.isArray(models) ? models : []
        const openaiModel = list.find((model) => resolveDialect(model.id, list) === DIALECT.openai)
        return openaiModel ? openaiModel.id : ''
      })()

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && !submitting && onClose) onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose, submitting])

      /**
       * Mask canvas lives at the ORIGINAL image pixel size. Painted pixels are
       * fully transparent (alpha 0) and untouched pixels stay opaque white, as
       * required by the OpenAI edits mask convention.
       */
      const ensureMaskCanvas = (dims) => {
        const size = dims || maskSize
        if (!(size.w > 0 && size.h > 0)) return null
        const width = Math.round(size.w)
        const height = Math.round(size.h)
        let mask = maskCanvasRef.current
        if (mask && mask.width === width && mask.height === height) return mask
        try {
          mask = document.createElement('canvas')
          mask.width = width
          mask.height = height
          const context = mask.getContext('2d')
          if (context) {
            context.globalCompositeOperation = 'source-over'
            context.fillStyle = '#ffffff'
            context.fillRect(0, 0, width, height)
          }
          const red = document.createElement('canvas')
          red.width = width
          red.height = height
          maskCanvasRef.current = mask
          redCanvasRef.current = red
          return mask
        } catch (error) {
          reportLog('warn', `mask canvas init failed: ${(error && error.message) || error}`)
          return null
        }
      }

      useEffect(() => {
        if (maskSize.w > 0 && maskSize.h > 0) {
          ensureMaskCanvas(maskSize)
          return
        }
        // Meta has no usable w/h: try the already-decoded <img> if any.
        const element = imageRef.current
        const naturalW = Math.round(num(element && element.naturalWidth, 0))
        const naturalH = Math.round(num(element && element.naturalHeight, 0))
        if (naturalW > 0 && naturalH > 0) {
          setMaskSize({ w: naturalW, h: naturalH })
          ensureMaskCanvas({ w: naturalW, h: naturalH })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [image && image.id])

      const handleImageLoad = (event) => {
        const element = imageRef.current || (event && event.currentTarget) || null
        const naturalW = Math.round(num(element && element.naturalWidth, 0))
        const naturalH = Math.round(num(element && element.naturalHeight, 0))
        setImageLoadError(false)
        if (!(naturalW > 0 && naturalH > 0)) return
        if (naturalW !== maskSize.w || naturalH !== maskSize.h) {
          // Adopt the real pixel size and discard stale strokes of any old mask.
          maskCanvasRef.current = null
          redCanvasRef.current = null
          setHasStroke(false)
          setMaskSize({ w: naturalW, h: naturalH })
          ensureMaskCanvas({ w: naturalW, h: naturalH })
        }
        redrawPreview()
      }

      const handleImageError = () => {
        setImageLoadError(true)
      }

      const redrawPreview = () => {
        const canvas = previewCanvasRef.current
        const container = containerRef.current
        const imageElement = imageRef.current
        const mask = maskCanvasRef.current
        const red = redCanvasRef.current
        if (!canvas || !mask || !red) return
        if (typeof canvas.getContext !== 'function' || typeof container === 'undefined' || !container) return
        try {
          const containerRect =
            typeof container.getBoundingClientRect === 'function'
              ? container.getBoundingClientRect()
              : null
          const imageRect =
            imageElement && typeof imageElement.getBoundingClientRect === 'function'
              ? imageElement.getBoundingClientRect()
              : null
          if (!containerRect || !containerRect.width || !imageRect || !imageRect.width) return
          canvas.width = Math.round(containerRect.width)
          canvas.height = Math.round(containerRect.height)
          const context = canvas.getContext('2d')
          if (!context) return
          context.clearRect(0, 0, canvas.width, canvas.height)
          const redContext = red.getContext('2d')
          if (!redContext) return
          redContext.globalCompositeOperation = 'source-over'
          redContext.fillStyle = '#ff3b30'
          redContext.fillRect(0, 0, red.width, red.height)
          redContext.globalCompositeOperation = 'destination-out'
          redContext.drawImage(mask, 0, 0)
          redContext.globalCompositeOperation = 'source-over'
          context.globalAlpha = 0.45
          context.drawImage(
            red,
            imageRect.left - containerRect.left,
            imageRect.top - containerRect.top,
            imageRect.width,
            imageRect.height,
          )
          context.globalAlpha = 1
        } catch (error) {
          reportLog('warn', `mask preview draw failed: ${(error && error.message) || error}`)
        }
      }

      const mapPoint = (event) => {
        const mask = ensureMaskCanvas()
        const width = mask ? mask.width : maskSize.w || 1
        const height = mask ? mask.height : maskSize.h || 1
        const imageElement = imageRef.current
        const imageRect =
          imageElement && typeof imageElement.getBoundingClientRect === 'function'
            ? imageElement.getBoundingClientRect()
            : null
        if (imageRect && imageRect.width > 0 && imageRect.height > 0) {
          return {
            x: ((num(event.clientX, 0) - imageRect.left) / imageRect.width) * width,
            y: ((num(event.clientY, 0) - imageRect.top) / imageRect.height) * height,
          }
        }
        // Fallback (headless harness / image not laid out yet): clamp raw px.
        return {
          x: clamp(num(event.clientX, 0), 0, width),
          y: clamp(num(event.clientY, 0), 0, height),
        }
      }

      const paintPoint = (mask, point, previous) => {
        const context = mask.getContext('2d')
        if (!context) return
        const size = clamp(Math.round(num(brushSize, 36)), 8, 120)
        const radius = size / 2
        context.save()
        // brush = erase alpha (painted region), eraser = restore opaque white.
        context.globalCompositeOperation = tool === 'eraser' ? 'source-over' : 'destination-out'
        context.fillStyle = '#ffffff'
        const from = previous || point
        const distance = Math.hypot(point.x - from.x, point.y - from.y)
        const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)))
        for (let index = 0; index <= steps; index += 1) {
          const ratio = index / steps
          const x = from.x + (point.x - from.x) * ratio
          const y = from.y + (point.y - from.y) * ratio
          context.beginPath()
          context.arc(x, y, radius, 0, Math.PI * 2)
          context.fill()
        }
        context.restore()
      }

      const handlePointerDown = (event) => {
        const mask = ensureMaskCanvas()
        if (!mask) return
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        drawingRef.current = true
        const point = mapPoint(event)
        lastPointRef.current = point
        paintPoint(mask, point, null)
        setHasStroke(true)
        redrawPreview()
      }

      const handlePointerMove = (event) => {
        if (!drawingRef.current) return
        const mask = ensureMaskCanvas()
        if (!mask) return
        const point = mapPoint(event)
        paintPoint(mask, point, lastPointRef.current)
        lastPointRef.current = point
        redrawPreview()
      }

      const handlePointerUp = () => {
        drawingRef.current = false
        lastPointRef.current = null
      }

      const handleClear = () => {
        const mask = ensureMaskCanvas()
        if (!mask) return
        const context = mask.getContext('2d')
        if (context) {
          context.globalCompositeOperation = 'source-over'
          context.fillStyle = '#ffffff'
          context.fillRect(0, 0, mask.width, mask.height)
        }
        setHasStroke(false)
        redrawPreview()
      }

      const handleSubmit = async () => {
        if (submitting) return
        const text = str(prompt).trim()
        if (!text) {
          if (pushToast) pushToast('error', '请填写重绘提示词')
          return
        }
        if (!hasStroke) {
          if (pushToast) pushToast('info', '请先在图片上涂抹要重绘的区域')
          return
        }
        if (!maskReady) {
          if (pushToast) {
            pushToast(
              'error',
              imageLoadError
                ? '原图加载失败，无法生成尺寸匹配的蒙版'
                : '正在读取原图尺寸，请稍候再提交',
            )
          }
          return
        }
        const mask = ensureMaskCanvas()
        if (!mask) {
          if (pushToast) pushToast('error', '无法创建遮罩画布')
          return
        }
        let dataUrl = ''
        // v3.2: ComfyUI's LoadImageMask reads a channel where 255 = repaint.
        // The editor paints with transparency (0 = repaint), so export an opaque
        // black/white PNG for ComfyUI and keep the alpha version for the API path.
        const exportCanvas = mask
        try {
          if (props.target === 'comfy') {
            const bw = document.createElement('canvas')
            bw.width = mask.width
            bw.height = mask.height
            const bwContext = bw.getContext('2d')
            const source = mask.getContext('2d')
            if (bwContext && source) {
              const imageData = source.getImageData(0, 0, mask.width, mask.height)
              const data = imageData.data
              for (let index = 0; index < data.length; index += 4) {
                const alpha = data[index + 3]
                const value = 255 - alpha
                data[index] = value
                data[index + 1] = value
                data[index + 2] = value
                data[index + 3] = 255
              }
              bwContext.putImageData(imageData, 0, 0)
            }
            dataUrl = bw.toDataURL('image/png')
          } else {
            dataUrl = typeof mask.toDataURL === 'function' ? mask.toDataURL('image/png') : ''
          }
        } catch (error) {
          dataUrl = ''
        }
        void exportCanvas
        if (!dataUrl) {
          if (pushToast) pushToast('error', '生成遮罩图片失败，请重试')
          return
        }
        const comma = dataUrl.indexOf(',')
        const maskBase64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
        setSubmitting(true)
        try {
          await onSubmit({
            image,
            turn,
            prompt: text,
            maskBase64,
            width: mask.width,
            height: mask.height,
            model: fallbackModel,
          })
        } finally {
          setSubmitting(false)
        }
      }

      const canSubmit = maskReady && hasStroke && !!str(prompt).trim() && !submitting
      const statusText = !maskReady
        ? imageLoadError
          ? '原图加载失败：无法确定像素尺寸，暂时不能提交重绘'
          : '正在读取原图尺寸…（请稍候）'
        : hasStroke
          ? '已标记待重绘区域，可以提交'
          : '请先在图片上涂抹要重绘的区域'

      return h(
        'div',
        {
          className: 'iw-overlay iw-mask-overlay',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget && !submitting && onClose) onClose()
          },
        },
        h(
          'div',
          { className: 'iw-mask-editor', onMouseDown: (event) => event.stopPropagation() },
          h(
            'div',
            { className: 'iw-mask-head' },
            h(Icon, { name: 'spark', size: 15 }),
            h('span', { className: 'iw-mask-title' }, '局部重绘'),
            h(
              'span',
              { className: 'iw-mask-sub' },
              '仅在涂抹的红色区域重绘，其余保持不变（仅 OpenAI 图像模型）',
            ),
            h(IconButton, { name: 'x', title: '关闭 (Esc)', onClick: onClose, disabled: submitting }),
          ),
          h(
            'div',
            { className: 'iw-mask-body' },
            h(
              'div',
              { className: 'iw-mask-stage', ref: containerRef },
              h('img', {
                ref: imageRef,
                className: 'iw-mask-image',
                src: imageSrc(image),
                alt: '待重绘图片',
                draggable: false,
                onLoad: handleImageLoad,
                onError: handleImageError,
              }),
              h('canvas', {
                ref: previewCanvasRef,
                className: 'iw-mask-overlay-canvas',
                onPointerDown: handlePointerDown,
                onPointerMove: handlePointerMove,
                onPointerUp: handlePointerUp,
                onPointerLeave: handlePointerUp,
              }),
            ),
            h(
              'div',
              { className: 'iw-mask-side' },
              h(
                'div',
                { className: 'iw-mask-section' },
                h('div', { className: 'iw-field-label' }, '工具'),
                h(
                  'div',
                  { className: 'iw-mask-tools' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: cx('iw-mask-tool', tool === 'brush' && 'active'),
                      title: '涂抹需要重绘的区域',
                      onClick: () => setTool('brush'),
                    },
                    h(Icon, { name: 'pencil', size: 12 }),
                    '画笔',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: cx('iw-mask-tool', tool === 'eraser' && 'active'),
                      title: '擦除涂抹标记（恢复为不重绘）',
                      onClick: () => setTool('eraser'),
                    },
                    h(Icon, { name: 'x', size: 12 }),
                    '橡皮',
                  ),
                ),
              ),
              h(
                'div',
                { className: 'iw-mask-section' },
                h('div', { className: 'iw-field-label' }, `笔刷大小：${brushSize}px`),
                h('input', {
                  className: 'iw-mask-range',
                  type: 'range',
                  min: 8,
                  max: 120,
                  step: 1,
                  value: brushSize,
                  onChange: (event) => setBrushSize(Number(event.target.value) || 36),
                }),
                h(
                  Btn,
                  { small: true, onClick: handleClear, disabled: submitting },
                  h(Icon, { name: 'refresh', size: 12 }),
                  '清空涂抹',
                ),
              ),
              h(
                'div',
                { className: 'iw-mask-section iw-mask-prompt-wrap' },
                h('div', { className: 'iw-field-label' }, '重绘提示词'),
                h('textarea', {
                  className: 'iw-input iw-mask-prompt',
                  rows: 5,
                  value: prompt,
                  placeholder: '描述希望如何修改涂抹区域',
                  onChange: (event) => setPrompt(event.target.value),
                }),
              ),
              h(
                'div',
                { className: 'iw-mask-tip' },
                '红色半透明区域会被重绘；其余区域保持不变。清晰描述要替换或补充的内容效果更好。',
              ),
            ),
          ),
          h(
            'div',
            { className: 'iw-mask-foot' },
            h(
              'span',
              { className: cx('iw-mask-status', maskReady && hasStroke && 'ready', !maskReady && 'warn') },
              statusText,
            ),
            h(
              'span',
              { className: 'iw-mask-foot-actions' },
              h(Btn, { onClick: onClose, disabled: submitting }, '取消'),
              h(
                Btn,
                { variant: 'primary', onClick: handleSubmit, disabled: !canSubmit },
                submitting ? h(Spinner, { size: 12 }) : h(Icon, { name: 'spark', size: 13 }),
                submitting ? '提交中…' : '提交重绘',
              ),
            ),
          ),
        ),
      )
    }

