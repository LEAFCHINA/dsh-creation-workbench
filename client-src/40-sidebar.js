    /* ------------------------------------------------------------------ */
    /* Sidebar: workspaces -> conversations                                */
    /* ------------------------------------------------------------------ */

    // v2.1: sidebar activity tabs (main area follows the active tab).
    const WORKBENCH_TABS = [
      { id: 'workspace', label: '工作区', icon: 'folder', title: '工作区与会话' },
      { id: 'assets', label: '资产库', icon: 'image', title: '资产库（v2.4 上线）' },
      { id: 'templates', label: '模板', icon: 'spark', title: '提示词模板（v2.2 上线）' },
      { id: 'workflows', label: '工作流', icon: 'chart', title: 'ComfyUI 工作流管理' },
    ]

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
        activeTab,
        onSelectTab,
        workflowCount,
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
            h('div', { className: 'iw-brand-title' }, 'AI 创作工作台'),
            h('div', { className: 'iw-brand-sub' }, '工作区 · 会话 · 画布'),
          ),
        ),
        h(
          'div',
          { className: 'iw-tabs', role: 'tablist' },
          WORKBENCH_TABS.map((tab) =>
            h(
              'button',
              {
                key: tab.id,
                type: 'button',
                role: 'tab',
                'aria-selected': activeTab === tab.id ? 'true' : 'false',
                className: cx('iw-tab', activeTab === tab.id && 'active'),
                title: tab.title,
                onClick: () => onSelectTab(tab.id),
              },
              h(Icon, { name: tab.icon, size: 14 }),
              h('span', { className: 'iw-tab-label' }, tab.label),
              tab.id === 'workflows' && workflowCount > 0
                ? h('span', { className: 'iw-tab-count' }, workflowCount)
                : null,
            ),
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
            { className: cx('iw-side-section', activeTab !== 'workspace' && 'iw-hidden') },
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
                { className: cx('iw-side-empty', activeTab !== 'workspace' && 'iw-hidden') },
                h('div', null, '还没有工作区'),
                h(
                  'button',
                  { type: 'button', className: 'iw-link-btn', onClick: onNewWorkspace },
                  '新建工作区',
                ),
              )
            : h(
                'div',
                { className: cx('iw-ws-list', activeTab !== 'workspace' && 'iw-hidden') },
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
        activeTab !== 'workspace'
          ? h(
              'div',
              { className: 'iw-side-tabinfo' },
              activeTab === 'workflows'
                ? h(
                    'div',
                    null,
                    h('div', { className: 'iw-side-tabinfo-title' }, '工作流'),
                    h(
                      'div',
                      { className: 'iw-side-tabinfo-desc' },
                      '共 ' + (workflowCount || 0) + ' 个工作流。右侧按分类查看、编辑或删除；导入新工作流请打开设置。',
                    ),
                  )
                : null,
              activeTab === 'assets'
                ? h(
                    'div',
                    null,
                    h('div', { className: 'iw-side-tabinfo-title' }, '资产库'),
                    h('div', { className: 'iw-side-tabinfo-desc' }, '跨会话浏览、收藏和复用生成结果。'),
                    h('div', { className: 'iw-side-tabinfo-badge' }, 'v2.4 上线'),
                  )
                : null,
              activeTab === 'templates'
                ? h(
                    'div',
                    null,
                    h('div', { className: 'iw-side-tabinfo-title' }, '提示词模板'),
                    h('div', { className: 'iw-side-tabinfo-desc' }, '保存常用提示词，用 @ 在输入框快速调用。'),
                    h('div', { className: 'iw-side-tabinfo-badge' }, 'v2.2 上线'),
                  )
                : null,
            )
          : null,
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
              title: '设置：生图 API / 本机 ComfyUI 工作流 / 分类',
            },
            h(Icon, { name: 'gear', size: 14, className: 'iw-settings-gear' }),
            h('span', { className: 'iw-settings-label' }, '设置'),
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

