# Astro Desktop 第一阶段：源码研究记录

核实日期：2026-10-09（Asia/Shanghai）。本记录服务于第一阶段的桌面布局、项目接入与内容读取；不是未来编辑、预览或发布功能的完成声明。

## 1. 核实对象与边界

| 对象 | 核实版本 | 本地位置 | 用途 |
| --- | --- | --- | --- |
| HexoHub | `bb39de860d529d0535ffdf50e4631675c508b1c4`，package 版本 3.7.0 | `F:\astroHub\.reference\HexoHub` | 阅读 UI、项目、文章及 Git 实现 |
| 用户现有 Astro 博客 | `0931e748d4cb6bcd7b0d811776a1edad8ce0176e` | `F:\blog\Astro_Blog` | 第一阶段真实本地文件读取验收 |
| Astro 博客远端快照 | `f157903127a946e7ef8d25437367296d1c31238d` | `F:\astroHub\.reference\Astro_Blog` | 与当前远端源码核对 |

浏览器访问了两个用户指定的 GitHub 地址。HexoHub 页面可访问；Astro_Blog 未登录 Web 抓取返回 404，本机 Git 授权能够读取并完成浅克隆。不能将该 404 当作仓库不存在。

研究仅执行源码读取、浅克隆和只读 Git 命令。没有修改 `F:\blog\Astro_Blog` 的业务文件，没有拉取或合并到原项目，没有 push。研究时原项目与两个参考克隆的 `git status --porcelain` 均为空。参考目录被桌面应用项目忽略，不属于运行时依赖。

本地博客和远端快照的文章数不同：本地普通文章 45 篇、日报 4 篇；远端普通文章 45 篇、日报 5 篇。桌面端必须报告用户所选目录的实际内容，不能用远端计数或演示数据替换。

## 2. HexoHub 的布局与应用结构

源码入口为 `src/app/page.tsx`，UI 使用 Next.js、React、TypeScript、Tailwind 和 shadcn/Radix 组件。`public/electron.js` 是 Electron 入口；仓库同时存在 `src-tauri` 和桌面 API 适配层，不意味着新项目需要维护两套桌面框架。

主界面的结构可以借鉴：

1. 顶部独立标题栏和全局工具区，包含项目连接反馈及页面切换。
2. 左侧固定宽度项目上下文区域，提供目录选择、文章入口、设置与日志。
3. 右侧弹性主工作区，按文章列表、编辑、站点配置、统计、日志等模式切换。
4. 文章列表将搜索、分类/标签筛选、排序和分页集中在内容区。
5. 命令结果包含执行反馈，未把所有操作反馈塞入临时通知。

对应位置：`src/app/page.tsx` 的标题栏与导航从约 2589 行开始，侧栏从约 2722 行开始，文章列表从约 3815 行开始；`src/components/post-list.tsx` 定义排序、搜索、分类/标签筛选、批量与右键交互。

Astro Desktop 应延续“项目上下文 + 文章工作区 + 状态反馈”的结构，使用独立品牌、配色与排版。第一阶段的常驻内容入口是普通文章与 AI 日报；读取到的标题应作为主信息，文件名作为辅助信息。编辑、预览、发布只预留服务契约，不放无法工作的按钮。

HexoHub 的项目选择使用 `select-directory` IPC、`validate-hexo-project` 校验和 `localStorage` 中的 `hexo-project-path`。校验依赖 `_config.yml` 等 Hexo 约定；文章路径与日期也有 Hexo 假设，不能直接复用为 Astro 项目识别器。

其 Markdown 编辑器使用 Textarea，并提供切换预览及分栏模式；不能据此把它描述为完整的所见即所得编辑器。

### 需要重新实现的桌面和 Git 边界

- HexoHub Electron 当前源码配置 `nodeIntegration: true`、`contextIsolation: false`，通过 `window.require` 取得 IPC。Astro Desktop 使用隔离的 preload 白名单 API，renderer 不应直接读取文件系统或执行命令。
- `pushToRemote` 在 `src/app/page.tsx` 约 2301 行开始：写 Git 身份、设置 origin、`git add .`、commit、push；这段流程未先 fetch/merge，不能直接用于有服务器自动新增日报的仓库。
- 后续发布需要按文件选择变更、检查远端、处理合并冲突，并区分 push 完成与部署完成。
- HexoHub 服务启动逻辑包含查找并终止占用 4000 端口的进程；后续 Astro 预览管理应只停止应用自己启动的进程。
- HexoHub 为 MIT 许可。此阶段只研究交互结构；若以后复制源码，需要保留相应版权与许可声明。

## 3. Astro 博客内容定义

真实来源为 `src/content.config.ts`，本地工作副本和本次远端快照的相关定义一致。项目使用 Astro 5 的 `glob` content loader。

| Collection | 路径与后缀 | 必填字段 | 其余字段 |
| --- | --- | --- | --- |
| `post` | `src/contents/post/**/*.{md,mdx}` | `title: string`、`published: Date` | `draft?: boolean`、`description?`、`cover?`、`tags?: string[]`、`category?: string`、`author?`、`sourceLink?`、`licenseName?`、`licenseUrl?`、`password?: coerce.string`、`top?: integer` |
| `aiDaily` | `src/contents/ai-daily/**/*.md` | `title: string`、`published: Date`、`summary: string` | `highlights`、`tools`、`tags` 为 `string[]`，默认空数组 |
| `specs` | `src/contents/specs/**/*.md` | 未在此处声明 schema | 第一阶段不纳入文章/日报列表 |

普通文章与日报需要独立内容类型。日报 schema 没有 `draft` 字段，不应显示或保存为普通文章的草稿语义。分类是单字符串 `category`；不可写成 Hexo 风格的分类数组。置顶值 `top` 是整数，不能简化成布尔值。第一阶段只读取，未来写入必须保留未知 frontmatter 字段及原始 MDX 正文。

### 已核实的真实样例

`src/contents/post/遇到的错误及解决.md`：

```yaml
title: 错误及解决
published: 2021-03-06 22:00:05
category: 后端学习
tags:
  - Java
  - Spring Boot
  - 项目开发
```

该文件证明列表标题不能简单取文件名。`Embabel.mdx` 标题为 `Agent-Embabel框架`，日期为 `2026-08-14 15:08:14`，包含 `Tabs.astro` 和 `TypedText.astro` import；读取其正文不能执行组件或剥掉 import。

`src/contents/ai-daily/2026-10-08.md` 标题为 `2026-10-08 AI 晨间简报`，`published: 2026-10-08`；摘要为引号字符串，`highlights`、`tools`、`tags` 采用 YAML 行内数组。日报另外几篇位于 `2026-06-15.md`、`2026-06-17.md`、`2026-06-25.md`。

日期兼容必须覆盖：

- 日期：`2026-10-08`。
- 无时区日期时间：`2021-03-06 22:00:05`。
- 实际存在的未补零日期时间：`2025-08-1 15:08:14`、`2025-07-4 16:00:00`、`2025-07-3 16:00:00`。
- 列表显示应保留源文件的日历日期含义；不能因将 UTC 转成本地时区而让日期前移或后移。

本地普通文章目录包含 44 个 `.md`、1 个 `.mdx`，以及 52 个图片/音频资源文件。扫描应递归读取匹配后缀，不应把资源误计为文章。文件名包括中文、空格、括号与 emoji，需使用系统路径 API 而非拼接 shell 命令。

## 4. 路由与草稿规则

`yukina.config.ts`：站点名 `桥边红药`，站点地址 `https://blog.promefire.top`，当前 `slugMode: "PINYIN"`。`astro.config.mjs` 的 `site` 从该主题配置读取。

普通文章路由在 `src/pages/post/[...slug].astro`，路径参数为 `IdToSlug(entry.id)`。`src/utils/hash.ts` 支持：

- `RAW`：使用原 collection ID。
- `HASH`：SHA-256 的前 8 个十六进制字符。
- `PINYIN`：按中/非中文段转换，中文使用无声调拼音，非中文小写并清理为字母数字和连字符。

文章 URL 形如 `/post/{转换后的 collection ID}`，不能直接按标题、Hexo 日期目录或固定 ASCII 文件名猜测。collection ID 的生成与自定义 slug 行为需要在后续实际 Astro 运行时覆盖测试。

AI 日报没有独立的 `/ai-daily/{id}` 动态文章页。`src/pages/ai-daily.astro` 读取全部 `aiDaily`，按 published 降序聚合；文章锚点为 `daily-${id.replaceAll("/", "-")}`。后续单条日报预览链接应指向 `/ai-daily#daily-{id}` 对应锚点。

`src/utils/content.ts` 的普通列表、归档、标签和分类函数在生产模式过滤 `draft: true`。但 `src/pages/post/[...slug].astro` 的 `getStaticPaths()` 直接读取全部 `post`，未执行同样的过滤。因此目前不能保证草稿不会生成可直接访问的页面。此为下一阶段发布验收事项，本次没有修改博客代码。RSS、站内搜索索引和其他入口也需单独核实，不能只依据文章列表判断隐藏是否完整。

## 5. 项目命令与部署

博客 `package.json` 的实际脚本：

```json
{
  "dev": "node scripts/generate-music-list.mjs && astro dev",
  "build": "node scripts/generate-music-list.mjs && astro build",
  "preview": "astro preview",
  "astro": "astro",
  "ai:daily": "node scripts/ai-daily.mjs"
}
```

声明的包管理器为 `pnpm@9.15.4`（原字段同时含完整校验串）。`dev`/`build` 在 Astro 之前运行音乐列表生成脚本，因此它们不是无副作用的读取操作。本次研究未运行博客脚本，也未安装其依赖。

有效工作流 `.github/workflows/autoDeploy.yml` 定义：main 分支 push → Ubuntu runner → Node 20 → `npm install` → `npm run build` → SSH 部署 `dist/` 到服务器 `/www/blog/`。这与 packageManager 的 pnpm 声明存在执行方式差异，后续构建服务应把项目声明和实际部署配置分别展示，不能静默声称完全一致。

另有 `.github/workflowdeploy.yml`，它不在 `.github/workflows/` 下，不应当成有效 Actions 入口。相比既有 `ASTRO_DESKTOP_FEATURES.md` 中“仅找到该文件”的早期记录，本次已确认还有上述有效工作流。

脚本与配置只证明部署意图；本次未读取 Actions 运行结果、服务器状态或部署回执，也未触发部署。服务器日报调度、认证凭据和实际 cron 配置不在本次核实范围。

## 6. 第一阶段落地要求与后续研究

第一阶段应具备：Windows 本地目录选择；项目元数据识别；最近项目持久化；普通文章与 AI 日报的递归读取；YAML 元数据解析与逐文件错误反馈；搜索筛选；文章属性及源码只读查看。数据来自当前所选目录，损坏文章不能让整个项目失效。

文件系统、系统对话框和 Git 读取留在 Electron main，renderer 通过明确类型的 preload API 调用。项目打开不应 import/执行 `content.config.ts`、`astro.config.mjs` 或主题配置，也不应运行安装、构建、同步和发布命令。

后续契约需覆盖安全写入/外部修改检测、受控预览进程、准确文章 URL、构建任务日志、选择性提交、同步冲突和部署回执。这些接口可声明能力状态，但不实现模拟成功返回值。

下一阶段优先核实：

1. 内容保存时 frontmatter、未知字段和 MDX 的无损往返。
2. 普通文章草稿在直接 URL、RSS、搜索索引中的实际生产行为。
3. 原站点依赖和 Windows 预览进程、端口、音乐脚本的副作用。
4. 服务端自动日报与本地普通文章同时更新时的安全合并。
5. Actions 部署实际运行结果及与 commit 绑定的回执。

## 7. 原始来源

- [HexoHub 仓库](https://github.com/forever218/HexoHub)
- [HexoHub 主界面与 Git 流程](https://github.com/forever218/HexoHub/blob/bb39de860d529d0535ffdf50e4631675c508b1c4/src/app/page.tsx)
- [HexoHub 文章列表](https://github.com/forever218/HexoHub/blob/bb39de860d529d0535ffdf50e4631675c508b1c4/src/components/post-list.tsx)
- [HexoHub Electron 入口](https://github.com/forever218/HexoHub/blob/bb39de860d529d0535ffdf50e4631675c508b1c4/public/electron.js)
- [Astro 博客仓库](https://github.com/promefire/Astro_Blog)
- [本地验收版本的内容定义](https://github.com/promefire/Astro_Blog/blob/0931e748d4cb6bcd7b0d811776a1edad8ce0176e/src/content.config.ts)
- [普通文章路由](https://github.com/promefire/Astro_Blog/blob/0931e748d4cb6bcd7b0d811776a1edad8ce0176e/src/pages/post/%5B...slug%5D.astro)
- [日报聚合页](https://github.com/promefire/Astro_Blog/blob/0931e748d4cb6bcd7b0d811776a1edad8ce0176e/src/pages/ai-daily.astro)
- [站点与主题配置](https://github.com/promefire/Astro_Blog/blob/0931e748d4cb6bcd7b0d811776a1edad8ce0176e/yukina.config.ts)
- [URL 转换](https://github.com/promefire/Astro_Blog/blob/0931e748d4cb6bcd7b0d811776a1edad8ce0176e/src/utils/hash.ts)
- [有效部署工作流](https://github.com/promefire/Astro_Blog/blob/0931e748d4cb6bcd7b0d811776a1edad8ce0176e/.github/workflows/autoDeploy.yml)
