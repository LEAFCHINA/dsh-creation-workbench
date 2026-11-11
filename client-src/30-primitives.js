    /* ------------------------------------------------------------------ */
    /* Small UI primitives                                                 */
    /* ------------------------------------------------------------------ */

    function Btn(props) {
      const variant = props.variant ? `iw-btn-${props.variant}` : ''
      return h(
        'button',
        {
          type: props.type || 'button',
          className: cx('iw-btn', variant, props.small ? 'iw-btn-sm' : '', props.className),
          title: props.title || undefined,
          disabled: !!props.disabled,
          onClick: props.onClick || undefined,
        },
        props.children,
      )
    }

    function IconButton(props) {
      return h(
        'button',
        {
          type: 'button',
          className: cx(
            'iw-icon-btn',
            props.variant ? `iw-icon-btn-${props.variant}` : '',
            props.className,
          ),
          title: props.title || undefined,
          'aria-label': props.title || undefined,
          disabled: !!props.disabled,
          onClick: props.onClick
            ? (event) => {
                event.stopPropagation()
                props.onClick(event)
              }
            : undefined,
          onMouseDown: (event) => event.stopPropagation(),
        },
        h(Icon, { name: props.name, size: props.size || 14 }),
      )
    }

    function Spinner(props) {
      const size = num(props && props.size, 14)
      return h('span', { className: 'iw-spin', style: { width: size, height: size } })
    }

    function ThumbImage(props) {
      // P3-06: remember *which* src failed instead of a plain boolean, so a new
      // src in the same component slot (e.g. detail preview switch) recovers.
      const [failedSrc, setFailedSrc] = useState('')
      const [nonce, setNonce] = useState(0)
      const src = str(props && props.src)
      const className = props && props.className
      const alt = str(props && props.alt)
      const onClick = props && props.onClick

      if (!src) {
        return h(
          'div',
          { className: cx('iw-img-fail', className) },
          h(Icon, { name: 'image', size: 18 }),
          h('span', null, '无图片'),
        )
      }
      if (failedSrc && failedSrc === src) {
        return h(
          'div',
          {
            className: cx('iw-img-fail', className),
            onClick: onClick || undefined,
            title: alt || undefined,
          },
          h(Icon, { name: 'image', size: 18 }),
          h('span', null, '图片加载失败'),
          h(
            'button',
            {
              type: 'button',
              className: 'iw-mini-btn',
              onClick: (event) => {
                event.stopPropagation()
                setFailedSrc('')
                setNonce((value) => value + 1)
              },
            },
            '重新加载',
          ),
        )
      }
      return h('img', {
        key: nonce,
        className: cx('iw-thumb-img', className),
        src,
        alt,
        loading: 'lazy',
        draggable: false,
        onClick: onClick || undefined,
        onError: () => setFailedSrc(src),
      })
    }

    function Select(props) {
      const items = (Array.isArray(props.options) ? props.options : []).map((option) =>
        typeof option === 'string' ? { value: option, label: option } : option,
      )
      const value = str(props.value)
      const current = items.some((item) => item.value === value)
        ? value
        : items.length
          ? items[0].value
          : ''
      // v1.2: consecutive options that carry a `group` string render as an
      // <optgroup> (used for「ComfyUI 工作流」in the model dropdown). Options
      // without a group render exactly as before (optgroup support is additive).
      const children = []
      let groupName = ''
      let groupOptions = null
      for (const item of items) {
        const nextGroup = str(item.group)
        if (nextGroup) {
          if (nextGroup !== groupName || !groupOptions) {
            groupName = nextGroup
            groupOptions = []
            children.push({ group: nextGroup, options: groupOptions })
          }
          groupOptions.push(item)
        } else {
          groupName = ''
          groupOptions = null
          children.push(item)
        }
      }
      const optionNode = (item) =>
        h('option', { key: item.value, value: item.value, disabled: !!item.disabled }, item.label)
      return h(
        'span',
        {
          className: cx('iw-select-wrap', props.className),
          title: props.title || undefined,
        },
        h(
          'select',
          {
            className: 'iw-select',
            value: current,
            'aria-label': props.ariaLabel || props.title || undefined,
            disabled: !!props.disabled,
            onChange: (event) => {
              if (props.onChange) props.onChange(event.target.value)
            },
            onMouseDown: (event) => event.stopPropagation(),
          },
          children.map((entry) =>
            entry && entry.group
              ? h(
                  'optgroup',
                  { key: `group:${entry.group}`, label: entry.group },
                  entry.options.map(optionNode),
                )
              : optionNode(entry),
          ),
        ),
        h(Icon, { name: 'chevronDown', size: 11, className: 'iw-select-chevron' }),
      )
    }

    function ToastHost(props) {
      const toasts = Array.isArray(props.toasts) ? props.toasts : []
      return h(
        'div',
        { className: 'iw-toasts' },
        toasts.map((toast) => {
          const kind = ['error', 'success', 'info'].indexOf(toast.kind) >= 0 ? toast.kind : 'info'
          return h(
            'div',
            { key: toast.id, className: cx('iw-toast', `iw-toast-${kind}`), role: 'status' },
            h(Icon, { name: kind === 'error' ? 'alert' : kind === 'success' ? 'check' : 'spark', size: 13 }),
            h('span', { className: 'iw-toast-text' }, toast.text),
            toast.action && toast.action.label
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'iw-toast-action',
                    title: toast.action.title || toast.action.label,
                    onClick: () => {
                      try {
                        if (typeof toast.action.onClick === 'function') toast.action.onClick()
                      } finally {
                        props.onDismiss(toast.id)
                      }
                    },
                  },
                  toast.action.label,
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'iw-toast-x',
                title: '关闭',
                onClick: () => props.onDismiss(toast.id),
              },
              h(Icon, { name: 'x', size: 11 }),
            ),
          )
        }),
      )
    }

    function Modal(props) {
      const close = (event) => {
        if (props.closeDisabled) return
        if (event) event.stopPropagation()
        if (props.onClose) props.onClose()
      }
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape' && !props.closeDisabled && props.onClose) props.onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [props.closeDisabled, props.onClose])

      return h(
        'div',
        {
          className: cx('iw-overlay', props.overlayClassName),
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) close(event)
          },
        },
        h(
          'div',
          {
            className: cx('iw-modal', props.className),
            style: props.width ? { width: `min(${props.width}px, 100%)` } : undefined,
            onMouseDown: (event) => event.stopPropagation(),
          },
          h(
            'div',
            { className: 'iw-modal-head' },
            h(
              'div',
              { className: 'iw-modal-titles' },
              h('div', { className: 'iw-modal-title' }, props.title),
              props.subtitle ? h('div', { className: 'iw-modal-sub' }, props.subtitle) : null,
            ),
            h(IconButton, { name: 'x', title: '关闭 (Esc)', onClick: close, disabled: !!props.closeDisabled }),
          ),
          h('div', { className: 'iw-modal-body' }, props.children),
          props.footer ? h('div', { className: 'iw-modal-foot' }, props.footer) : null,
        ),
      )
    }

    function PromptDialog(props) {
      const [value, setValue] = useState(str(props.initialValue))
      const inputRef = useRef(null)
      const busy = !!props.busy
      useEffect(() => {
        const timer = setTimeout(() => {
          const element = inputRef.current
          if (!element) return
          try {
            element.focus()
            element.select()
          } catch (error) {
            // ignore
          }
        }, 40)
        return () => clearTimeout(timer)
      }, [])
      const submit = () => {
        const trimmed = value.trim()
        if (!trimmed || busy) return
        if (props.onConfirm) props.onConfirm(trimmed)
      }
      return h(
        Modal,
        {
          title: props.title,
          onClose: props.onCancel,
          closeDisabled: busy,
          width: 430,
          footer: h(
            React.Fragment,
            null,
            h(Btn, { onClick: props.onCancel, disabled: busy }, '取消'),
            h(
              Btn,
              {
                variant: 'primary',
                onClick: submit,
                disabled: busy || !value.trim(),
              },
              busy ? h(Spinner, { size: 12 }) : null,
              props.confirmText || '确定',
            ),
          ),
        },
        h(
          'label',
          { className: 'iw-field' },
          h('div', { className: 'iw-field-label' }, props.label || '名称'),
          h('input', {
            ref: inputRef,
            className: 'iw-input',
            value,
            placeholder: props.placeholder || '',
            disabled: busy,
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            },
          }),
        ),
        props.hint ? h('div', { className: 'iw-field-hint' }, props.hint) : null,
      )
    }

    function ConfirmDialog(props) {
      const busy = !!props.busy
      return h(
        Modal,
        {
          title: props.title,
          onClose: props.onCancel,
          closeDisabled: busy,
          width: 440,
          footer: h(
            React.Fragment,
            null,
            h(Btn, { onClick: props.onCancel, disabled: busy }, '取消'),
            h(
              Btn,
              {
                variant: props.danger ? 'danger-solid' : 'primary',
                onClick: () => {
                  if (!busy && props.onConfirm) props.onConfirm()
                },
                disabled: busy,
              },
              busy ? h(Spinner, { size: 12 }) : null,
              props.confirmText || '确定',
            ),
          ),
        },
        h('div', { className: 'iw-confirm-message' }, props.message),
        props.hint ? h('div', { className: 'iw-field-hint' }, props.hint) : null,
      )
    }

    function EmptyState(props) {
      return h(
        'div',
        { className: 'iw-empty' },
        h('div', { className: 'iw-empty-icon' }, h(Icon, { name: props.icon || 'image', size: 26 })),
        h('div', { className: 'iw-empty-title' }, props.title),
        props.desc ? h('div', { className: 'iw-empty-desc' }, props.desc) : null,
        props.cta
          ? h(
              Btn,
              { variant: 'primary', onClick: props.onCta },
              h(Icon, { name: 'plus', size: 13 }),
              props.cta,
            )
          : null,
      )
    }

    function ParamRow(props) {
      return h(
        'div',
        { className: 'iw-param-row' },
        h('span', { className: 'iw-param-key' }, props.label),
        h('span', { className: 'iw-param-val', title: str(props.value) || undefined }, str(props.value) || '—'),
      )
    }

    function Field(props) {
      return h(
        'div',
        { className: cx('iw-field', props.className) },
        h('div', { className: 'iw-field-label' }, props.label),
        props.children,
        props.hint ? h('div', { className: 'iw-field-hint' }, props.hint) : null,
      )
    }

