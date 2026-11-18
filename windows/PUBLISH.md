# 发布说明

这份包已经按「可直接发布」整理好，发布由你自己执行。下面是要改的字段和两种发布路径。

## 发布前先改这几处

| 字段 | 现状 | 说明 |
|---|---|---|
| `name` | `dsh-netgate-win` | npm 上若被占用就换名（如 `@你的scope/dsh-netgate-win`）；换名后 `cordis.patch.yml` 里两处 `dsh-netgate-win` 也要同步改成同一个名字（`id` 与 `name` 必须等于 `package.json` 的 `name`） |
| `author` / `repository` / `homepage` / `bugs` | 未写 | 建议补上，插件页会显示 |
| `version` | `0.1.8` | 每次发布递增 |

`private` 已删除，`publishConfig.access` 为 `public`；`files` 是白名单，`PUBLISH.md`、`examples/` 不会进包。本包位于仓库的 `windows/` 子目录。

## 路径一：发到 npm

DSH 自带 pnpm，路径取自 `load_workspace_dependencies`（各机器可能不同）：

```powershell
$pnpm = 'C:\Users\39739\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
$node = 'C:\Users\39739\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'

# 先本地打包看清单
cd windows
& $node $pnpm pack --pack-destination dist

# 登录并发布（需要 npm 账号；国内可先设 registry=https://registry.npmjs.org/）
& $node $pnpm publish --access public --no-git-checks
```

发布后别人这样装：`dsh plugin --profile desktop add dsh-netgate-win`。

## 路径二：GitHub Release + 插件市场索引

原版 netgate 用的是「插件市场索引」（`format: 1` 的 JSON）。你的仓库推上去后：

1. 打 tag 发 Release（可附 `pnpm pack` 出来的 tgz）；
2. 把 `examples/market-index.json` 里的占位符换成真实值：`<你的仓库 URL>`、`<40 位 commit SHA>`；
3. 把该 JSON 放到 GitHub Pages（例如 `https://<你>.github.io/<仓库>/index.json`）；
4. 用户在 **插件 → 发现 → 添加索引源** 里粘贴这个 URL 即可安装。

DSH 从索引安装 Git 源时，会把 `source.url` + `source.commit` 组合成
`git+<仓库 URL>#<commit>` 交给 pnpm，所以**用户机器上必须装有 Git**。

也可以用索引里的 npm 源：把 `source.type` 改成 `"npm"`，删掉 `commit`，`url` 留空表示用客户端配置的 registry。

## 版本兼容

`engines.dsh` 声明为 `>=0.2.1-rc.2 <0.3.0-0`。0.1.8 是在 DSH Desktop `0.2.2-rc.3`（Windows）上开发和验证的。
插件市场会按这个范围判断「与当前 DSH 兼容」。

## 这个包做了什么

见 [docs/DETAIL.md](docs/DETAIL.md)。要点：断网时对新会话移除 `web_search` / `web_fetch`、
拒绝网关联网命令（回环地址放行）、严格模式停用 shell；没有进程级断网（Windows 没有 `LD_PRELOAD`）。

## 自检清单

- [ ] `package.json`：`dsh.bundle.patch`、`dsh.client`、`exports["./client"]` 齐全
- [ ] `cordis.patch.yml` 的 `id` / `name` 与包名一致
- [ ] `locale/zh.json`、`locale/en.json` 的 `meta.title/description/detail` 有内容
- [ ] `icon.svg` 是合法 SVG（≤256 KiB）
- [ ] 装到干净 profile 里验证：断网开关、守卫拦截、恢复联网
