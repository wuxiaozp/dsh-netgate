/**
 * 网闸 · Windows 版 — 浏览器侧。
 *
 * 在输入框上方的 `conversation.composer.dock` 槽位放一条状态条：
 * 点主开关切换「联网开 / 已断网」，断网后可再点「严格模式」连同 shell 一起停用。
 * 状态由 Host 的 `/api/netgate/state` 提供并持久化，页面刷新或重启后保留。
 */

window.__ModuleLoader__.load({
  id: 'dsh-netgate-win',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ENDPOINT = '/api/netgate/state'
    const POLL_MS = 5000

    const styles = {
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 6,
        padding: '2px 4px 6px',
        fontSize: 12,
        lineHeight: '18px',
        userSelect: 'none',
      },
      pill: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '1px 10px',
        borderRadius: 999,
        border: '0.5px solid var(--dsw-alias-border-l2, rgba(120,120,120,0.35))',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #5f6368)',
        font: 'inherit',
        cursor: 'pointer',
      },
      pillOffline: {
        borderColor: 'var(--dsw-alias-border-selected, rgba(240,120,80,0.65))',
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        background: 'var(--dsw-alias-interactive-bg-hover, rgba(120,120,120,0.12))',
      },
      dot: {
        width: 6,
        height: 6,
        borderRadius: 999,
        background: 'currentColor',
        opacity: 0.75,
      },
      chip: {
        padding: '0 8px',
        borderRadius: 999,
        border: '0.5px solid var(--dsw-alias-border-l2, rgba(120,120,120,0.35))',
        background: 'transparent',
        color: 'var(--dsw-alias-label-tertiary, #80868b)',
        font: 'inherit',
        cursor: 'pointer',
      },
      chipOn: {
        color: 'var(--dsw-alias-label-primary, #1f2328)',
        borderColor: 'var(--dsw-alias-border-selected, rgba(240,120,80,0.65))',
      },
    }

    function read() {
      return fetch(ENDPOINT, { headers: { accept: 'application/json' } }).then(response => {
        if (!response.ok) throw new Error(`netgate: ${response.status}`)
        return response.json()
      })
    }

    function write(patch) {
      return fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(patch),
      }).then(response => {
        if (!response.ok) throw new Error(`netgate: ${response.status}`)
        return response.json()
      })
    }

    function Strip() {
      const [state, setState] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [failed, setFailed] = React.useState(false)

      React.useEffect(() => {
        let alive = true
        const tick = () => {
          read()
            .then(next => { if (alive) { setState(next); setFailed(false) } })
            .catch(() => { if (alive) setFailed(true) })
        }
        tick()
        const timer = setInterval(tick, POLL_MS)
        const onFocus = () => tick()
        window.addEventListener('focus', onFocus)
        return () => {
          alive = false
          clearInterval(timer)
          window.removeEventListener('focus', onFocus)
        }
      }, [])

      const offline = state?.offline === true
      const strict = state?.strict === true

      const send = (patch) => {
        if (busy) return
        setBusy(true)
        write(patch)
          .then(next => { setState(next); setFailed(false) })
          .catch(() => setFailed(true))
          .finally(() => setBusy(false))
      }

      const label = state === null
        ? (failed ? '网闸：状态未知 · 点击重试' : '网闸：读取中…')
        : offline ? '联网：已断网 · 点开' : '联网：开 · 点关'

      return h('div', { style: styles.row },
        failed && state !== null ? h('span', {
          style: { color: 'var(--dsw-alias-label-tertiary, #80868b)' },
          title: '最近一次读取失败',
        }, '连接异常') : null,
        offline ? h('button', {
          type: 'button',
          style: { ...styles.chip, ...(strict ? styles.chipOn : null) },
          title: strict ? '严格模式：断网时连 shell 也停用（点击关闭）' : '严格模式：断网时连 shell 也停用（点击开启）',
          disabled: busy,
          onClick: () => send({ toggle: 'strict' }),
        }, strict ? '严格：开' : '严格：关') : null,
        h('button', {
          type: 'button',
          style: { ...styles.pill, ...(offline ? styles.pillOffline : null), opacity: busy ? 0.6 : 1 },
          title: offline ? '点击恢复联网' : '点击切断模型联网（web 工具与联网命令）',
          disabled: busy,
          'aria-pressed': offline,
          onClick: () => send({ toggle: 'offline' }),
        },
          h('span', { style: styles.dot }),
          h('span', null, label)),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // 输入框上方的整行插槽：空白新会话（Hero）里也会渲染，因此还没发第一条消息就能切换。
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'netgate-win-status',
          order: 5,
        }, Strip))
      },
    }
  },
})
