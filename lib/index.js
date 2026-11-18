// local-web-toggle — a real on/off switch for internet access.
//
// Hiding `web_search` / `web_fetch` is not enough: with `bash` available a
// model can reach the network with curl / wget / python urllib (and a command
// regex alone is beaten by writing a script first). So the switch works at
// three levels:
//
//   1. removes `web_search` / `web_fetch` from every agent's tool list,
//   2. installs a tool guard that refuses obvious network commands and
//      model-initiated browser opens (fast, clear refusal), and
//   3. flips on a process-level block: `/usr/local/bin/bash` loads
//      netguard.so through LD_PRELOAD while the lock file exists, and that
//      library refuses every non-loopback connect()/sendto(). Coding keeps
//      working; no shell child — curl, python, node, git, anything — can open
//      an outbound connection, including inside scripts.
//
// Turning the switch back on lifts all three.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-netgate'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STATE_DIR = join(HOME, 'dsh-go')
const STATE_PATH = join(STATE_DIR, 'netgate.json')
const NETGUARD_LIB = join(STATE_DIR, 'netguard', 'netguard.so')
const NETGUARD_LOCK = join(STATE_DIR, 'netguard.lock')
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BUNDLED_LIB = join(PLUGIN_ROOT, 'netguard', 'netguard.so')
const BASH_WRAPPER = '/usr/local/bin/bash'
const WRAPPER_MARKER = '# dsh-netguard wrapper'

const WRAPPER_BODY = `#!/bin/sh
${WRAPPER_MARKER}: when the web switch is off, load the connect() guard into
# this shell and everything it spawns.
H=\${DSH_HOME:-\$HOME/.dsh}
G="\$H/dsh-go/netguard/netguard.so"
L="\$H/dsh-go/netguard.lock"
if [ -f "\$L" ] && [ -f "\$G" ]; then
  DSH_NETGUARD_LOCK="\$L"
  LD_PRELOAD="\$G\${LD_PRELOAD:+:\$LD_PRELOAD}"
  export DSH_NETGUARD_LOCK LD_PRELOAD
fi
if [ -x /usr/bin/bash ]; then exec /usr/bin/bash "\$@"; fi
exec /bin/bash "\$@"
`

const WEB_TOOLS = ['web_search', 'web_fetch']
const SHELL_TOOLS = ['bash', 'mcp__phone__android_shell']

// Commands / snippets that reach the network. Deliberately broad: while the
// switch is off a false positive costs one "turn it on first" reply, while a
// miss costs a silent search.
const NETWORK_HINT = new RegExp(
  [
    '\\b(curl|wget|nc|ncat|netcat|socat|telnet|ftp|tftp|ssh|scp|sftp|rsync|dig|nslookup|host|ping|ping6|traceroute|tracepath|aria2c|httpie|w3m|lynx|links2?)\\b',
    '\\bhttp\\b|https?:\\/\\/|\\/dev\\/(tcp|udp)\\/',
    '\\b(urllib|urlopen|requests\\.|httpx|aiohttp|http\\.client|socket\\.|dns\\.|net\\.connect|tls\\.connect|fetch\\s*\\(|axios|got\\s*\\()',
    '\\b(git\\s+(clone|fetch|pull|push|ls-remote)|npm\\s+(i|install|add|update)|pnpm\\s+(i|install|add|update)|yarn\\s+(install|add)|pip3?\\s+(install|download)|apt-get|apt\\s+install|apk\\s+(add|update)|go\\s+get|gem\\s+install|cargo\\s+install)\\b',
    'LD_PRELOAD|LD_AUDIT|ld\\.so\\.preload|DSH_NETGUARD',
    '\\benv\\s+(-i|--ignore-environment|-)',
  ].join('|'),
  'i',
)

const LOCK_MESSAGE =
  '联网已关闭：这条操作需要联网。先点输入框上方的「联网」打开。 / Web access is off — turn the switch on first.'

function loadState() {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    if (typeof raw.online === 'boolean') return { online: raw.online, strict: raw.strict === true }
    // Legacy shape: { search, fetch } from the first version.
    return { online: raw.search !== false && raw.fetch !== false, strict: false }
  } catch {
    return { online: true, strict: false }
  }
}

function saveState(state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(STATE_PATH, `${JSON.stringify({ online: state.online, strict: state.strict }, null, 2)}\n`)
  } catch {
    // A read-only home only loses persistence, not the live switch.
  }
}

// A market install never runs install.sh, so the bundled library is copied into
// the host directory the wrapper reads from.
function ensureNetguardLib() {
  try {
    if (existsSync(NETGUARD_LIB)) return true
    if (!existsSync(BUNDLED_LIB)) return false
    mkdirSync(join(STATE_DIR, 'netguard'), { recursive: true })
    copyFileSync(BUNDLED_LIB, NETGUARD_LIB)
    chmodSync(NETGUARD_LIB, 0o755)
    return true
  } catch {
    return false
  }
}

// The bash on PATH is the wrapper below; it loads netguard.so into every shell
// this host starts, so a command written into a script is blocked too.
function ensureWrapper() {
  try {
    let current = ''
    try {
      current = readFileSync(BASH_WRAPPER, 'utf8')
    } catch {}
    if (current === WRAPPER_BODY) return true
    // Never clobber a file someone else put there.
    if (current !== '' && !current.includes(WRAPPER_MARKER)) return false
    writeFileSync(BASH_WRAPPER, WRAPPER_BODY, { mode: 0o755 })
    return true
  } catch {
    return false
  }
}

function setNetguard(on) {
  try {
    if (on) {
      if (!existsSync(NETGUARD_LIB)) return false
      mkdirSync(join(STATE_DIR, 'netguard'), { recursive: true })
      writeFileSync(NETGUARD_LOCK, '')
      return true
    }
    if (existsSync(NETGUARD_LOCK)) unlinkSync(NETGUARD_LOCK)
    return true
  } catch {
    return false
  }
}

function isZh(locale) {
  return !String(locale ?? '').startsWith('en')
}

export function apply(ctx) {
  const state = loadState()
  const emitters = new Set()
  const locks = new Map()
  const libOk = ensureNetguardLib()
  const wrapperOk = ensureWrapper()
  setNetguard(!state.online)

  const stripText = (locale) => {
    const zh = isZh(locale)
    if (state.online) return zh ? '联网：开 · 点设置' : 'Web: on · tap setup'
    return state.strict
      ? (zh ? '联网：全锁 · 点设置' : 'Web: locked · tap setup')
      : (zh ? '联网：已断网 · 点设置' : 'Web: blocked · tap setup')
  }

  const panelData = (locale) => ({
    online: state.online ? (isZh(locale) ? '开' : 'On') : (isZh(locale) ? '关' : 'Off'),
    strict: state.strict ? (isZh(locale) ? '开' : 'On') : (isZh(locale) ? '关' : 'Off'),
  })

  const listAgents = () => {
    try {
      return ctx.get('agents')?.list() ?? []
    } catch {
      return []
    }
  }

  const toolsOf = (agent) => {
    const agentCtx = agent?.ctx
    if (!agentCtx) return undefined
    try {
      const tools = agentCtx.tools
      if (tools && typeof tools.restrict === 'function') return tools
    } catch {}
    try {
      const tools = agentCtx.get?.('tools')
      if (tools && typeof tools.restrict === 'function') return tools
    } catch {}
    return undefined
  }

  const guard = (exec) => {
    const tool = exec?.name
    if (typeof tool !== 'string') return undefined
    if (WEB_TOOLS.includes(tool)) return LOCK_MESSAGE
    if (SHELL_TOOLS.includes(tool)) {
      const command = String(exec?.arguments?.command ?? '')
      return NETWORK_HINT.test(command) ? LOCK_MESSAGE : undefined
    }
    if (tool === 'mcp__phone__open') {
      const url = String(exec?.arguments?.url ?? '')
      return /^https?:\/\//i.test(url) ? LOCK_MESSAGE : undefined
    }
    return undefined
  }

  const plan = () => {
    if (state.online) return { deny: [], guarded: false }
    return {
      deny: state.strict ? [...WEB_TOOLS, ...SHELL_TOOLS] : [...WEB_TOOLS],
      guarded: true,
    }
  }

  const lift = (id) => {
    const record = locks.get(id)
    if (record === undefined) return
    locks.delete(id)
    for (const dispose of record.disposers) {
      try {
        dispose()
      } catch {}
    }
  }

  const applyTo = (agent) => {
    if (!agent?.id) return
    const tools = toolsOf(agent)
    if (tools === undefined) return
    const wanted = plan()
    const key = `${wanted.deny.join(',')}|${wanted.guarded ? 'guard' : '-'}`
    const previous = locks.get(agent.id)
    if (previous !== undefined && previous.key === key) return
    lift(agent.id)

    const disposers = []
    let known
    try {
      known = tools.view(agent)?.restrictableNames
    } catch {}
    const names = wanted.deny.filter((tool) => typeof known?.has === 'function' && known.has(tool))
    if (names.length > 0) {
      try {
        disposers.push(tools.restrict({ deny: names }))
      } catch {}
    }
    if (wanted.guarded) {
      try {
        disposers.push(tools.guard(guard))
      } catch {}
    }
    if (disposers.length > 0) locks.set(agent.id, { key, disposers })
  }

  const applyAll = () => {
    for (const agent of listAgents()) applyTo(agent)
  }

  const pushStrip = () => {
    for (const entry of emitters) {
      try {
        entry.send()
      } catch {}
    }
  }

  const changed = () => {
    saveState(state)
    setNetguard(!state.online)
    applyAll()
    pushStrip()
  }

  // Restriction and guard effects live on each agent's fiber; lifting them on
  // unload keeps a plugin removal from leaving the internet blocked forever.
  ctx.effect(() => () => {
    for (const id of [...locks.keys()]) lift(id)
    setNetguard(false)
  }, 'dsh-netgate: lift locks on unload')

  ctx.inject(['dshGo'], (goCtx) => {
    goCtx.dshGo.strip('web-state', (scope, emit, caps) => {
      const entry = { send: () => emit({ text: stripText(caps?.locale), tone: state.online ? 'info' : 'warn' }) }
      emitters.add(entry)
      entry.send()
      return () => emitters.delete(entry)
    })

    goCtx.dshGo.panel('web', {
      view: (scope, caps) => {
        const zh = isZh(caps?.locale)
        const guardUp = libOk && wrapperOk && existsSync(NETGUARD_LIB)
        return {
          type: 'stack',
          title: zh ? '网闸 · 基础版' : 'NetGate · Basic',
          children: [
            {
              type: 'callout',
              tone: state.online ? 'good' : 'warn',
              text: state.online
                ? (zh ? '联网开着：可以搜索、抓取网页，命令也能联网。' : 'On: search, fetch and networked commands work.')
                : (zh ? '联网已关：搜索和抓取工具已移除，所有命令进程都连不上外网。本地编辑通常照常，编译、装包等联网步骤可能失败。' : 'Off: web tools removed; every command process is cut off. Local editing usually works; networked builds may fail.'),
            },
            {
              type: 'list',
              items: [
                {
                  title: zh ? '联网总开关' : 'Web access',
                  subtitle: zh ? '关掉后搜索、抓取、命令联网全禁' : 'Blocks search, fetch and networked commands',
                  trailing: { $: 'data.online' },
                  action: 'toggle-online',
                },
              ],
            },
            {
              type: 'keyValue',
              items: [
                [zh ? '版本' : 'Edition', zh ? '网闸 · 基础版 0.2.0' : 'NetGate · Basic 0.2.0'],
                [zh ? '进程级断网' : 'Process-level block', guardUp ? (zh ? '已就绪' : 'ready') : (zh ? '缺失' : 'missing')],
                ...(state.online ? [] : [[zh ? '严格模式' : 'Strict mode', state.strict ? (zh ? '开' : 'on') : (zh ? '关' : 'off')]]),
                [zh ? '命令行' : 'Shell', state.strict && !state.online ? (zh ? '已停用' : 'off') : (zh ? '可用' : 'on')],
              ],
            },
            ...(state.online ? [] : [
              {
                type: 'callout',
                tone: state.strict ? 'bad' : 'info',
                text: state.strict
                  ? (zh ? '严格模式已开：bash 与手机 shell 都停用，模型不能执行任何命令。' : 'Strict mode is on: bash and the phone shell are removed, so the model cannot run commands.')
                  : (zh ? '想再狠一点就开严格模式：连 bash 和手机 shell 一起停用，模型连写代码的能力也没有。' : 'Want it stricter? Turn on strict mode: bash and the phone shell are removed too.'),
              },
              {
                type: 'actions',
                items: [
                  {
                    label: state.strict ? (zh ? '关闭严格模式' : 'Turn strict off') : (zh ? '开启严格模式' : 'Turn strict on'),
                    action: 'toggle-strict',
                  },
                ],
              },
            ]),
            {
              type: 'text',
              tone: 'muted',
              text: zh
                ? '关闭时 bash 派生的任何进程（curl、python、node、git、装包）都连不上外网，把命令写进脚本也一样；搜索和抓取工具同时从工具列表移除。本地文件操作照常；编译、装包、跑测试等需要联网的环节可能失败。改动立即生效，重开 App 也保留。'
                : 'While off, every process bash starts — curl, python, node, git, package installs, even from a script — cannot reach the network, and the web tools leave the tool list. Local files, builds and tests still work. Applies immediately and survives restarts.',
            },
            {
              type: 'actions',
              items: [
                {
                  label: state.online ? (zh ? '关闭联网' : 'Turn web off') : (zh ? '打开联网' : 'Turn web on'),
                  action: 'toggle-online',
                  style: 'primary',
                },
              ],
            },
          ],
        }
      },
      data: (scope, emit, caps) => {
        const send = () => emit(panelData(caps?.locale))
        send()
        return () => {}
      },
      actions: {
        'toggle-online': () => {
          state.online = !state.online
          changed()
          return {
            patch: panelData(),
            toast: state.online ? '联网已打开' : '联网已关闭，命令进程已断网',
          }
        },
        'toggle-strict': () => {
          state.strict = !state.strict
          changed()
          return {
            patch: panelData(),
            toast: state.strict ? '严格模式已开：命令行已停用' : '严格模式已关',
          }
        },
      },
    })

    // Tap on the strip: master switch.
    goCtx.dshGo.on('web-state', (scope, event) => {
      state.online = !state.online
      changed()
      const zh = isZh(event?.locale)
      return {
        toast: state.online
          ? (zh ? '联网已打开' : 'Web access on')
          : (zh ? '联网已关闭，命令联网也一并拦下' : 'Web access off'),
      }
    })

    goCtx.on('agent/created', ({ agent }) => applyTo(agent))
    goCtx.on('agent/disposed', ({ agent }) => lift(agent?.id))

    setTimeout(applyAll, 0)

    // Throwaway field check (enabled by creating $DSH_HOME/dsh-go/web-toggle.selftest
    // before the engine loads the plugin). Writes /tmp/dsh-web-toggle-selftest.json.
    if (existsSync(join(STATE_DIR, 'web-toggle.selftest'))) {
      setTimeout(() => runSelftest(), 4000)
    }

    function runSelftest() {
      const report = { at: new Date().toISOString(), rows: [] }
      const agent = listAgents()[0]
      if (agent === undefined) {
        report.rows.push({ error: 'no live agent' })
      } else {
        const tools = toolsOf(agent)
        const check = (name, args) => {
          try {
            return tools.checkGuards({ name, agent, arguments: args }) !== undefined
          } catch (error) {
            return `error: ${String(error?.message ?? error)}`
          }
        }
        const remember = { online: state.online, strict: state.strict }
        const view = () => tools.view(agent).visible

        report.rows.push({
          scenario: 'initial',
          online: state.online,
          strict: state.strict,
          webVisible: view().has('web_search'),
          bashVisible: view().has('bash'),
        })

        state.online = false
        state.strict = false
        changed()
        report.rows.push({
          scenario: 'locked',
          webHidden: !view().has('web_search') && !view().has('web_fetch'),
          bashVisible: view().has('bash'),
          netguardLock: existsSync(NETGUARD_LOCK),
          deniesCurl: check('bash', { command: 'curl https://www.baidu.com' }),
          deniesPython: check('bash', { command: "python3 -c 'import urllib.request'" }),
          deniesUrl: check('bash', { command: 'echo https://example.com' }),
          deniesClone: check('bash', { command: 'git clone https://x/y.git' }),
          deniesEnvTrick: check('bash', { command: 'LD_PRELOAD= curl https://x' }),
          allowsLs: !check('bash', { command: 'ls -la /root' }),
          deniesPhoneOpen: check('mcp__phone__open', { url: 'https://www.baidu.com' }),
        })

        state.online = false
        state.strict = true
        changed()
        report.rows.push({
          scenario: 'strict',
          webHidden: !view().has('web_search'),
          bashHidden: !view().has('bash'),
          shellHidden: !view().has('mcp__phone__android_shell'),
        })

        state.online = true
        state.strict = false
        changed()
        report.rows.push({
          scenario: 'online',
          webVisible: view().has('web_search') && view().has('web_fetch'),
          bashVisible: view().has('bash'),
          netguardLock: existsSync(NETGUARD_LOCK),
          guardOff: !check('bash', { command: 'curl https://www.baidu.com' }),
        })

        state.online = remember.online
        state.strict = remember.strict
        changed()
      }
      try {
        writeFileSync('/tmp/dsh-web-toggle-selftest.json', `${JSON.stringify(report, null, 2)}\n`)
      } catch {}
    }
  })
}
