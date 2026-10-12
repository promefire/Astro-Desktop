# Astro Desktop

面向 `promefire/Astro_Blog` 的 Windows 本地博客工作台。支持真实项目接入、正文 / 草稿 / AI 日报读取、新建草稿、CodeMirror 编辑、安全保存与恢复、用系统默认程序打开当前文章、启动当前博客的本地开发预览，以及按目录统计文章。Markdown / MDX 文件是唯一内容来源，没有模拟数据或数据库。

客户端仓库：[promefire/Astro-Desktop](https://github.com/promefire/Astro-Desktop)。每完成一项独立功能，验证通过后提交并推送；具体约定见 [AGENTS.md](AGENTS.md)。

## 启动

需要 Windows 10/11、Node.js 22.12+（本次使用 24.16.0）、npm；安装 Git 可读取分支与文件状态。

```powershell
cd F:\astroHub
npm ci
npm run dev
```

开发服务固定使用 `127.0.0.1:5187`。如果端口已占用，命令会明确报错；请关闭自己先前启动的 Astro Desktop 开发会话后重试。

需要并行运行隔离会话时，可设置 `$env:ASTRO_DESKTOP_DEV_PORT = '5188'` 指定其他端口；仍严格检查占用，不会自动回退。E2E 开发测试使用独立空闲端口，保留你已启动的客户端。

首次启动点击「选择博客目录」，选择博客根目录，例如 `F:\blog\Astro_Blog`。目录须包含声明 Astro 依赖的 `package.json`，以及适配的内容目录。选择项目时不会安装博客依赖，也不会自动执行博客脚本。关闭后重启会恢复最近项目。

```powershell
npm run typecheck  # TypeScript 严格检查
npm test          # 文件系统、解析、设置、安全边界等服务测试
npm run build     # 构建 Main / Preload / Renderer
npm start         # 启动构建后的应用
npm run test:e2e  # 构建后运行真实 Electron 验证
```

读取 E2E 默认使用 `F:\blog\Astro_Blog`；其他位置通过 `$env:ASTRO_BLOG_TEST_PATH = 'D:\你的博客'` 指定。新建与编辑测试仅写入隔离的临时博客，原始博客只读并在前后比较内容 SHA-256；不会运行原博客构建或推送 Git。

要同时运行真实博客服务专项测试：先设置 `ASTRO_BLOG_TEST_PATH`，再执行 `npm test`。没有该变量时，只运行隔离临时目录测试，并明确跳过真实博客专项。

若 Electron 二进制下载因网络失败，可在当前 PowerShell 会话使用镜像重新安装（仍校验包内 SHA-256）：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

## 当前能力

- 原生目录选择、Astro 项目验证、最近项目、自动恢复及失效目录报错。
- 递归读取正文 `src/contents/post/**/*.{md,mdx}`、草稿 `src/contents/drafts/**/*.{md,mdx}` 与日报 `src/contents/ai-daily/**/*.md`。所属列表由目录决定。
- Frontmatter 标题、原始发布日期、分类、标签、普通文章草稿与独立日报属性；异常文件可定位，不阻塞其他文章。
- 搜索、类型 / 草稿 / 分类 / 标签筛选、排序、分页，右侧显示已保存属性。
- CodeMirror 源码编辑，源码 / Markdown 基础预览 / 左右分栏；撤销重做、查找替换、Ctrl+S 保存。
- 检测外部修改并停止覆盖，保存前备份，未保存导航与退出保护，本地编辑恢复记录和另存副本。
- 用 Windows 为 `.md` / `.mdx` 登记的默认程序打开当前文章。打开后编辑区暂停，重新加载后才继续编辑。
- 顶栏「本地预览」检查 Node / npm / dev 脚本 / Astro 依赖后，在当前博客目录执行 `npm run dev`，显示真实状态、日志和本地地址，并可停止本次进程。与编辑器里的 Markdown 基础预览分开。详见 [本地预览](docs/PREVIEW.md)。
- 新建草稿：标题必填，标签、单个分类和摘要可选；写入 `src/contents/drafts/`，不写 `draft` 字段，同名自动加序号，创建后进入草稿。AI 日报不提供新增。正文目录不表示已经发布。
- 文章统计：正文、草稿、AI 日报数量，以及正文和草稿的分类 / 标签排行。点击数量或排行进入同一口径的列表。详见 [文章统计](docs/STATS.md)。
- Git 本地状态、当前分支及脱敏远程地址；刷新与系统资源管理器定位。
- 浅色、深色、跟随系统外观，设置保存在 Electron `userData` 下。

在全部内容、正文或草稿页面点击「新建文章」。文件写入 `src/contents/drafts/`，不写 `draft` 字段。创建需要博客位于支持硬链接的磁盘（如 NTFS）；失败时保留输入供修正重试。草稿没有站点路由时，本地预览会说明原因，不会编造地址。

点击文章进入编辑器。右侧属性当前只读，修改标题、分类等需编辑源码中的 Frontmatter；保存成功后更新右栏。编辑器里的基础预览不执行 HTML / MDX，也不加载图片。要看站点效果，先在顶栏启动本地预览，再用「在站点中预览」。恢复记录在停止输入 600 ms 后写入客户端目录，文章仍需手动保存。详见 [编辑与恢复](docs/EDITOR.md) 与 [本地预览](docs/PREVIEW.md)。

当前不实现文章删除、属性表单、图片导入、生产构建、月度趋势、访问量、克隆、Git 同步或发布。下一项为图片与写作完善，完整顺序见 [开发计划](docs/ROADMAP.md)。

## 目录

```text
src/
  main/                 Electron 主进程、IPC、文件与 Git 服务
    adapters/           promefire Astro Blog 专用适配
    services/           项目、文章、新建、安全保存、恢复、副本、设置、本地预览、路径边界
  preload/              受限类型化 API 桥接
  renderer/             React 路由、布局、列表、CodeMirror、预览、详情与设置
  shared/               IPC 数据契约、后续阶段服务接口
tests/                  单元 / 文件系统集成测试、Electron E2E
docs/                   需求、架构、研究、功能、开发与测试记录
```

`out/` 是构建结果；`.reference/` 是开发时的参考源码快照，不是运行依赖。Windows 安装包、electron-builder 接入和签名在后续打包阶段实施，本阶段通过开发命令或构建后的 `npm start` 运行。

详见 [架构](docs/ARCHITECTURE.md)、[功能状态](docs/FEATURES.md)、[开发记录](docs/DEVELOPMENT.md)、[测试结果](docs/TESTING.md) 与 [仓库研究](docs/RESEARCH.md)。原始 [功能需求](docs/ASTRO_DESKTOP_FEATURES.md) 保留为规划，不代表已实现。
