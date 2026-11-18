# 发布清单（照着点就行）

这个仓库已经是"点发布"状态：`git` 历史已初始化、市场索引有生成脚本。
下面每一步都标了它需要的东西，以及做不了时会卡在哪。

## 0. 名字与标识（发布后对外就用这套）

| 用途 | 值 |
|---|---|
| 中文名 | **网闸**（基础版） |
| 英文名 | **NetGate** |
| 仓库 | `dsh-netgate` |
| 版本 | `0.1.0` |
| App 内显示 | 插件「网闸·基础版」；面板「网闸 · 基础版」 |
| 一句话 | 一个开关切断联网，写代码不受影响 |

## 1. 前置

- GitHub 账号（发布仓库）
- 本机**联网**（这一步需要）
- `git`、`node`

## 2. GitHub

网页最省事：

1. 打开 <https://github.com/new?name=dsh-netgate&visibility=public>
2. 描述填：`dsh-go native plugin: one switch cuts internet access while coding keeps working`
3. 建好后把这个仓库目录上传（或在本机 `git remote add origin ...` 后 push）。

本机推送：

```sh
cd dsh-netgate
git remote add origin https://github.com/<你的用户名>/dsh-netgate.git
git push -u origin main
```

加上 Topics，方便搜索：`dsh` `dsh-go` `plugin` `offline` `web-search` `privacy`。

## 3. 插件市场索引（让 App 里能搜到）

```sh
node tools/make-index.mjs <你的用户名>        # 生成 docs/index.json
git add docs/index.json && git commit -m "index: 0.1.0" && git push
```

然后在 GitHub 仓库 **Settings → Pages**：Source 选 `Deploy from a branch`，分支 `main`、
目录 `/docs`。等一会儿，索引地址就是：

```
https://<你的用户名>.github.io/dsh-netgate/index.json
```

在 App 里：`设置 › 插件 › 插件市场` → 索引来源 → 添加上面这个地址，就能搜到「网闸」。
（索引格式已用官方校验器 `parseMarketIndex` 验过。）

## 4. 进官方索引

官方市场按索引收录，第三方要走官方审核流程。做法：

1. 在官方仓库 <https://github.com/deepseek-ai/deepseek-harness> 按它的 issue 模板提一条
   "插件收录 / plugin listing"，附上：包名、版本、仓库地址、上面那个索引 URL、
   以及"这是 dsh-go 原生插件（不是网页版）"。
2. 如果官方提供了索引 PR 或表单，以官方说明为准；**不要**直接往别人的仓库提 PR 之前没确认的路径。

> 我无法代替你提交：这需要你的账号身份，官方渠道也要求投稿人是作者本人。

## 5. 发版

```sh
git tag v0.1.0
git push --tags
```

到 GitHub Releases 用 `v0.1.0` 建一个 Release，标题「网闸 · 基础版 0.1.0」，
正文直接粘第 6 节的文案，附件传 `dsh-netgate-0.1.0-src.zip`。

## 6. 现成文案

**仓库简介（About）**

> 网闸 · NetGate — DeepSeek Harness 的联网总开关，手机端与电脑端各一个版本。关掉后模型真的连不出去：联网工具移除、联网命令拦截、bash 子进程断网；本地写代码、编译、测试照常。

**Release / 社区帖**

> **网闸 · 基础版 0.1.0**
>
> DSH 里联网搜索一直开着，没有开关。更麻烦的是，光把 `web_search` / `web_fetch`
> 藏起来没用——模型会改用 `bash` + `curl` / `python` 自己抓。
>
> 网闸把三层一起关：工具列表移除联网工具、执行前拒绝明显的联网命令、给 bash 及其
> 所有子进程注入 `netguard.so`，非回环 `connect()` 直接 `ECONNREFUSED`——写进脚本
> 也一样。本地读写文件、编译、跑测试、`python3`/`node` 计算全部正常。
>
> 输入框上方一条状态条，点一下就切；面板里还有严格模式（关闭时连 bash 也停用）。
>
> 安装：`sh install.sh`，或 `dsh plugin --profile web add dsh-netgate`。
> 限制：只覆盖从 bash 启动的进程；`netguard.so` 为 arm64 预编译，其它架构用
> `netguard/build.sh` 重编。

**一句话转发**

> 给你的 DSH 手机版装个「网闸」：一个开关真断网，写代码不受影响。

## 7. 需要我代发时

发布要登录，我不能用你的账号。两个办法：

- 你在这台机器上配好 `git` 凭据（或 `gh auth login`），并**打开联网开关**，我接着建仓库、push，然后把真实网址发你；
- 或者你网页建好空仓库，把仓库地址（或只对该仓库有写权限的 fine-grained token）给我，我推上去。

无论哪种，最后我会把两样东西发你：GitHub 仓库地址、市场索引地址。
