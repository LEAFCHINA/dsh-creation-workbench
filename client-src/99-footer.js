    /* ------------------------------------------------------------------ */
    /* Registration                                                        */
    /* ------------------------------------------------------------------ */

    function installGlobalErrorReporting() {
      if (typeof window === 'undefined' || window.__dshImageWorkbenchHooksInstalled) return
      window.__dshImageWorkbenchHooksInstalled = true
      window.addEventListener('error', (event) => {
        try {
          const error = event && event.error
          const location = `${(event && event.filename) || ''}:${(event && event.lineno) || 0}:${
            (event && event.colno) || 0
          }`
          reportLog(
            'error',
            `window.onerror: ${(event && event.message) || 'unknown'} @ ${location} ${
              (error && error.stack) || ''
            }`,
          )
        } catch (reportError) {
          // ignore
        }
      })
      window.addEventListener('unhandledrejection', (event) => {
        try {
          const reason = event && event.reason
          const text = String((reason && (reason.stack || reason.message)) || reason).slice(0, 2000)
          reportLog('error', `unhandledrejection: ${text}`)
        } catch (reportError) {
          // ignore
        }
      })
    }

    function registerPlugins(ctx) {
      localeId = localeFrom(ctx)
      installGlobalErrorReporting()

      ctx.slots.inject(SLOTS.sidebar, () =>
        ctx.slots.register(
          {
            name: SLOTS.sidebar,
            id: 'image-workbench',
            order: 26,
            label: () => 'AI 生图工作台',
          },
          StudioIcon,
        ),
      )

      ctx.slots.inject(SLOTS.main, () =>
        ctx.slots.register(
          {
            name: SLOTS.main,
            key: 'image-workbench',
          },
          PanelRoot,
        ),
      )

      reportLog('info', `client apply ok build=${BUILD} locale=${localeId}`)
    }

    return {
      name: 'dsh-image-workbench-client',
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          registerPlugins(ctx)
        } catch (error) {
          reportLog(
            'error',
            `client apply failed: ${(error && (error.stack || error.message)) || error}`,
          )
          throw error
        }
      },
    }
  },
})
