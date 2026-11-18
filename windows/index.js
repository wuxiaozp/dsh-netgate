/**
 * 网闸 · Windows 版 — 主机侧。
 *
 * 三件事：
 * 1. 开关状态持久化在 `$DSH_HOME/netgate-win/state.json`；
 * 2. 断网时用 `ctx.tools.guard()` 拒绝 web 工具与明显的联网命令，并按 agent 用
 *    `ctx.tools.restrict()` 把 web_search / web_fetch 移出工具列表；
 * 3. 用 `ctx.webServer` 注册 `/api/netgate/state`，供输入框上方的状态条读取与切换。
 *
 * Windows 没有 LD_PRELOAD，进程层拦截由沙箱/审批策略承担；本插件负责工具层与命令守卫。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** 需要 tools 服务注册守卫，需要 agents 服务枚举已有会话。 */
export const inject = ['tools', 'agents']

const DSH_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const STATE_FILE = join(DSH_HOME, 'netgate-win', 'state.json')
const ROUTE_PATH = '/api/netgate/state'
const WEB_TOOLS = ['web_search', 'web_fetch']
const RUN_CODE_TOOL = 'run_code'
const SHELL_TOOL = /^(?:bash|pwsh|shell|terminal|zsh|cmd|fish)(?:_|$)/i
const BROWSER_TOOL = /^browser/i

const DENY_WEB = '联网已关闭（网闸 · Windows 版）：web 搜索与网页抓取不可用。需要联网时，请在输入框上方点“联网：已断网”恢复。'
const DENY_STRICT = '联网已关闭且已开启严格模式（网闸 · Windows 版）：本会话不允许执行 shell 命令。'
const DENY_NET = '联网已关闭（网闸 · Windows 版）：该命令看起来会访问网络，已被拒绝。'

/** 命令中出现的联网特征。命中任意一条即拒绝；回环地址单独放行。 */
const NET_PATTERNS = [
  { re: /\b(?:curl|wget|aria2c|httpie|nc|ncat|netcat|telnet|ftp|sftp|scp|ssh|rsync|svn)\b/i, label: '网络命令' },
  { re: /\b(?:Invoke-WebRequest|Invoke-RestMethod|iwr|irm|Start-BitsTransfer|Test-NetConnection|Resolve-DnsName|Register-ObjectEvent)\b/i, label: 'PowerShell 联网命令' },
  { re: /\bgit\s+(?:clone|fetch|pull|push|ls-remote|submodule)\b/i, label: 'Git 远程操作' },
  { re: /\b(?:npm|pnpm|yarn|npx|bun|pip|pip3|poetry|conda|gem|cargo|docker)\b[^\n]*\b(?:install|add|update|upgrade|publish|download|pull|push|restore)\b/i, label: '依赖安装或下载' },
  { re: /\bgo\s+get\b/i, label: 'Go 依赖下载' },
  { re: /\b(?:choco|winget|scoop|apt|apt-get|brew|dnf|yum)\b[^\n]*\b(?:install|upgrade|update|search)\b/i, label: '软件包安装' },
  { re: /\b(?:urllib|requests|httpx|aiohttp|urlopen|http\.client|socketserver)\b/i, label: 'Python 联网' },
  { re: /(?:require\(['"](?:https?|net|dns|tls)['"]\)|fetch\s*\(|XMLHttpRequest|WebSocket\s*\()/i, label: 'Node/浏览器联网 API' },
  { re: /\b(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\b|--proxy\b/i, label: '代理设置' },
  { re: /\b(?:bitsadmin|certutil|mshta|rundll32|wsl|plink|putty|yt-dlp)\b/i, label: 'Windows 下载/远程工具' },
  { re: /\b(?:New-Object|CreateObject)\b[^\n]*\b(?:Net\.|WScript\.Shell)/i, label: 'COM/.NET 联网对象' },
  { re: /\b(?:WebClient|HttpClient|DownloadString|DownloadFile|UploadString|UploadFile)\b/i, label: '.NET HTTP 客户端' },
  { re: /\b(?:Invoke-Expression|iex|Invoke-Command|Start-Job)\b/i, label: 'PowerShell 动态执行' },
]

/** 只对 http(s) 客户端生效的特征：目标是回环地址时放行（本地开发服务器照常可用）。 */
const HTTP_CLIENT_LABELS = new Set(['网络命令', 'PowerShell 联网命令'])
/** 命令里出现的 http(s) URL。 */
const URL_PATTERN = /https?:\/\/[^\s'"]+/gi
/** 没有完整 URL 时，仍能说明目标是本机的写法。 */
const LOOPBACK_HINT = /(?:\b127(?:\.\d{1,3}){3}\b|\blocalhost\b|\[::1\])/i

/** 该 URL 是否指向本机回环地址。 */
function isLoopbackUrl(raw) {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return host === 'localhost' || host === '[::1]' || host === '::1' || /^127\./.test(host)
  } catch {
    return false
  }
}

/** 当前开关。offline = 断网；strict = 严格模式（断网时连 shell 也停用）。 */
const state = { offline: false, strict: false }

/** 已注册的按 agent 限制：agent -> 撤销函数。 */
const restrictions = new Map()
/** 存活的 agent，用于切换时补挂或撤销限制。 */
const agents = new Set()

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'))
    state.offline = parsed.offline === true
  } catch {
    // 首次运行或文件损坏都回到默认：联网开启。
  }
  // 严格模式是临时状态：重载或重启后回到关闭，避免把自己锁在门外。
  state.strict = false
}

async function saveState() {
  await mkdir(dirname(STATE_FILE), { recursive: true })
  const temp = `${STATE_FILE}.tmp`
  await writeFile(temp, `${JSON.stringify({ offline: state.offline }, null, 2)}\n`, 'utf8')
  await rename(temp, STATE_FILE)
}

/** 取出一次 shell 调用里真正会执行的命令文本。 */
function commandText(args) {
  if (typeof args === 'string') return args
  if (args === null || typeof args !== 'object') return ''
  const parts = []
  for (const key of ['command', 'cmd', 'script', 'input', 'lines', 'commands', 'code', 'source', 'program']) {
    const value = args[key]
    if (typeof value === 'string') parts.push(value)
    else if (Array.isArray(value)) parts.push(value.filter(item => typeof item === 'string').join('\n'))
  }
  return parts.join('\n')
}

/** 命中第一条联网特征，返回其原因；否则 undefined。 */
function networkHit(text) {
  const urls = text.match(URL_PATTERN) ?? []
  if (urls.some(url => !isLoopbackUrl(url))) return '非回环地址'
  const localOnly = urls.length > 0 || LOOPBACK_HINT.test(text)
  for (const { re, label } of NET_PATTERNS) {
    if (localOnly && HTTP_CLIENT_LABELS.has(label)) continue
    if (re.test(text)) return label
  }
  return undefined
}

/** 全局守卫：断网状态与开关实时相关，因此读闭包里的 state。 */
function guard(exec) {
  if (!state.offline) return undefined
  const tool = exec.name
  if (WEB_TOOLS.includes(tool) || BROWSER_TOOL.test(tool)) return DENY_WEB
  if (SHELL_TOOL.test(tool) || tool === RUN_CODE_TOOL) {
    if (state.strict) return DENY_STRICT
    const hit = networkHit(commandText(exec.arguments))
    if (hit !== undefined) return `${DENY_NET}（命中：${hit}）`
  }
  return undefined
}

/** 某个 agent 上挂 web 工具限制；工具没挂载时跳过。 */
function restrictAgent(agent) {
  if (restrictions.has(agent)) return
  const disposers = []
  for (const tool of WEB_TOOLS) {
    try {
      disposers.push(agent.ctx.tools.restrict({ deny: [tool] }))
    } catch {
      // 该 agent 的 preset 里没有这个工具，或者它由 agent 作用域注册、无法按 agent 屏蔽。
    }
  }
  if (disposers.length === 0) return
  restrictions.set(agent, () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // agent 已释放，忽略。
      }
    }
  })
}

function liftRestriction(agent) {
  const dispose = restrictions.get(agent)
  if (dispose === undefined) return
  restrictions.delete(agent)
  dispose()
}

function syncRestrictions(ctx) {
  if (state.offline) {
    for (const agent of [...agents, ...knownAgents(ctx)]) {
      agents.add(agent)
      restrictAgent(agent)
    }
    return
  }
  for (const agent of [...restrictions.keys()]) liftRestriction(agent)
}

/** agents 服务里当前已知的 agent；服务尚未就绪时返回空数组。 */
function knownAgents(ctx) {
  try {
    const list = ctx.agents?.list
    return typeof list === 'function' ? list.call(ctx.agents) : []
  } catch {
    return []
  }
}

/** 同源检查：带 Origin 的请求必须与 Host 一致；没有 Origin 的本机客户端放行。 */
function sameOrigin(req) {
  const origin = req.headers?.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = req.headers?.host
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** 读取 POST 的 JSON 体，限制 8 KiB。 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 8192) throw new Error('body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * 安装插件。
 * @param ctx - Host 上下文。
 */
export async function apply(ctx) {
  await loadState()
  const host = ctx

  ctx.tools.guard(guard)

  // 安装前就存在的会话也要覆盖：插件通常是在会话中途启用的。
  for (const agent of knownAgents(ctx)) {
    agents.add(agent)
    if (state.offline) restrictAgent(agent)
  }

  const offCreated = ctx.on('agent/created', ({ agent }) => {
    agents.add(agent)
    if (state.offline) restrictAgent(agent)
  })
  const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
    agents.delete(agent)
    restrictions.delete(agent)
  })

  ctx.effect(() => () => {
    offCreated()
    offDisposed()
    for (const agent of [...restrictions.keys()]) liftRestriction(agent)
    agents.clear()
  }, 'netgate-win: agents')

  ctx.inject(['systemPrompt'], (ctx) => {
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'netgate-win',
      order: 80,
      text: () => state.offline
        ? '【网闸】联网已关闭：web_search 与 web_fetch 不可用，联网命令会被拒绝。请用本地文件、编译与测试推进工作，不要尝试绕过。'
        : '',
    }), 'netgate-win: prompt')
  })

  ctx.inject(['webServer'], (ctx) => {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (req, res) => {
        const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
        try {
          if (req.method === 'GET' || req.method === 'HEAD') {
            res.writeHead(200, headers)
            res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ...state }))
            return
          }
          if (!sameOrigin(req)) {
            res.writeHead(403, headers)
            res.end(JSON.stringify({ error: 'cross-origin request refused' }))
            return
          }
          if (req.method !== 'POST') {
            res.writeHead(405, headers)
            res.end(JSON.stringify({ error: 'method not allowed' }))
            return
          }
          const body = await readJsonBody(req)
          if (typeof body.offline === 'boolean') state.offline = body.offline
          if (typeof body.strict === 'boolean') state.strict = body.strict
          if (body.toggle === 'offline') state.offline = !state.offline
          if (body.toggle === 'strict') state.strict = !state.strict
          syncRestrictions(host)
          await saveState()
          res.writeHead(200, headers)
          res.end(JSON.stringify({ ...state }))
        } catch (error) {
          res.writeHead(400, headers)
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
    }), 'netgate-win: state route')
  })
}

