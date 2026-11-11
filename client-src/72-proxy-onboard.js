    /* ------------------------------------------------------------------ */
    /* v1.10 first-run proxy onboarding                                    */
    /* ------------------------------------------------------------------ */

    function proxySourceLabel(source) {
      const text = str(source)
      if (!text) return ''
      if (text.indexOf('local-port') === 0) return '本机端口'
      if (text.indexOf('env:') === 0) return '环境变量'
      if (text.indexOf('registry') === 0) return '系统代理'
      return text
    }

    /**
     * First-run dialog: the host detected candidates while bootstrap ran
     * (or the user turned on auto-detection, which the host applies directly).
     * "使用此代理" persists proxyUrl + onboardDone; "直连" persists only the
     * latter; "稍后" keeps the prompt for the next panel open.
     */
    function ProxyOnboardDialog(props) {
      const onboarding = isObj(props.onboarding) ? props.onboarding : {}
      const candidates = Array.isArray(onboarding.candidates) ? onboarding.candidates : []
      const busy = !!props.busy
      const [selected, setSelected] = useState(() => (candidates[0] ? candidates[0].url : ''))
      const firstVerified = candidates.find((candidate) => candidate.verified)
      const effective = selected || (firstVerified ? firstVerified.url : candidates[0] ? candidates[0].url : '')
      return h(
        Modal,
        {
          title: '首次使用 · 配置本地代理',
          subtitle: '生图请求在部分网络下需要本地代理（Clash / v2ray / iKuuu 等客户端本机端口）。',
          onClose: busy ? undefined : props.onLater,
          closeDisabled: busy,
          width: 560,
          footer: h(
            React.Fragment,
            null,
            h(Btn, { onClick: props.onDirect, disabled: busy, title: '不开代理，直接连接；以后可在设置中再配置' }, '直连，暂不配置'),
            h(Btn, { onClick: props.onLater, disabled: busy }, '稍后'),
            h(Btn, { onClick: props.onManual, disabled: busy }, '手动配置'),
            effective
              ? h(
                  Btn,
                  { variant: 'primary', onClick: () => props.onApply(effective), disabled: busy },
                  busy ? h(Spinner, { size: 12 }) : null,
                  '使用此代理',
                )
              : null,
          ),
        },
        candidates.length
          ? h(
              'div',
              { className: 'iw-onboard-list' },
              candidates.map((candidate) => {
                const isSelected = effective === candidate.url
                return h(
                  'button',
                  {
                    key: candidate.url,
                    type: 'button',
                    className: cx('iw-onboard-item', isSelected && 'sel'),
                    title: candidate.url,
                    onClick: () => setSelected(candidate.url),
                  },
                  h(Icon, { name: 'check', size: 12 }),
                  h('span', { className: 'iw-onboard-url' }, candidate.url),
                  h(
                    'span',
                    { className: 'iw-onboard-tags' },
                    candidate.verified
                      ? h('span', { className: 'iw-tag ok' }, '连接验证通过')
                      : candidate.needsAuth
                        ? h('span', { className: 'iw-tag warn' }, '需要账号密码')
                        : h('span', { className: 'iw-tag' }, '仅端口可达'),
                    candidate.source
                      ? h('span', { className: 'iw-tag' }, proxySourceLabel(candidate.source))
                      : null,
                  ),
                )
              }),
            )
          : h(
              'div',
              { className: 'iw-onboard-empty' },
              '未检测到本机代理。可以点「手动配置」填写代理地址，或先直连使用。',
            ),
        h(
          'div',
          { className: 'iw-onboard-note' },
          '检测只扫描本机常见代理端口并做一次 CONNECT 连通验证，不发送任何业务数据。',
          '选择「使用此代理」会立即写入设置（仅作用于本插件的生图请求，不影响其它 DSH 流量）；',
          '也可以随时在「⚙ 设置 → 高级 → 网络代理」中修改。',
        ),
      )
    }

