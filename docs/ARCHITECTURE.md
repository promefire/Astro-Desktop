# 架构与边界

## 分层

React Renderer 只调用 `window.astroDesktop`。Preload 使用 `contextBridge` 暴露固定方法，不暴露 Node、Electron 对象或任意 IPC。Main 验证主窗口和主 frame 来源，将调用交给服务；结果统一为 `Result<T>`。

主窗口启用 `contextIsolation`、`sandbox`，关闭 `nodeIntegration`，拒绝权限、任意跳转、新窗口和 webview。生产资源使用限定到构建目录的 `astro-desktop://app` 协议。开发模式只接受本机 Vite URL。

## 真实内容流程

1. 原生目录选择获得项目授权；最近项目仅可从客户端持久化的已授权记录打开。
2. ProjectService 校验 package.json、Astro 依赖与专用内容目录。配置 TS / JS 只作为博客代码保留，不执行。
3. AstroBlogAdapter 固定正文、草稿和 AI 日报三个目录的扩展名及属性规则。
4. ContentService 递归扫描；FrontmatterService 安全解析 YAML，保留 source、body、未知字段与 revision。
5. GitService 通过参数化系统 Git CLI 读取本地分支、远程和 porcelain 状态。无 Git 或失败时显示未知状态，不能伪造 clean。
6. Renderer 进行展示筛选；CodeMirror 维护原始源码。Markdown 基础预览不执行 HTML / MDX。本地图片经主进程读成 data URL，https 图片直接显示。

所有文章路径须位于授权项目和对应 collection 内。字符串路径与解析后的真实路径均进行检查，拒绝穿越、符号链接 / junction 逃逸以及非法文件类型。扫描故障按文件隔离，界面呈现诊断。

## 配置与副作用

客户端设置写入自身 `userData/settings.json`，使用原子替换与串行化更新。用户显式创建草稿时写入 `src/contents/drafts` 下一个文件，显式保存时替换对应文章，显式确认后才删除单篇文章；不修改 Git index，不 fetch / commit / push。删除只 `unlink` 已核对的普通文件，拒绝链接、硬链接和目录，也不进入回收站。最近项目最多十个，记录路径、名称和上次打开时间。配置损坏应保留并提示，不覆盖为默认值。

`content:create-draft` 参数限于 projectPath、title、tags、category、description，不接受目标路径、source 或内容类型。服务校验项目是否仍活动，复核真实目录，拒绝目录链接，生成 Windows 文件名。日期采用本地时间的 YAML 时间戳，其他文本使用兼容 YAML 的 JSON 引号，防止 `on` / `true` / 日期形标签被解释成其他类型。项目切换、新建、保存和编辑恢复共用队列，过期项目请求被拒绝。

新建先 `open(wx)` 独占临时文件、写入 / sync / 关闭，再通过 [Node fsPromises.link](https://nodejs.org/api/fs.html#fspromiseslinkexistingpath-newpath) 创建目标名称。同名失败时重试带序号名称，不以覆盖性 rename 回退。最后只移除自己创建的临时文件；被杀进程或文件锁可能留下 `.tmp`（不参与文章读取）。此策略需要硬链接支持，已有文件、同名目录和并行新建有测试覆盖。不能保证抵御同机恶意进程持续更换目录的文件系统竞态攻击。

发布日期保留文档日期语义，不用 UTC 转换导致日期跨天。正文与草稿使用同一套文章字段，但 `kind` 来自目录：`src/contents/post`、`src/contents/drafts`、`src/contents/ai-daily`。Frontmatter 的 `draft` 只按原值保留，缺失时为未设置，无效时报告字段问题，不把文章改列入另一个目录。当前博客的 Astro 集合没有 drafts，本地预览因此不为草稿生成地址。`src/contents` 上的递归监听会在文件变化后重新扫描并只更新索引，暂停期间的事件丢弃；它不替换编辑区。文章统计是对这份索引的只读聚合，计算在 `src/shared/article-stats.ts`，不另建统计库，也不把未保存编辑区计入。切换项目时先清空索引，过期响应不能写回新项目。口径见 [STATS.md](STATS.md)。

本地图片目录与文章文件并列，名称是去掉 `.md` / `.mdx` 的文件名。新建不创建这个目录；第一次本地导入才创建最后一层。相对链接按路径段做百分号编码。S3/R2 配置和秘密密钥写在 `userData/image-storage.json`，`settings.json` 与返回给界面的对象都不含秘密密钥。启用后上传成功才返回公开链接，失败不写本地文件。导入拒绝目录联接，也拒绝写出内容目录。修改 Frontmatter 标题不重命名文章或图片目录。

## 下一阶段接口

`src/shared/future-services.ts` 为后续 Frontmatter 表单更新、删除恢复、生产构建、Git 写操作和发布编排定义接口；这些未来接口没有实现，也不注册通用命令 IPC。普通草稿创建、源码保存、编辑恢复、本地预览和图片导入已转入实际 DesktopApi。AI 日报不增加创建接口，也不导入图片。

## 编辑器与保存

`SourceEditor` 使用 CodeMirror 单实例，切换三种视图时保留状态。`source-state.ts` 将规范化行坐标映射回原始源码，记录原始文本的撤销效果，避免重序列化 YAML 和统一整份文件换行。右栏属性来自最后成功读取 / 保存的 ArticleDocument。Hash 数据路由的 blocker 与原生窗口 close 事件共同处理未保存提示。

`content:save` 接收 projectPath、relativePath、source、baseRevision，主进程验证活动项目、真实路径、普通文件和前置版本；写临时文件并 sync、备份旧源码、再次核对 hash、rename 原子替换。损坏元数据停止保存。恢复记录与备份仅写 `userData/editor/`；保存前先持久化缓冲区，保存完成后的清理失败单独报告。副本必须由原生保存对话框提供目的路径，采用不覆盖创建。详细限制见 [EDITOR.md](EDITOR.md)。

外部编辑器不保存可执行文件路径。打开前用 `System32\reg.exe` 的参数数组查询 `.md` / `.mdx` 的用户默认 ProgId，没有时再看 `HKCR` 的类型登记；查询失败不会显示为已打开。确认存在默认方式后，主进程用 Electron `shell.openPath` 把文章真实路径交给系统，由系统启动默认程序，不拼接命令行，也不弹出客户端自己的编辑器选择框。`shell.openPath` 返回非空错误时显示失败，编辑区保持可编辑。打开成功后渲染进程暂停当前文章的编辑，直到用户重新加载磁盘版本。客户端不跟踪、不结束用户的编辑器进程，也不监视文章文件。旧设置里的 `externalEditorPath` 会被忽略，避免因此把设置文件判为损坏。

## 本地预览

预览进程和环境检查只在 Main。Preload 暴露 `preview:*` 专用接口，Renderer 不能执行任意命令。启动使用 `cmd.exe /d /s /c` 调用已验证的 `npm.cmd`，参数为结构化的 `npm run dev`，工作目录是当前授权博客，因此项目自己的 predev 仍会执行。不会把 Electron 自带的 Node 当作系统 Node，也不会拼接文章或日志里的命令。

子进程环境去掉 `ELECTRON_*`，并去掉指向 Electron 的 `NODE_OPTIONS`；把所选 Node 所在目录放在 PATH 前面。不追加 `--host`，不改博客配置。状态只有在本次日志里的本地地址通过 HTTP 2xx/3xx 检查后才变为运行中。停止只对本次启动的进程编号执行 `taskkill /PID /T /F`。切换项目、关闭窗口后退出应用时结束该进程树。使用说明见 [PREVIEW.md](PREVIEW.md)。

发布仍未实现。将来需要明确文件范围，fetch 后安全整合远端日报，冲突或构建失败停止；推送成功仅可报告部署待确认。路由核实见 RESEARCH.md。

## 参考

参考 HexoHub 的项目导航、列表和详情信息结构，未复制其业务源代码。安全设计依据 [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)，构建采用 [electron-vite](https://electron-vite.org/guide/) 与 [Tailwind Vite 插件](https://tailwindcss.com/docs/installation/using-vite)。
