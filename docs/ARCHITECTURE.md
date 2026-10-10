# 架构与边界

## 分层

React Renderer 只调用 `window.astroDesktop`。Preload 使用 `contextBridge` 暴露固定方法，不暴露 Node、Electron 对象或任意 IPC。Main 验证主窗口和主 frame 来源，将调用交给服务；结果统一为 `Result<T>`。

主窗口启用 `contextIsolation`、`sandbox`，关闭 `nodeIntegration`，拒绝权限、任意跳转、新窗口和 webview。生产资源使用限定到构建目录的 `astro-desktop://app` 协议。开发模式只接受本机 Vite URL。

## 真实内容流程

1. 原生目录选择获得项目授权；最近项目仅可从客户端持久化的已授权记录打开。
2. ProjectService 校验 package.json、Astro 依赖与专用内容目录。配置 TS / JS 只作为博客代码保留，不执行。
3. AstroBlogAdapter 固定两种集合的目录、扩展名及属性规则。
4. ContentService 递归扫描；FrontmatterService 安全解析 YAML，保留 source、body、未知字段与 revision。
5. GitService 通过参数化系统 Git CLI 读取本地分支、远程和 porcelain 状态。无 Git 或失败时显示未知状态，不能伪造 clean。
6. Renderer 进行展示筛选；文章源码作为文本显示，不渲染 HTML 或执行 MDX。

所有文章路径须位于授权项目和对应 collection 内。字符串路径与解析后的真实路径均进行检查，拒绝穿越、符号链接 / junction 逃逸以及非法文件类型。扫描故障按文件隔离，界面呈现诊断。

## 配置与副作用

客户端设置写入自身 `userData/settings.json`，使用原子替换与串行化更新。用户显式创建普通文章时，另写一个 post 目录内的草稿文件；不修改已有博客文件或 Git index，不 fetch / commit / push。最近项目最多十个，记录路径、名称和上次打开时间。配置损坏应保留并提示，不覆盖为默认值。

`content:create-draft` 是唯一文章写入 IPC。参数限于 projectPath、title、tags、category、description，不接受目标路径、source 或内容类型。服务校验项目是否仍活动，复核真实目录，拒绝目录链接，生成 Windows 文件名。日期采用本地时间的 YAML 时间戳，其他文本使用兼容 YAML 的 JSON 引号，防止 `on` / `true` / 日期形标签被解释成其他类型。项目切换和新建共用队列，过期项目请求被拒绝。

新建先 `open(wx)` 独占临时文件、写入 / sync / 关闭，再通过 [Node fsPromises.link](https://nodejs.org/api/fs.html#fspromiseslinkexistingpath-newpath) 创建目标名称。同名失败时重试带序号名称，不以覆盖性 rename 回退。最后只移除自己创建的临时文件；被杀进程或文件锁可能留下 `.tmp`（不参与文章读取）。此策略需要硬链接支持，已有文件、同名目录和并行新建有测试覆盖。不能保证抵御同机恶意进程持续更换目录的文件系统竞态攻击。

发布日期保留文档日期语义，不用 UTC 转换导致日期跨天。普通文章 `draft` 与日报没有 draft 的 schema 分开处理。每次刷新重新读磁盘；本阶段无自动文件监听。

## 下一阶段接口

`src/shared/future-services.ts` 为后续已有文章写入、Frontmatter 更新、附件、恢复、Astro 进程、Git 写操作和发布编排定义接口；这些未来接口没有实现，也不注册 IPC。普通草稿创建已转入实际 DesktopApi；AI 日报不增加创建或专用编辑接口。保存需要 projectPath 和 expectedRevision，避免误写项目或覆盖外部修改。MDX 正文应逐字保留，未知属性与 YAML 注释应在写入设计中保真。

预览按用户要求执行所选项目的 `npm run dev`，先检查 Windows 的 Node / npm / PATH 与依赖，保留现有前置脚本，并按实际 URL 转换定位文章；只停止自身启动的进程。发布需要明确文件范围，fetch 后安全整合远端日报，冲突或构建失败停止；推送成功仅可报告部署待确认。有关现有路由与部署的核实见 RESEARCH.md。

## 参考

参考 HexoHub 的项目导航、列表和详情信息结构，未复制其业务源代码。安全设计依据 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)，构建采用 [electron-vite](https://electron-vite.org/guide/) 与 [Tailwind Vite 插件](https://tailwindcss.com/docs/installation/using-vite)。
