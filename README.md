# 网闸 · NetGate

**A dsh-go native plugin: one switch that cuts the model off from the internet — without breaking coding.**

[中文](#中文) · [English](#english)

---

## 中文

给 dsh-go 对话加一个「联网总开关」。关掉后，模型不只是"没有联网搜索工具"，而是
**真的连不出去**；打开后一切恢复。

### 为什么需要它

DSH 里 `web_search` / `web_fetch` 挂在每个会话的 preset 上，没有开关。更麻烦的是：
只把这两个工具藏起来并不够——模型会改用 `bash` + `curl` / `python urllib` 自己抓。
这个插件把三层一起关掉：

| 层 | 关掉时发生什么 |
|---|---|
| 工具层 | `web_search`、`web_fetch` 从工具列表移除 |
| 守卫层 | 明显的联网命令（`curl`、`wget`、网址、`python` 联网、`git clone`、装包）执行前被拒，并回一句「联网已关闭」 |
| 进程层 | `/usr/local/bin/bash` 注入 `netguard.so`：bash 及其所有子进程的非回环连接直接 `ECONNREFUSED`——写进脚本也一样 |

同时，模型用浏览器打开网页也会被拒。本地读写文件、编译、跑测试、`python3`/`node`
本地计算全部正常。

### 使用

- 点状态条切换：「联网：开 · 点关」↔「联网：已断网 · 点开」，立即生效，重启 App 保留。
- 面板里有总开关、严格模式（关闭时连 bash 也停用）、断网库状态。

### 验证

```sh
python3 - <<'PY'
import socket
s = socket.socket(); s.settimeout(3)
try:
    s.connect(("223.5.5.5", 443)); print("OPEN")
except Exception as e:
    print("BLOCKED", e)
PY
```

关闭时应输出 `BLOCKED ... Connection refused`；打开后应输出 `OPEN`。

### 原理

```
bash 包装器 ──锁文件存在──> LD_PRELOAD=netguard.so ──> connect()/sendto() 拒绝非回环
     │                                                         │
     └── 未启动 preload 时原样 exec /usr/bin/bash              └── 回环、Unix socket 放行
```

- 开关就是 `$DSH_HOME/dsh-go/netguard.lock` 这个文件在不在。
- 引擎自身的模型连接不走这个 shell，所以对话不受影响。

### 限制

- 只影响**从 bash 启动**的进程；静态链接程序不加载 `.so`，不受拦截。
- 理论上可主动清除 `LD_PRELOAD` 绕过；守卫会拦下提到该变量的命令。
- `netguard.so` 是 arm64 + glibc 的预编译版本；其它架构执行 `netguard/build.sh` 重编。
- 需要 `/usr/bin/bash`（找不到时回退 `/bin/bash`）。

### 许可

MIT。

---

## English

A switch for dsh-go chats. When it is off the model is not merely missing the web
tools — it **cannot reach the network at all**. Turning it back on restores
everything.

### Why

DSH mounts `web_search` / `web_fetch` inside every session preset and offers no
toggle. Hiding those two tools is not enough: a model with `bash` will happily
curl a search engine or fetch pages from `python3`. NetGate closes three layers:

| Layer | While off |
|---|---|
| Tools | `web_search` and `web_fetch` leave the tool list |
| Guard | Obvious network commands (`curl`, `wget`, URLs, `python` networking, `git clone`, package installs) are refused before they run |
| Process | `/usr/local/bin/bash` loads `netguard.so`; every non-loopback `connect()` from the shell and its children returns `ECONNREFUSED` — including commands run from a script |

Model-initiated browser opens are refused too. Local files, builds, tests and
`python3` / `node` computation keep working.

### Verify

```sh
python3 - <<'PY'
import socket
s = socket.socket(); s.settimeout(3)
try:
    s.connect(("223.5.5.5", 443)); print("OPEN")
except Exception as e:
    print("BLOCKED", e)
PY
```

`BLOCKED ... Connection refused` while off, `OPEN` while on.

### How it works

`/usr/local/bin/bash` is a wrapper. When `$DSH_HOME/dsh-go/netguard.lock` exists it
exports `LD_PRELOAD=netguard.so`, which refuses non-loopback `connect()` / `sendto()`
in the shell and everything it spawns. The engine's own model connection does not go
through that shell, so conversations keep working.

### Limitations

- Only processes started **from bash** are covered; statically linked binaries do not
  load the `.so`.
- Clearing `LD_PRELOAD` defeats it; the guard rejects commands that mention it.
- The bundled `netguard.so` is built for arm64 + glibc. Rebuild on other
  architectures with `netguard/build.sh` (tcc or gcc).
- Needs `/usr/bin/bash` (falls back to `/bin/bash`).

### License

MIT.
