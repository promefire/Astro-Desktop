# Astro Desktop

面向 `promefire/Astro_Blog` 的 Windows 本地博客工作台。当前为第一阶段：真实项目接入、普通文章 / AI 日报读取、筛选和只读详情。Markdown / MDX 文件是唯一内容来源，没有模拟数据或数据库。

客户端仓库：[promefire/Astro-Desktop](https://github.com/promefire/Astro-Desktop)。每完成一项独立功能，验证通过后提交并推送；具体约定见 [AGENTS.md](AGENTS.md)。

## 启动

需要 Windows 10/11、Node.js 22.12+（本次使用 24.16.0）、npm；安装 Git 可读取分支与文件状态。

```powershell
cd F:\astroHub
npm ci
npm run dev
```

开发服务固定使用 `127.0.0.1:5187`。如果端口已占用，命令会明确报错；请关闭自己先前启动的 Astro Desktop 开发会话后重试。

首次启动点击「选择博客目录」，选择博客根目录，例如 `F:\blog\Astro_Blog`。目录须包含声明 Astro 依赖的 `package.json`，以及适配的内容目录。客户端不会安装博客依赖，也不会执行博客配置或脚本。关闭后重启会恢复最近项目。

```powershell
npm run typecheck  # TypeScript 严格检查
npm test          # 文件系统、解析、设置、安全边界等服务测试
npm run build     # 构建 Main / Preload / Renderer
npm start         # 启动构建后的应用
npm run test:e2e  # 构建后运行真实 Electron 验证
```

E2E 默认读取 `F:\blog\Astro_Blog`；其他位置通过 `$env:ASTRO_BLOG_TEST_PATH = 'D:\你的博客'` 指定。测试使用隔离的客户端配置目录，读取博客前后比较内容文件 SHA-256；不会保存文章、运行博客构建或推送 Git。

要同时运行真实博客服务专项测试：先设置 `ASTRO_BLOG_TEST_PATH`，再执行 `npm test`。没有该变量时，只运行隔离临时目录测试，并明确跳过真实博客专项。

若 Electron 二进制下载因网络失败，可在当前 PowerShell 会话使用镜像重新安装（仍校验包内 SHA-256）：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

## 当前能力

- 原生目录选择、Astro 项目验证、最近项目、自动恢复及失效目录报错。
- 递归读取 `src/contents/post/**/*.{md,mdx}` 与 `src/contents/ai-daily/**/*.md`。
- Frontmatter 标题、原始发布日期、分类、标签、普通文章草稿与独立日报属性；异常文件可定位，不阻塞其他文章。
- 搜索、类型 / 草稿 / 分类 / 标签筛选、排序、分页、源文件与属性只读查看。
- Git 本地状态、当前分支及脱敏远程地址；刷新与系统资源管理器定位。
- 浅色、深色、跟随系统外观，设置保存在 Electron `userData` 下。

当前不实现创建 / 保存 / 删除文章、编辑器、图片导入、Astro 预览、克隆、Git 同步或发布。相关服务仅保留 TypeScript 接口，不暴露未实现的操作按钮。

## 目录

```text
src/
  main/                 Electron 主进程、IPC、文件与 Git 服务
    adapters/           promefire Astro Blog 专用适配
    services/           项目、文章、Frontmatter、设置、路径边界
  preload/              受限类型化 API 桥接
  renderer/             React 路由、布局、列表、详情与设置
  shared/               IPC 数据契约、后续阶段服务接口
tests/                  单元 / 文件系统集成测试、Electron E2E
docs/                   需求、架构、研究、功能、开发与测试记录
```

`out/` 是构建结果；`.reference/` 是开发时的参考源码快照，不是运行依赖。Windows 安装包、electron-builder 接入和签名在后续打包阶段实施，本阶段通过开发命令或构建后的 `npm start` 运行。

详见 [架构](docs/ARCHITECTURE.md)、[功能状态](docs/FEATURES.md)、[开发记录](docs/DEVELOPMENT.md)、[测试结果](docs/TESTING.md) 与 [仓库研究](docs/RESEARCH.md)。原始 [功能需求](docs/ASTRO_DESKTOP_FEATURES.md) 保留为规划，不代表已实现。
