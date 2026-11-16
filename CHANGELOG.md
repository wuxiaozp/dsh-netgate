# Changelog

## 0.1.0 — 2026-11-17

首个公开发布（基础版）。

- 输入框上方状态条 + 「网闸 · 基础版」面板，一键开关联网。
- 关闭时：`web_search` / `web_fetch` 移出工具列表。
- 关闭时：执行前守卫拒绝明显的联网命令与模型发起的网页打开。
- 关闭时：`/usr/local/bin/bash` 注入 `netguard.so`，bash 及其子进程的非回环
  `connect()` / `sendto()` 返回 `ECONNREFUSED`（写进脚本同样生效）。
- 严格模式：关闭联网时连 bash 与手机 shell 一并停用。
- 断网锁文件：`$DSH_HOME/dsh-go/netguard.lock`；可用 `DSH_NETGUARD_LOCK` 覆盖。
- `netguard.so` 预编译 arm64；提供 `netguard/build.sh` 供其它架构重编。
