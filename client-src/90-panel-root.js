    /* ------------------------------------------------------------------ */
    /* Error boundary / panel root                                         */
    /* ------------------------------------------------------------------ */

    class ErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        reportLog(
          'error',
          `panel crash: ${(error && (error.stack || error.message)) || error} ${
            (info && info.componentStack) || ''
          }`,
        )
      }

      render() {
        if (this.state.error) {
          const message = String((this.state.error && this.state.error.message) || this.state.error)
          return h(
            'div',
            { className: 'iw-root' },
            h('style', null, CSS),
            h(
              'div',
              { className: 'iw-boot' },
              h(
                'div',
                { className: 'iw-boot-card' },
                h('div', { className: 'iw-boot-icon error' }, h(Icon, { name: 'alert', size: 28 })),
                h('div', { className: 'iw-boot-title' }, '面板渲染出错'),
                h('div', { className: 'iw-boot-error' }, message),
                h('div', { className: 'iw-boot-desc' }, '可以尝试重新渲染面板，或刷新页面恢复。'),
                h(
                  'div',
                  { className: 'iw-boot-actions' },
                  h(
                    Btn,
                    {
                      variant: 'primary',
                      onClick: () => this.setState({ error: null }),
                    },
                    '重试渲染',
                  ),
                  h(Btn, { onClick: () => window.location.reload() }, '刷新页面'),
                ),
              ),
            ),
          )
        }
        return this.props.children
      }
    }

    function PanelRoot() {
      return h(ErrorBoundary, null, h(Workbench))
    }

