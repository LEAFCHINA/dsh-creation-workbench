    /* ------------------------------------------------------------------ */
    /* Sidebar: workspaces -> conversations                                */
    /* ------------------------------------------------------------------ */

    function Sidebar(props) {
      const {
        workspaces,
        activeWorkspaceId,
        activeConversationId,
        expanded,
        settings,
        onToggleWorkspace,
        onSelectWorkspace,
        onSelectConversation,
        onNewWorkspace,
        onNewConversation,
        onRenameWorkspace,
        onDeleteWorkspace,
        onRenameConversation,
        onDeleteConversation,
        onOpenSettings,
        onOpenCosts,
        disabled,
        comfyReady,
      } = props
      const [menu, setMenu] = useState(null)

      useEffect(() => {
        if (!menu) return undefined
        const closeMenu = () => setMenu(null)
        const closeOnResize = () => setMenu(null)
        window.addEventListener('mousedown', closeMenu)
        window.addEventListener('resize', closeOnResize)
        return () => {
          window.removeEventListener('mousedown', closeMenu)
          window.removeEventListener('resize', closeOnResize)
        }
      }, [menu])

      // P2-01: the workspace "⋯" menu must escape the scrollable sidebar list,
      // so it is rendered with position:fixed coordinates taken from the trigger
      // button (and closed on sidebar scroll / window resize).
      const toggleWorkspaceMenu = (event, workspaceId) => {
        if (menu && menu.wsId === workspaceId) {
          setMenu(null)
          return
        }
        const target = event && (event.currentTarget || event.target)
        const rect =
          target && typeof target.getBoundingClientRect === 'function'
            ? target.getBoundingClientRect()
            : null
        const menuWidth = 152
        const menuHeight = 84
        const viewportWidth =
          typeof window !== 'undefined' && typeof window.innerWidth === 'number'
            ? window.innerWidth
            : 0
        const viewportHeight =
          typeof window !== 'undefined' && typeof window.innerHeight === 'number'
            ? window.innerHeight
            : 0
        let left = rect ? rect.right - menuWidth : 24
        if (viewportWidth > 0) left = Math.max(8, Math.min(left, viewportWidth - menuWidth - 8))
        let top = rect ? rect.bottom + 4 : 60
        if (viewportHeight > 0 && rect && top + menuHeight > viewportHeight - 8) {
          top = Math.max(8, rect.top - menuHeight - 4)
        }
        setMenu({ wsId: workspaceId, top, left })
      }

      const configured = !!(settings && (settings.apiKeySet || settings.envFallback))
      // v1.2.2: a saved local ComfyUI workflow counts as "configured" too.
      const comfyOn = !!comfyReady
      const statusText = configured ? '已配置' : comfyOn ? '已配置 ComfyUI' : '未配置'
      const list = Array.isArray(workspaces) ? workspaces : []

      return h(
        'aside',
        { className: 'iw-sidebar' },
        h(
          'div',
          { className: 'iw-brand' },
          h('span', { className: 'iw-brand-icon' }, h(StudioIcon, { size: 19 })),
          h(
            'div',
            { className: 'iw-brand-text' },
            h('div', { className: 'iw-brand-title' }, 'AI 生图工作台'),
            h('div', { className: 'iw-brand-sub' }, '工作区 · 会话 · 画布'),
          ),
        ),
        h(
          'div',
          {
            className: 'iw-side-scroll',
            onScroll: () => {
              if (menu) setMenu(null)
            },
          },
          h(
            'div',
            { className: 'iw-side-section' },
            h('div', { className: 'iw-side-section-title' }, '工作区'),
            h(IconButton, {
              name: 'plus',
              title: '新建工作区',
              onClick: onNewWorkspace,
              disabled: !!disabled,
            }),
          ),
          list.length === 0
            ? h(
                'div',
                { className: 'iw-side-empty' },
                h('div', null, '还没有工作区'),
                h(
                  'button',
                  { type: 'button', className: 'iw-link-btn', onClick: onNewWorkspace },
                  '新建工作区',
                ),
              )
            : h(
                'div',
                { className: 'iw-ws-list' },
                list.map((workspace) => {
                  const isActiveWs = workspace.id === activeWorkspaceId
                  const isOpen = !!expanded[workspace.id]
                  const conversations = Array.isArray(workspace.conversations)
                    ? workspace.conversations
                    : []
                  return h(
                    'div',
                    { key: workspace.id, className: cx('iw-ws', isActiveWs && 'iw-ws-active') },
                    h(
                      'div',
                      {
                        className: cx('iw-ws-row', isActiveWs && 'active'),
                        onClick: () => onSelectWorkspace(workspace.id),
                        title: workspace.name,
                      },
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'iw-ws-chevron',
                          title: isOpen ? '收起' : '展开',
                          onClick: (event) => {
                            event.stopPropagation()
                            onToggleWorkspace(workspace.id)
                          },
                        },
                        h(Icon, { name: isOpen ? 'chevronDown' : 'chevronRight', size: 13 }),
                      ),
                      h(Icon, { name: 'folder', size: 14, className: 'iw-ws-icon' }),
                      h('span', { className: 'iw-ws-name' }, workspace.name),
                      h(
                        'span',
                        { className: 'iw-row-actions' },
                        h(IconButton, {
                          name: 'plus',
                          size: 13,
                          title: '新建会话',
                          onClick: () => onNewConversation(workspace.id),
                        }),
                        h(IconButton, {
                          name: 'dots',
                          size: 13,
                          title: '更多操作',
                          onClick: (event) => toggleWorkspaceMenu(event, workspace.id),
                        }),
                      ),
                      menu && menu.wsId === workspace.id
                        ? h(
                            'div',
                            {
                              className: 'iw-menu iw-menu-fixed',
                              style: { top: menu.top, left: menu.left },
                              onMouseDown: (event) => event.stopPropagation(),
                            },
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'iw-menu-item',
                                onClick: (event) => {
                                  event.stopPropagation()
                                  setMenu(null)
                                  onRenameWorkspace(workspace)
                                },
                              },
                              h(Icon, { name: 'pencil', size: 13 }),
                              h('span', null, '重命名'),
                            ),
                            h(
                              'button',
                              {
                                type: 'button',
                                className: 'iw-menu-item danger',
                                onClick: (event) => {
                                  event.stopPropagation()
                                  setMenu(null)
                                  onDeleteWorkspace(workspace)
                                },
                              },
                              h(Icon, { name: 'trash', size: 13 }),
                              h('span', null, '删除工作区'),
                            ),
                          )
                        : null,
                    ),
                    isOpen
                      ? h(
                          'div',
                          { className: 'iw-ws-convs' },
                          h(
                            'button',
                            {
                              type: 'button',
                              className: 'iw-conv-new',
                              onClick: () => onNewConversation(workspace.id),
                              disabled: !!disabled,
                            },
                            h(Icon, { name: 'plus', size: 12 }),
                            h('span', null, '新会话'),
                          ),
                          conversations.length === 0
                            ? h('div', { className: 'iw-conv-empty' }, '暂无会话')
                            : conversations.map((conversation) => {
                                const active =
                                  workspace.id === activeWorkspaceId &&
                                  conversation.id === activeConversationId
                                return h(
                                  'div',
                                  {
                                    key: conversation.id,
                                    className: cx('iw-conv', active && 'active'),
                                    title: conversation.title,
                                    onClick: () =>
                                      onSelectConversation(workspace.id, conversation.id),
                                  },
                                  h(
                                    'span',
                                    { className: 'iw-conv-main' },
                                    h('span', { className: 'iw-conv-title' }, conversation.title || '新会话'),
                                    h(
                                      'span',
                                      { className: 'iw-conv-time' },
                                      fmtRelative(conversation.updatedAt || conversation.createdAt),
                                    ),
                                  ),
                                  h(
                                    'span',
                                    { className: 'iw-row-actions iw-conv-actions' },
                                    h(IconButton, {
                                      name: 'pencil',
                                      size: 12,
                                      title: '重命名会话',
                                      onClick: () => onRenameConversation(workspace, conversation),
                                    }),
                                    h(IconButton, {
                                      name: 'trash',
                                      size: 12,
                                      title: '删除会话',
                                      onClick: () => onDeleteConversation(workspace, conversation),
                                    }),
                                  ),
                                )
                              }),
                        )
                      : null,
                  )
                }),
              ),
        ),
        h(
          'div',
          { className: 'iw-side-footer' },
          h(
            'button',
            {
              type: 'button',
              className: 'iw-side-entry iw-cost-entry',
              onClick: onOpenCosts,
              title: '成本看板',
            },
            h(Icon, { name: 'chart', size: 14, className: 'iw-settings-gear' }),
            h('span', { className: 'iw-settings-label' }, '成本看板'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'iw-settings-row',
              onClick: onOpenSettings,
              title: '设置：生图 API / 本机 ComfyUI 工作流',
            },
            h(Icon, { name: 'gear', size: 14, className: 'iw-settings-gear' }),
            h('span', { className: 'iw-settings-label' }, 'API 设置'),
            h(
              'span',
              { className: cx('iw-settings-state', (configured || comfyOn) && 'on') },
              h('span', { className: cx('iw-status-dot', (configured || comfyOn) && 'on') }),
              statusText,
            ),
          ),
        ),
      )
    }

