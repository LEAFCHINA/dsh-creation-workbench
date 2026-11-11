    /* ------------------------------------------------------------------ */
    /* v1.4: cost dashboard overlay                                        */
    /* ------------------------------------------------------------------ */

    function normalizeCostBucket(raw) {
      const source = isObj(raw) ? raw : {}
      return {
        cost: Math.max(0, num(source.cost, 0)),
        images: Math.max(0, Math.round(num(source.images, 0))),
        generations: Math.max(0, Math.round(num(source.generations, 0))),
        successRate: clamp(num(source.successRate, 0), 0, 1),
      }
    }

    function normalizeCostTierBucket(raw) {
      const source = isObj(raw) ? raw : {}
      return {
        generations: Math.max(0, Math.round(num(source.generations, 0))),
        images: Math.max(0, Math.round(num(source.images, 0))),
        cost: Math.max(0, num(source.cost, 0)),
      }
    }

    function normalizeCostTiers(raw) {
      const source = isObj(raw) ? raw : {}
      const tiers = {}
      for (const tier of COST_TIERS) tiers[tier] = normalizeCostTierBucket(source[tier])
      return tiers
    }

    /** v1.8: compact per-tier stats text, zero tiers hidden. */
    function formatTierStats(tiers) {
      const source = isObj(tiers) ? tiers : {}
      const parts = []
      for (const tier of COST_TIERS) {
        const item = normalizeCostTierBucket(source[tier])
        if (item.generations === 0 && item.images === 0) continue
        parts.push(`${tier} ×${item.generations} ${formatMoney(item.cost)}`)
      }
      return parts.join(' · ')
    }

    function normalizeCostStats(raw) {
      const source = isObj(raw) ? raw : {}
      return {
        currency: str(source.currency) || '¥',
        today: normalizeCostBucket(source.today),
        days: (Array.isArray(source.days) ? source.days : []).map((day) => {
          const item = isObj(day) ? day : {}
          return { date: str(item.date), ...normalizeCostBucket(item) }
        }),
        models: (Array.isArray(source.models) ? source.models : []).map((model) => {
          const item = isObj(model) ? model : {}
          return {
            model: str(item.model) || '未知模型',
            ...normalizeCostBucket(item),
            // v1.8: per-tier aggregation for GPT image models.
            tiers: normalizeCostTiers(item.tiers),
          }
        }),
        totals: normalizeCostBucket(source.totals),
      }
    }

    function aggregateCostBuckets(buckets) {
      const list = Array.isArray(buckets) ? buckets : []
      let cost = 0
      let images = 0
      let generations = 0
      let successGenerations = 0
      for (const bucket of list) {
        cost += bucket.cost
        images += bucket.images
        generations += bucket.generations
        successGenerations += bucket.successRate * bucket.generations
      }
      return {
        cost,
        images,
        generations,
        successRate: generations > 0 ? successGenerations / generations : 0,
      }
    }

    function CostDashboard(props) {
      const { onClose, settings, pushToast, onSaveModelCosts } = props
      const [stats, setStats] = useState(null)
      const [loading, setLoading] = useState(true)
      const [refreshing, setRefreshing] = useState(false)
      const [error, setError] = useState('')
      const [priceDrafts, setPriceDrafts] = useState({})
      const [savingModel, setSavingModel] = useState('')
      const modelCosts = settings && isObj(settings.modelCosts) ? settings.modelCosts : {}
      const models = settings && Array.isArray(settings.models) ? settings.models : []

      const loadStats = async (isRefresh) => {
        if (isRefresh) setRefreshing(true)
        else setLoading(true)
        setError('')
        try {
          const data = await rpc('stats.cost', { days: 30 })
          const normalized = normalizeCostStats(data)
          setStats(normalized)
          setPriceDrafts((previous) => {
            const next = { ...previous }
            for (const row of normalized.models) {
              if (row.model in next) continue
              if (isGptImageModel(row.model)) {
                const tiers = modelCostTiers(modelCosts[row.model])
                next[row.model] = {
                  '1K': String(tiers['1K']),
                  '2K': String(tiers['2K']),
                  '4K': String(tiers['4K']),
                }
              } else {
                next[row.model] = String(modelCostFlat(modelCosts[row.model]))
              }
            }
            return next
          })
        } catch (failure) {
          const message = (failure && failure.message) || String(failure)
          setError(message)
          if (isRefresh && pushToast) pushToast('error', `刷新成本数据失败：${message}`)
        } finally {
          setLoading(false)
          setRefreshing(false)
        }
      }

      useEffect(() => {
        loadStats(false)
      }, [])

      // v1.8: price editing supports GPT image tiered prices (1K/2K/4K) and a
      // single flat price for every other model. Payloads only contain the
      // edited model; blank inputs mean 0; negatives/non-numbers are blocked.
      const parsePriceInput = (rawValue) => {
        const text = str(rawValue).trim()
        if (!text) return { ok: true, value: 0 }
        const value = Number(text)
        if (!isFinite(value) || value < 0) return { ok: false, value: 0 }
        return { ok: true, value: roundCost(value) }
      }

      const tierDraftValue = (model, tier) => {
        const draft = priceDrafts[model]
        if (isObj(draft) && draft[tier] !== undefined) return draft[tier]
        return String(modelCostTiers(modelCosts[model])[tier])
      }

      const setTierDraft = (model, tier, value) => {
        setPriceDrafts((previous) => {
          const current = isObj(previous[model]) ? { ...previous[model] } : {}
          current[tier] = value
          return { ...previous, [model]: current }
        })
      }

      const saveModelCost = async (model, value, toastText) => {
        setSavingModel(model)
        try {
          // v1.8: only the edited model is submitted.
          await rpc('settings.set', { modelCosts: { [model]: value } })
          if (onSaveModelCosts) onSaveModelCosts({ ...modelCosts, [model]: value })
          if (pushToast) pushToast('success', toastText)
          return true
        } catch (failure) {
          if (pushToast) pushToast('error', `保存单价失败：${(failure && failure.message) || failure}`)
          return false
        } finally {
          setSavingModel('')
        }
      }

      const commitFlatPrice = async (model, rawValue) => {
        if (savingModel) return
        const parsed = parsePriceInput(rawValue)
        if (!parsed.ok) {
          if (pushToast) pushToast('error', '单价需为不小于 0 的数字')
          setPriceDrafts((previous) => ({
            ...previous,
            [model]: String(modelCostFlat(modelCosts[model])),
          }))
          return
        }
        if (modelCostFlat(modelCosts[model]) === parsed.value) {
          setPriceDrafts((previous) => ({ ...previous, [model]: String(parsed.value) }))
          return
        }
        await saveModelCost(model, parsed.value, `已保存单价：${formatMoney(parsed.value)}/张`)
      }

      const commitTierPrice = async (model, tier, rawValue) => {
        if (savingModel) return
        const tiers = {}
        for (const key of COST_TIERS) {
          const source = key === tier ? rawValue : tierDraftValue(model, key)
          const parsed = parsePriceInput(source)
          if (!parsed.ok) {
            if (pushToast) {
              pushToast('error', `「${modelLabel(model, models)}」${key} 档单价需为不小于 0 的数字`)
            }
            setTierDraft(model, tier, String(modelCostTiers(modelCosts[model])[tier]))
            return
          }
          tiers[key] = parsed.value
        }
        const canonical = {
          '1K': String(tiers['1K']),
          '2K': String(tiers['2K']),
          '4K': String(tiers['4K']),
        }
        setPriceDrafts((previous) => ({ ...previous, [model]: canonical }))
        const current = modelCostTiers(modelCosts[model])
        const changed = COST_TIERS.some((key) => current[key] !== tiers[key])
        if (!changed) return
        await saveModelCost(
          model,
          { '1K': tiers['1K'], '2K': tiers['2K'], '4K': tiers['4K'] },
          `已保存三档单价：1K ${formatMoney(tiers['1K'])} · 2K ${formatMoney(
            tiers['2K'],
          )} · 4K ${formatMoney(tiers['4K'])}/张`,
        )
      }

      const hasData = !!(
        stats &&
        (stats.today.generations > 0 ||
          stats.totals.generations > 0 ||
          stats.days.some((day) => day.generations > 0))
      )
      const summaryCards = stats
        ? [
            { key: 'today', label: '今日', bucket: stats.today },
            { key: '7d', label: '近 7 天', bucket: aggregateCostBuckets(stats.days.slice(-7)) },
            { key: '30d', label: '近 30 天', bucket: aggregateCostBuckets(stats.days.slice(-30)) },
          ]
        : []
      const barDays = stats ? stats.days.slice(-14) : []
      const maxCost = barDays.reduce((max, day) => Math.max(max, day.cost), 0)

      return h(
        Modal,
        {
          title: '成本看板',
          subtitle: '生成花费、成功率与每模型单价（按每张估计价估算）',
          onClose: onClose,
          width: 820,
          className: 'iw-cost-modal',
          footer: h(
            'div',
            { className: 'iw-modal-foot-row' },
            h(
              'div',
              { className: 'iw-modal-foot-left' },
              h(
                Btn,
                { onClick: () => loadStats(true), disabled: refreshing || loading },
                refreshing ? h(Spinner, { size: 12 }) : h(Icon, { name: 'refresh', size: 13 }),
                refreshing ? '刷新中…' : '刷新',
              ),
            ),
            h(
              'div',
              { className: 'iw-modal-foot-right' },
              h(Btn, { onClick: onClose }, '关闭'),
            ),
          ),
        },
        error ? h('div', { className: 'iw-form-error' }, h(Icon, { name: 'alert', size: 13 }), error) : null,
        loading && !stats
          ? h(
              'div',
              { className: 'iw-cost-loading' },
              h(Spinner, { size: 16 }),
              h('span', null, '正在加载成本数据…'),
            )
          : h(
              React.Fragment,
              null,
              h(
                'div',
                { className: 'iw-cost-cards' },
                summaryCards.map((card) =>
                  h(
                    'div',
                    { key: card.key, className: 'iw-cost-card' },
                    h('div', { className: 'iw-cost-card-title' }, card.label),
                    h('div', { className: 'iw-cost-card-cost' }, formatMoney(card.bucket.cost)),
                    h(
                      'div',
                      { className: 'iw-cost-card-meta' },
                      `${card.bucket.images} 张图片 · 成功率 ${formatRate(card.bucket.successRate)}`,
                    ),
                    h('div', { className: 'iw-cost-card-sub' }, `生成 ${card.bucket.generations} 次`),
                  ),
                ),
              ),
              hasData
                ? null
                : h(
                    'div',
                    { className: 'iw-cost-empty' },
                    h(Icon, { name: 'spark', size: 16 }),
                    h('span', null, '暂无成本记录 — 完成一次生成后这里会出现统计'),
                  ),
              h(
                'div',
                { className: 'iw-cost-section' },
                h('div', { className: 'iw-cost-section-title' }, '近 14 天每日花费'),
                barDays.length
                  ? h(
                      'div',
                      { className: 'iw-cost-bars' },
                      barDays.map((day) =>
                        h(
                          'div',
                          {
                            key: day.date,
                            className: 'iw-cost-bar-col',
                            title: `${day.date} · ${formatMoney(day.cost)} · ${day.images} 张 · 成功率 ${formatRate(
                              day.successRate,
                            )}`,
                          },
                          h(
                            'div',
                            { className: 'iw-cost-bar-track' },
                            h('div', {
                              className: 'iw-cost-bar',
                              style: {
                                height: `${
                                  maxCost > 0 ? Math.max(2, Math.round((day.cost / maxCost) * 100)) : 2
                                }%`,
                              },
                            }),
                          ),
                          h('div', { className: 'iw-cost-bar-label' }, day.date ? day.date.slice(5) : ''),
                        ),
                      ),
                    )
                  : h('div', { className: 'iw-field-hint' }, '近 14 天暂无数据'),
              ),
              stats && stats.models.length
                ? h(
                    'div',
                    { className: 'iw-cost-section' },
                    h('div', { className: 'iw-cost-section-title' }, '按模型统计'),
                    h(
                      'table',
                      { className: 'iw-cost-table' },
                      h(
                        'thead',
                        null,
                        h(
                          'tr',
                          null,
                          [
                            '模型',
                            '生成次数',
                            '张数',
                            '花费',
                            '成功率',
                            '分档统计（次数/花费）',
                            '单价 ¥/张',
                          ].map((label) => h('th', { key: label }, label)),
                        ),
                      ),
                      h(
                        'tbody',
                        null,
                        stats.models.map((row) => {
                          const gptModel = isGptImageModel(row.model)
                          const tierText = formatTierStats(row.tiers)
                          return h(
                            'tr',
                            { key: row.model },
                            h('td', { className: 'iw-cost-model', title: row.model }, modelLabel(row.model, models)),
                            h('td', null, String(row.generations)),
                            h('td', null, String(row.images)),
                            h('td', null, formatMoney(row.cost)),
                            h('td', null, formatRate(row.successRate)),
                            h(
                              'td',
                              { className: 'iw-cost-tiers', title: tierText || undefined },
                              tierText || '—',
                            ),
                            h(
                              'td',
                              null,
                              gptModel
                                ? h(
                                    'div',
                                    { className: 'iw-cost-price-tiers' },
                                    COST_TIERS.map((tier) =>
                                      h(
                                        'label',
                                        {
                                          key: tier,
                                          className: 'iw-cost-price-tier',
                                          title: `${tier} 档每张估计成本（元），保存为分档对象`,
                                        },
                                        h('span', { className: 'iw-cost-price-tier-label' }, tier),
                                        h('input', {
                                          className: 'iw-input iw-cost-price iw-cost-price-tier-input',
                                          type: 'number',
                                          min: 0,
                                          step: 0.01,
                                          value: tierDraftValue(row.model, tier),
                                          disabled: savingModel === row.model,
                                          onChange: (event) =>
                                            setTierDraft(row.model, tier, event.target.value),
                                          onBlur: () =>
                                            commitTierPrice(row.model, tier, tierDraftValue(row.model, tier)),
                                          onKeyDown: (event) => {
                                            if (event.key === 'Enter') {
                                              event.preventDefault()
                                              commitTierPrice(row.model, tier, event.currentTarget.value)
                                            }
                                          },
                                        }),
                                      ),
                                    ),
                                  )
                                : h('input', {
                                    className: 'iw-input iw-cost-price iw-cost-price-flat',
                                    type: 'number',
                                    min: 0,
                                    step: 0.01,
                                    value:
                                      priceDrafts[row.model] !== undefined
                                        ? priceDrafts[row.model]
                                        : String(modelCostFlat(modelCosts[row.model])),
                                    disabled: savingModel === row.model,
                                    title: '每张估计成本（元），保存到设置 modelCosts',
                                    onChange: (event) =>
                                      setPriceDrafts((previous) => ({
                                        ...previous,
                                        [row.model]: event.target.value,
                                      })),
                                    onBlur: (event) => commitFlatPrice(row.model, event.target.value),
                                    onKeyDown: (event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault()
                                        commitFlatPrice(row.model, event.currentTarget.value)
                                      }
                                    },
                                  }),
                            ),
                          )
                        }),
                      ),
                    ),
                  )
                : null,
            ),
      )
    }

