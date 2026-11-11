    /* ------------------------------------------------------------------ */
    /* Icons (inline SVG, no external assets)                              */
    /* ------------------------------------------------------------------ */

    function Icon(props) {
      const name = str(props && props.name)
      const size = num(props && props.size, 14)
      const className = props && props.className
      const common = {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        className: className || undefined,
        'aria-hidden': 'true',
        focusable: 'false',
      }
      const strokeWidth = num(props && props.strokeWidth, name === 'arrowUp' ? 2 : 1.4)
      const strokeProps = { stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' }

      if (name === 'plus') {
        return h('svg', common, h('path', { d: 'M8 3.1 V12.9 M3.1 8 H12.9', ...strokeProps }))
      }
      if (name === 'x') {
        return h('svg', common, h('path', { d: 'M4.2 4.2 L11.8 11.8 M11.8 4.2 L4.2 11.8', ...strokeProps }))
      }
      if (name === 'trash') {
        return h('svg', common,
          h('path', { d: 'M2.9 4.5 H13.1', ...strokeProps }),
          h('path', { d: 'M6.3 4.5 V3.1 H9.7 V4.5', ...strokeProps }),
          h('path', { d: 'M4.2 4.5 L4.9 12.7 A1 1 0 0 0 5.9 13.5 H10.1 A1 1 0 0 0 11.1 12.7 L11.8 4.5', ...strokeProps }),
          h('path', { d: 'M6.6 7.1 V10.9 M9.4 7.1 V10.9', ...strokeProps }))
      }
      if (name === 'pencil') {
        return h('svg', common,
          h('path', { d: 'M2.7 13.3 L3.3 10.6 L10.6 3.3 L12.7 5.4 L5.4 12.7 Z', ...strokeProps }))
      }
      if (name === 'gear') {
        return h('svg', common,
          h('circle', { cx: 8, cy: 8, r: 2.2, ...strokeProps }),
          h('path', { d: 'M8 2.2 V3.6 M8 12.4 V13.8 M2.2 8 H3.6 M12.4 8 H13.8 M3.9 3.9 L4.9 4.9 M11.1 11.1 L12.1 12.1 M12.1 3.9 L11.1 4.9 M4.9 11.1 L3.9 12.1', ...strokeProps }))
      }
      if (name === 'open') {
        return h('svg', common,
          h('path', { d: 'M9.4 3.2 H12.8 V6.6', ...strokeProps }),
          h('path', { d: 'M12.8 3.2 L8 8', ...strokeProps }),
          h('path', { d: 'M12.2 9.4 V12 A1 1 0 0 1 11.2 13 H4 A1 1 0 0 1 3 12 V4.8 A1 1 0 0 1 4 3.8 H6.6', ...strokeProps }))
      }
      if (name === 'download') {
        return h('svg', common,
          h('path', { d: 'M8 2.9 V10.1', ...strokeProps }),
          h('path', { d: 'M4.8 7 L8 10.2 L11.2 7', ...strokeProps }),
          h('path', { d: 'M2.9 10.6 V12.4 A1 1 0 0 0 3.9 13.4 H12.1 A1 1 0 0 0 13.1 12.4 V10.6', ...strokeProps }))
      }
      if (name === 'chart') {
        return h('svg', common,
          h('path', { d: 'M2.8 13 H13.2', ...strokeProps }),
          h('path', { d: 'M4.4 13 V8.2 M8 13 V4.2 M11.6 13 V6.4', ...strokeProps }))
      }
      if (name === 'folder') {
        return h('svg', common,
          h('path', { d: 'M2.5 4.4 A1.1 1.1 0 0 1 3.6 3.3 H6.1 L7.4 4.7 H12.4 A1.1 1.1 0 0 1 13.5 5.8 V11.6 A1.1 1.1 0 0 1 12.4 12.7 H3.6 A1.1 1.1 0 0 1 2.5 11.6 Z', ...strokeProps }))
      }
      if (name === 'chevronDown') {
        return h('svg', common, h('path', { d: 'M4 6.2 L8 10.2 L12 6.2', ...strokeProps }))
      }
      if (name === 'chevronRight') {
        return h('svg', common, h('path', { d: 'M6.2 4 L10.2 8 L6.2 12', ...strokeProps }))
      }
      if (name === 'dots') {
        return h('svg', common,
          h('circle', { cx: 3.3, cy: 8, r: 1.15, fill: 'currentColor' }),
          h('circle', { cx: 8, cy: 8, r: 1.15, fill: 'currentColor' }),
          h('circle', { cx: 12.7, cy: 8, r: 1.15, fill: 'currentColor' }))
      }
      if (name === 'refresh') {
        return h('svg', common,
          h('path', { d: 'M13.1 8 A5.1 5.1 0 1 1 11.5 4.2', ...strokeProps }),
          h('path', { d: 'M13.3 2.5 V5.7 H10.1', ...strokeProps }))
      }
      if (name === 'arrowUp') {
        return h('svg', common,
          h('path', { d: 'M8 12.9 V3.3', ...strokeProps }),
          h('path', { d: 'M4.3 7 L8 3.3 L11.7 7', ...strokeProps }))
      }
      if (name === 'stop') {
        return h('svg', common, h('rect', { x: 4.5, y: 4.5, width: 7, height: 7, rx: 1.3, fill: 'currentColor' }))
      }
      if (name === 'image') {
        return h('svg', common,
          h('rect', { x: 2.4, y: 3.1, width: 11.2, height: 9.8, rx: 1.6, ...strokeProps }),
          h('circle', { cx: 5.8, cy: 6.4, r: 1.05, fill: 'currentColor' }),
          h('path', { d: 'M3.1 11.9 L6.7 8.4 L8.8 10.4 L10.8 8.5 L13 10.6', ...strokeProps }))
      }
      if (name === 'upload') {
        return h('svg', common,
          h('path', { d: 'M8 10.4 V2.9', ...strokeProps }),
          h('path', { d: 'M4.8 6.1 L8 2.9 L11.2 6.1', ...strokeProps }),
          h('path', { d: 'M2.9 10.1 V12.4 A1 1 0 0 0 3.9 13.4 H12.1 A1 1 0 0 0 13.1 12.4 V10.1', ...strokeProps }))
      }
      if (name === 'alert') {
        return h('svg', common,
          h('circle', { cx: 8, cy: 8, r: 5.9, ...strokeProps }),
          h('path', { d: 'M8 4.7 V8.7', ...strokeProps }),
          h('circle', { cx: 8, cy: 11.2, r: 0.85, fill: 'currentColor' }))
      }
      if (name === 'check') {
        return h('svg', common, h('path', { d: 'M3.3 8.4 L6.5 11.6 L12.8 4.9', ...strokeProps }))
      }
      if (name === 'copy') {
        return h('svg', common,
          h('rect', { x: 5.4, y: 5.4, width: 7.3, height: 7.3, rx: 1.2, ...strokeProps }),
          h('path', { d: 'M10.6 5.4 V4 A1.2 1.2 0 0 0 9.4 2.8 H4 A1.2 1.2 0 0 0 2.8 4 V9.4 A1.2 1.2 0 0 0 4 10.6 H5.4', ...strokeProps }))
      }
      if (name === 'spark') {
        return h('svg', common,
          h('path', { d: 'M8 2.2 L9.3 6.1 L13.2 7.4 L9.3 8.7 L8 12.6 L6.7 8.7 L2.8 7.4 L6.7 6.1 Z', fill: 'currentColor' }))
      }
      if (name === 'message') {
        return h('svg', common,
          h('path', { d: 'M2.6 5.1 A1.7 1.7 0 0 1 4.3 3.4 H11.7 A1.7 1.7 0 0 1 13.4 5.1 V9.4 A1.7 1.7 0 0 1 11.7 11.1 H6.2 L3.3 13.3 V11.1 A1.7 1.7 0 0 1 2.6 9.9 Z', ...strokeProps }))
      }
      return h('svg', common, h('circle', { cx: 8, cy: 8, r: 5.4, ...strokeProps }))
    }

    let sidebarEntryLogged = false

    function StudioIcon(props) {
      useEffect(() => {
        if (sidebarEntryLogged) return
        sidebarEntryLogged = true
        reportLog('info', `sidebar entry mounted build=${BUILD}`)
      }, [])
      const size = num(props && props.size, 18)
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 3, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('circle', { cx: 9, cy: 10, r: 1.8, fill: 'currentColor' }),
        h('path', {
          d: 'M5 17.2l4.6-4.3a1.3 1.3 0 0 1 1.8 0l3.1 2.9 2.1-1.9a1.3 1.3 0 0 1 1.8 0l1.6 1.5',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M18.4 2.2l.45 1.2 1.2.45-1.2.45-.45 1.2-.45-1.2-1.2-.45 1.2-.45z',
          fill: 'currentColor',
        }),
      )
    }

