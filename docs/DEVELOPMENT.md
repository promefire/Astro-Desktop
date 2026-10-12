# 开发记录

## 2026-10-12：外部编辑器

- 完成计划第 4 项。项目设置可选择并检查本机 `.exe`、`.cmd` 或 `.bat`；编辑器工具栏打开当前文章的真实路径。参考 HexoHub `bb39de8` 的外部打开和重新加载提示，保留 Astro Desktop 的设置、失败反馈和未保存保护，没有复制其 `exec` 字符串拼接。
- Windows 使用 `spawn` 参数数组，`shell` 固定为 false。`.exe` 直接接收文章路径；`.cmd` / `.bat` 只通过 `SystemRoot\System32\cmd.exe` 的 `/d /v:off /s /c` 启动，不信任 `ComSpec`。空格、中文和 `&` 保持为一个参数。路径含 `%` 时拒绝脚本型编辑器。`cmd.exe`、PowerShell 等解释器不能被选为编辑器。
- 未配置、文件不存在、路径无效和立即非零退出都会显示具体失败，编辑区保持不变。有未保存修改时必须取消、放弃或保存后才打开。磁盘已变化时先重新加载。外部保存不会自动进入编辑区；重新加载和原有 revision 冲突检查仍然有效，不会默认覆盖磁盘。
- 检查只确认文件存在，不启动程序。客户端不结束外部编辑器，也不监听文件变化。
- 新增命令形状与真实启动测试，以及一条 Electron 场景。写入仍只发生在隔离临时博客。

本轮结果见 [TESTING.md](TESTING.md)，使用方式见 [EDITOR.md](EDITOR.md)。下一项为真实 `npm run dev` 本地预览，之后是简洁文章统计。

## 2026-10-12：CodeMirror 与安全保存

- 完成计划第 3 项。文章点击后进入主区编辑器，提供源码 / 基础预览 / 左右分栏；右栏只显示已保存属性。沿用现有浅深色视觉，参考 HexoHub `bb39de8` 主编辑区的模式与分隔条交互，没有复制业务代码。
- CodeMirror 6 配合 YAML Frontmatter / Markdown 语言支持、撤销重做、查找替换。用原始文本状态和反向撤销效果保留 BOM、混合换行、注释、自定义字段与 MDX；修改属性直接编辑源码，不重建整份 YAML。
- 新增 `editor.ts`、`export-copy.ts` 及受限 IPC：项目绑定、双次 revision 核对、路径 / 硬链接检查、临时文件同步与替换、客户端旧源码备份、失败保留编辑记录、原生对话框导出不覆盖副本。
- 600 ms 停止输入后写编辑恢复记录；路由切换、返回、刷新、选项目和原生窗口关闭有未保存保护。恢复记录支持重启后取回、缺失原文件时导出，损坏记录拒绝覆盖。
- 基础 Markdown / GFM 预览不执行 HTML / MDX，也不加载图片和打开链接；完整 Astro 效果仍按第 5 项开发。
- 新增 9 项文件系统保存 / 恢复测试、3 项源码状态测试、2 项实际 Electron 编辑器场景。所有编辑和破坏性测试只在隔离临时项目中运行。
- 回归中修正同一路径恢复记录重新打开与刷新列表更新；旧 E2E 对「最新文件为日报」的假定改为实际内容检查。浏览器 textarea 的 LF 显示和测试注入多行输入与磁盘精确保留分开验证，磁盘保存与导出按完整字节文本断言。

本轮结果见 [TESTING.md](TESTING.md)，使用与恢复边界见 [EDITOR.md](EDITOR.md)。下一项为外部编辑器，之后依次完成真实 npm run dev 预览与简洁统计。

## 2026-10-10：新建普通文章草稿

- 更新 [ROADMAP.md](ROADMAP.md)，纳入主区 CodeMirror 三模式 / 右栏属性、外部编辑器、npm run dev 本地预览与用户选定的简洁文章统计。取消 AI 日报新建 / 专用编辑表单，本轮只交付新建普通草稿。
- 参考 HexoHub 的 `src/components/create-post-dialog.tsx`（研究快照 `bb39de8`）和用户截图：实现标题必填、标签回车添加、已有分类 / 标签建议、可选摘要。Astro 使用单分类，未加入尚无能力的模板控件。失败时保留表单，成功后转到草稿并选中文件。
- `src/main/services/drafts.ts` 负责参数校验、Windows 文件名、日期与 YAML 生成、目录校验和不覆盖创建；新增 `content:create-draft`，Preload 只暴露这一特定写入操作。
- 新建绑定当前 projectPath 并与项目切换串行处理，拒绝过期目标、额外路径 / source / kind 参数和链接目录；并发同名创建用文件系统独占操作分配不同名称。
- 先完整写入临时文件并 sync，再以硬链接公布目标，支持 NTFS 等硬链接文件系统。文章文本使用 JSON 引号保持 YAML 1.1 下的字符串类型，published 使用本地时间戳以兼容 Astro 日期 schema。
- 增加服务与 Electron 新建专项，所有写入位于测试临时目录；真实博客继续只读回归。没有为原博客创建测试文章、修改代码、提交或推送。
- 界面测试发现弹窗显示和卸载后的焦点恢复问题，已改为打开后聚焦标题、关闭后恢复触发按钮。开发测试发现用户已运行的 5187 端口被占用，新增经校验的端口配置，测试选择独立端口，不停止用户会话。

验证结果见 [TESTING.md](TESTING.md)。下一项为 CodeMirror 与防冲突保存；右栏当前的只读源码随该功能一起迁移。

## 第一阶段记录（已完成）

开发与验收日期：2026-10-09 至 2026-10-10，Asia/Shanghai。

## 范围

完成客户端初始化、桌面整体 UI、用户授权的本地项目接入、真实普通文章与日报读取。原始博客 `F:\blog\Astro_Blog` 仅用于只读验收，没有修改业务文件，没有执行 Git push。

本地博客处于 `0931e748d4cb6bcd7b0d811776a1edad8ce0176e`。远端参考快照与本地文章数不同，UI 严格展示本地 45 篇普通文章和 4 篇 AI 日报。

## 实现与文件

- `package.json`、锁文件、TypeScript / electron-vite / Vitest / Playwright 配置：可重复安装、严格类型、开发、构建与测试命令。
- `src/main/index.ts`：安全窗口、自定义资源协议、原生对话框、IPC 白名单、资源管理器调用。
- `src/preload/index.ts`、`src/shared/contracts.ts`：类型化 API 与可区分错误码。
- `src/main/services/`：活动项目与授权记录、原子设置、路径约束、读取限制、Git 本地状态。
- `src/main/adapters/promefire.ts`：专用内容目录、YAML / 日期 / 元数据解析与 MDX 源码保留。
- `src/renderer/`：欢迎与最近项目、HashRouter 导航、内容列表、筛选排序分页、属性 / 源码详情、设置、浅深色主题。
- `src/shared/future-services.ts`：编辑、恢复、附件、预览、Git 和发布的下一阶段契约；没有 IPC 实现或模拟成功。
- `tests/`：临时中文路径项目、真实博客、Electron 与开发模式测试。
- `docs/`：保留原始完整规划，新增研究、架构、功能状态与测试结果。

## 技术选择

Electron 44.7.0、React 19.3、TypeScript 5.9 strict、electron-vite 5、Vite 7、Tailwind 4、Lucide、Radix Slot / CVA 自有 UI 组件。Vite 版本固定在 electron-vite 声明支持的主版本，避免用 `--force` 忽略 peer 依赖冲突。第一阶段状态范围较小，React hooks 足够，不引入额外状态存储机制。

布局参考 HexoHub 的项目上下文和文章管理结构，自行实现桌面导航、列表和只读属性栏。没有复制 Hexo 操作或假设日期字段为 `date`。没有加载远程字体、外部图片或执行文章 HTML / MDX。

设置由主进程持久化。项目配置不执行 TS / JS；脚本仅读取并展示。Git 使用参数数组及 `windowsHide`，禁用 fsmonitor、自发交互与可选 index 写锁，不运行 fetch / commit / push。

## 已修复的问题

- 首次安装 Vite 与 electron-vite 的 peer 版本不兼容：选用受支持的 Vite 7。
- Electron 二进制直连下载失败：使用镜像并保留官方包校验。
- Git status 可能运行仓库 fsmonitor hook：强制禁用，并加入集成测试。
- Git 忽略目录内的文章可能被错标 clean：继承目录 ignored 状态。
- 重复点击当前文章导致只读详情持续 loading：同一路径选择不清除已加载文档，E2E 覆盖。
- 无效普通文章 draft 原先显示“否”：改为明确“字段无效”。
- 开发页面地址末尾斜杠与导航白名单不一致：统一 URL 规范化。
- localhost 默认端口存在其他开发项目：固定 `127.0.0.1:5187`、启用 strictPort，避免访问其他服务；不停止或改动其他应用。
- Vite 热更新的内联启动脚本：仅开发时注入随机 nonce，生产保留严格 script-src。
- Vite 首次依赖优化替换导航可能返回 ERR_ABORTED：开发模式保留替换中的导航，避免误判启动失败关闭窗口。

## 后续建议

1. 新建 draft:true 普通文章已完成，继续 CodeMirror 源码编辑；AI 日报独立表单已按最新要求取消。
2. YAML AST 最小更新，保留未知字段、注释、行尾与 MDX import / 表达式。
3. 基于 revision 的并发写入检测、原子保存、恢复记录与外部文件变更提示。
4. 资源导入及文章相对链接，再实现真实 Astro dev 脚本与准确 URL。
5. 最后实现选择性提交、安全合并服务器日报、构建校验与显式推送。

研究发现普通文章直接路由可能生成 draft 页面；发布阶段必须验收 RSS、搜索及直接 URL 的草稿行为。参见 RESEARCH.md。当前没有修改原博客以解决后续阶段问题。
