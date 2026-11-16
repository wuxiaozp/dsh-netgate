#!/usr/bin/env node
// Generate docs/index.json (plugin market index, format 1) for this repo.
//
//   node tools/make-index.mjs <github-user> [repo-name]
//
// Serve the result with GitHub Pages (Settings -> Pages -> main /docs) and add
// https://<user>.github.io/<repo>/index.json as a custom index in the DSH app:
// Plugins -> plugin market -> index sources.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const user = process.argv[2]
const repo = process.argv[3] ?? 'dsh-netgate'

if (!user) {
  console.error('usage: node tools/make-index.mjs <github-user> [repo-name]')
  process.exit(2)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const title = pkg.dshGo?.title ?? { en: pkg.name }
const panel = pkg.dshGo?.contributes?.panels?.[0]?.title

const icon = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="14" fill="#0f172a"/>' +
    '<circle cx="32" cy="32" r="17" fill="none" stroke="#5eead4" stroke-width="3"/>' +
    '<path d="M15 32h34M32 15c6 6 6 28 0 34M32 15c-6 6-6 28 0 34" fill="none" stroke="#5eead4" stroke-width="2" opacity=".65"/>' +
    '<path d="M18 46 46 18" stroke="#f87171" stroke-width="5" stroke-linecap="round"/>' +
  '</svg>',
).toString('base64')}`

const index = {
  format: 1,
  title: { zh: '网闸 · NetGate', en: 'NetGate' },
  description: {
    zh: 'dsh-go 原生插件：一个开关切断联网，写代码不受影响。',
    en: 'dsh-go native plugin: one switch cuts internet access while coding keeps working.',
  },
  metadata: {
    categories: {
      tools: { title: { zh: '工具', en: 'Tools' } },
      privacy: { title: { zh: '隐私', en: 'Privacy' } },
    },
    labels: {
      offline: { title: { zh: '离线', en: 'Offline' } },
    },
  },
  plugins: [
    {
      name: pkg.name,
      title: { zh: title.zh, en: title.en },
      description: {
        zh: `联网总开关：移除联网搜索与网页抓取，并在进程层切断 bash 及其子进程的外网连接；本地写代码、编译、测试不受影响。${panel ? `面板：${panel}。` : ''}`,
        en: 'Master switch: removes web search and fetch, and cuts every bash child from the network at the process level. Local coding, builds and tests keep working.',
      },
      author: user,
      homepage: `https://github.com/${user}/${repo}#readme`,
      repository: { url: `https://github.com/${user}/${repo}` },
      icon,
      metadata: {
        category: 'tools',
        keywords: ['offline', 'web-search', 'privacy', 'netguard', 'dsh-go'],
        labels: ['offline'],
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp: Math.floor(Date.now() / 1000),
          source: { type: 'npm' },
          engines: { dsh: pkg.engines?.dsh },
        },
      ],
    },
  ],
}

mkdirSync(join(root, 'docs'), { recursive: true })
writeFileSync(join(root, 'docs/index.json'), `${JSON.stringify(index, null, 2)}\n`)
console.log(`docs/index.json written for ${pkg.name}@${pkg.version} (${user}/${repo})`)
console.log(`index URL: https://${user}.github.io/${repo}/index.json`)
