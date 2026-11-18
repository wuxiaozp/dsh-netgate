# 网闸 · Windows 版

网闸（NetGate）在 Windows 上的等价实现。原版是 dsh-go 的 Linux/arm64 原生插件，靠
`/usr/local/bin/bash` 包装器和 `LD_PRELOAD=netguard.so` 在进程层拦截 `connect()`；
Windows 没有这两样东西，因此这一版改用 Harness 自带的扩展点实现同样意图的开关。

## 断网时发生什么

| 层 | 关闭后的行为 |
|---|---|
| 工具层 | 新会话 / 子代理的 `web_search`、`web_fetch` 从工具列表移除（`ctx.tools.restrict()`）；已在运行的对话可能到下一轮才消失，期间靠守卫层拒绝 |
| 守卫层 | 已发出的 web 工具调用被拒绝；`bash` / `pwsh` 命令命中联网特征时在执行前被拒绝（`ctx.tools.guard()`） |
| 严格模式 | 断网期间连同 `bash` / `pwsh` 一起停用，只剩本地读写类工具 |

守卫识别的联网特征包括 `curl`、`wget`、`ssh`、`scp`、`Invoke-WebRequest` / `Invoke-RestMethod`、`bitsadmin`、`certutil -urlcache`、`mshta`、`wsl`、
`Test-NetConnection`、`git clone/pull/push`、`npm/pnpm/pip/… install`、命令里出现非回环的
`http(s)://` 地址、Python 的 `urllib`/`requests`/`socket`、Node 的 `fetch()`/`require('http')`、`.NET` 的 `WebClient`/`HttpClient`/`DownloadString`，
以及代理环境变量。**回环地址（`127.0.0.1`、`localhost`、`::1`）放行**，本地开发服务器、
测试与 DSH 自己的本地接口照常可用。

打开开关后一切恢复；`offline` 状态保存在 `$DSH_HOME/netgate-win/state.json`，重启保留。
**严格模式是临时状态**：DSH 重载或重启后自动回到关闭，避免把自己锁在门外。

## 使用

输入框上方有一条状态条：

- 主开关：「联网：开 · 点关」↔「联网：已断网 · 点开」，立即生效；
- 断网后出现「严格：关 / 开」小按钮，切换严格模式。

## 验证

断网后让模型跑一条联网命令，例如 `curl -I https://example.com`，应看到
「联网已关闭（网闸 · Windows 版）：该命令看起来会访问网络，已被拒绝」；新建会话或子代理
看不到 `web_search` / `web_fetch`。点开关恢复后同样的命令应能执行。

## 限制

- **没有进程层拦截。** Windows 没有 `LD_PRELOAD`，插件无法给已启动的进程装网络钩子。
  真正在系统层面断网要依靠 DSH 的沙箱与审批策略；本插件保证的是「模型能发起的联网动作」
  （web 工具 + 命令）被拦住，而不是操作系统级别的出网隔离。
- **静态字符串匹配**会被等价改写绕过（例如把 URL 拼起来再传给 `curl`）。这是守卫层的
  固有限制，与「记录每条命令再人工复核」不是一回事。
- `run_code`（PTC）与 `terminal` 也在守卫范围内；
- **只影响本插件的开关**，不改变其他插件的注册；卸载插件即恢复原状。
- 电脑上没装 Git 时，任何 Git 来源的插件都装不了；本条与本插件无关，只是安装过程的常见坑。

## 数据位置

- 开关状态：`$DSH_HOME/netgate-win/state.json`
- 控制端点：`GET/POST /api/netgate/state`（仅本机 Web GUI 使用）
