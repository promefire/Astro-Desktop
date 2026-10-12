# 测试记录

## 2026-10-12：真实本地预览

本次结果：TypeScript strict 通过；设置真实博客变量后 **53 / 53** 个单元 / 文件系统测试通过（9 个文件）；Main / Preload / Renderer 构建通过；完整 Electron E2E **7 / 7** 通过；依赖审计 **0 个已知漏洞**。没有新增依赖。没有在 `F:\blog\Astro_Blog` 上执行 predev、dev、build、commit 或 push。

命令：`npm run typecheck`、`$env:ASTRO_BLOG_TEST_PATH = 'F:\blog\Astro_Blog'; npm test`、`npm run test:e2e`（含构建）、`npm audit`。

新增 `tests/preview-core.test.ts`：日志有界缓冲、分块拼接、ANSI 去除和令牌隐藏；只接受最后一条本地 http 地址；Windows Path 与 `npm.cmd` 引用；RAW / HASH / PINYIN 与无法确定的 slug 规则。

新增 `tests/preview-process.test.ts`：隔离临时项目中 predev 真实执行，HTTP 可访问后才变为运行中，并结束本次进程树；无关端口上的服务在停止后仍然存活；脚本失败、超时、缺少 dev 脚本、缺少 Astro 依赖；切换项目后旧日志不进入新状态；无效 Node / npm 不写入设置；已验证的普通文章和 AI 日报地址才会打开，缺少 slug 配置时不调用打开函数；含中文和空格的 `npm.cmd` 可以启动。这些项目里的 `node_modules/astro` 只用于依赖检查，不代替真实 Astro。

新增 `tests/preview-astro.test.ts`：在隔离的中文路径项目中用 npm 安装真实 `astro@5`，执行带 predev 的 `npm run dev`，HTTP 读到页面正文，停止后端口关闭。

新增 `tests/e2e/preview.spec.ts`：Electron UI → Preload → Main → 受控 dev 进程。启动后状态为运行中，predev 已执行；系统打开函数只收到面板上的本地地址。停止后该地址不可访问。未保存正文取消「在站点中预览」后，磁盘文章不变。截图 `docs/images/preview-running.png` 来自 `F:\tmp` 下的隔离项目。已有保存和外部编辑器 E2E 同时通过。

已在本机 Windows 验证。macOS 与 Linux 的进程树、`npm.cmd` 和注册表 Path 尚未验收。客户端不会自动安装依赖，也不会结束用户自己启动的 Node 进程。

## 2026-10-12：外部编辑器

本次结果：TypeScript strict 通过；设置真实博客变量后 **43 / 43** 个单元 / 文件系统测试通过（6 个文件）；Main / Preload / Renderer 构建通过；完整 Electron E2E **6 / 6** 通过；依赖审计 **0 个已知漏洞**。没有新增依赖，没有执行原博客 dev / build / commit / push。

命令：`npm run typecheck`、`$env:ASTRO_BLOG_TEST_PATH = 'F:\blog\Astro_Blog'; npm test`、`npm run test:e2e`（含构建）、`npm audit`。

真实博客回归仍按磁盘上的实际文件数断言。E2E 前后内容 SHA-256 与 Git 状态一致，包括博客原有未提交内容。

新增 `tests/external-editor.test.ts`：默认程序登记只解析 `REG_SZ`，忽略未设置的类型默认值，并优先使用用户选择。真实 `reg.exe` 查询与当前 Windows 用户选择一致，且不会启动程序。打开时把含中文、空格、`&` 和 `%` 的文章绝对路径交给默认打开函数一次；没有登记或系统返回错误时不改文章。集合外路径和项目切换不会调用打开函数。旧设置里的 `externalEditorPath` 不再导致设置损坏。

新增 `tests/e2e/external-editor.spec.ts`：临时中文博客中检查默认程序；系统拒绝打开时显示错误且不改文章。若本机已为 `.md` 设置默认程序，则验证未保存取消不会打开；保存并打开后编辑区暂停并显示重新加载引导，暂停期间不能保存，键盘输入不会写入文章。外部追加在重新加载前不会进入编辑区，重新加载后才显示。此后若磁盘再次变化，保存会停止覆盖。测试替换了 Electron 的 `shell.openPath`，避免在自动化中启动用户的真实编辑器；登记查询仍使用本机注册表。1000×680 截图归档在 `docs/images/external-editor-settings.png`、`docs/images/external-editor-unsaved.png` 与 `docs/images/external-editor-active.png`。

未验收断电、网络盘，以及外部修改的自动提醒。自动提醒仍属于后续文件监听。客户端不会关闭用户已经打开的外部程序。更换默认程序需要在 Windows 设置中完成。

## 2026-10-12：CodeMirror 与安全保存

本次结果：TypeScript strict 通过；设置真实博客变量后 **38 / 38** 个单元 / 文件系统测试通过（5 个文件）；Main / Preload / Renderer 构建通过；完整 Electron E2E **5 / 5** 通过；依赖审计 **0 个已知漏洞**（253 个包）。编辑器专项另复测通过。没有执行原博客 dev / build / commit / push。

命令：`npm run typecheck`、`$env:ASTRO_BLOG_TEST_PATH = 'F:\blog\Astro_Blog'; npm test`、`npm run test:e2e`（含构建）、`npx playwright test`、`npm audit`。未设置真实博客变量时，37 项通过、1 项真实博客专项跳过。

本机真实博客本轮为 **46 篇普通文章、4 篇日报**，和上次快照数量不同；读取断言使用实际文件数。E2E 前后全部内容文件 SHA-256 及 Git 状态相同，包括博客原有的未提交文件；不把已有改动误报为本轮开发造成。

新增 `tests/editor.test.ts`（9 项）：精确保留 BOM / 混合换行 / 注释 / 未知字段 / MDX，保存后元数据与 revision 更新，旧源码备份在客户端目录，竞争保存与外部改动停止覆盖，无效 YAML / 属性保留恢复记录，原文件删除后的恢复与项目隔离，非法 / 超大请求拒绝，硬链接 / junction 拒绝，备份目录不可写时停止替换并清理临时文件，损坏恢复记录不覆盖，导出不覆盖已有文件。

新增 `tests/source-state.test.ts`（3 项）：CodeMirror 原始文本的分组撤销 / 重做，UTF-16 与多处修改的混合换行坐标映射，安全提取 Markdown 正文。

新增 `tests/e2e/editor.spec.ts`（2 个完整场景）：

- 临时中文项目中真实输入、三模式切换、分隔条键盘调整、撤销 / 重做、预览模式 Ctrl+S 与磁盘 CRLF 精确比对，未保存路由 / 返回 / 原生关闭提示，取消与放弃，保存失败不继续导航，真实外部修改冲突、副本导出、加载磁盘、同一路径恢复；销毁测试窗口模拟异常丢失后重启，恢复并保存成功。
- HTML / MDX 表达式不执行，外部图片不请求，链接不导航；1000×680 窗口操作可见；原文件删除后恢复记录可查看、取消导出、真实导出及明确丢弃。

原有真实博客、开发命令、新建草稿 E2E 已适配主区编辑器并通过回归。原生目录 / 保存对话框在测试中只指定返回路径，后续全部使用真实 IPC 与文件系统；不替代人工原生对话框交互验收。

已检查浅 / 深色分栏及小窗口预览截图；归档在 `docs/images/editor-*.png`。截图为独立测试博客。当前未验收断电、网络卷、持续恶意文件系统竞态、超大文档性能、系统 IME 全场景；异常窗口丢失测试只保证已完成 checkpoint 的内容。恢复记录不是文章自动保存，HTML / MDX 和图片完整效果仍待 Astro 预览实现。详见 [EDITOR.md](EDITOR.md)。

## 2026-10-10：普通文章新建草稿

本次完整结果：类型检查通过；设置 `ASTRO_BLOG_TEST_PATH` 后服务测试 26 / 26（3 个文件）；Main / Preload / Renderer 构建通过；Electron E2E 3 / 3。没有新增依赖。原博客读取结果仍为 45 篇普通文章与 4 篇 AI 日报，E2E 前后内容指纹和 Git 状态一致。

命令：`npm run typecheck`、`$env:ASTRO_BLOG_TEST_PATH = 'F:\blog\Astro_Blog'; npm test`、`npm run test:e2e`（包含构建）。未设置真实博客变量时为 25 个服务测试通过，1 个真实博客测试跳过。

新增服务测试 `tests/drafts.test.ts`（6 项）：

- 新建后真实文件、文章索引及重启后读取一致；draft 为布尔值，分类为字符串，标签去重，摘要换行保留。另用 YAML 1.1 验证生成 published 为 Date、`on` / `true` / 日期形标签仍为字符串。
- 同名文件和同名目录不覆盖；两个独立服务并行创建时生成不同序号，无遗留临时文件。
- 中文、Windows 禁用字符、设备名、超长标题、YAML 特殊符号；标题保真而文件名合法。
- 空标题、非法类型、长度 / 标签数量超限、额外 kind / source / path 拒绝，不落盘。
- 无活动项目、切换后过期项目请求拒绝；缺失目录及指向日报的 junction 拒绝。

新增 Electron 测试 `tests/e2e/drafts.spec.ts` 在独立临时博客中验证真实 UI → Preload → IPC → 文件系统：标题必填，初始焦点与取消焦点恢复，回车标签与未回车标签提交，分类 / 摘要，创建后清除筛选并选中草稿，刷新和重启持久性，同名创建，真实目录缺失导致的失败 / 保留表单 / 重试，日报无新建入口且 IPC 拒绝日报参数，Esc 关闭与 1000×680 窗口操作可见性。测试文件不是运行时模拟数据。

首次 E2E 发现并修复：新建弹窗标题未聚焦及取消后的焦点丢失；开发测试与用户已有 5187 会话冲突。修复后完整重测，开发测试用独立空闲 renderer / 调试端口，默认应用仍使用 127.0.0.1:5187，不停止已有会话。

新建弹窗浅 / 深色及小窗口截图位于 `test-results/`（忽略），交付截图归档至 `docs/images/create-draft-*.png`；截图中的「中文 测试博客」为隔离测试项目。新建要求文件系统支持硬链接，本机 Windows NTFS 验证通过；未验收 FAT / 不支持硬链接的网络卷、崩溃恢复、恶意文件系统竞态，失败不以覆盖已有目标作为回退。CodeMirror、保存已有文章、本地站点预览、统计仍未实现，不能把这些检查当作其验收结果。

## 第一阶段基线（历史结果）

验收环境：Windows x64，Node.js 24.16.0，Git 2.52.0.windows.1；Electron 44.7.0。验收日期：2026-10-10（Asia/Shanghai）。

## 执行命令与结果

```powershell
cd F:\astroHub
$env:ASTRO_BLOG_TEST_PATH = 'F:\blog\Astro_Blog'
npm test
npm run test:e2e
npm audit
```

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，TypeScript strict，无类型错误 |
| `npm test`，设置真实博客变量 | 20 / 20 通过，2 个测试文件 |
| `npm run build` | Main / Preload / Renderer 均构建成功 |
| `npm run test:e2e` | 真实 Electron 生产入口与开发命令 2 项场景通过 |
| `npm audit` | 全部依赖 0 个已知漏洞 |
| 真实博客读取 | 45 篇普通文章（44 MD、1 MDX），4 篇 AI 日报；0 扫描错误、0 字段诊断 |
| 原始文件保护 | E2E 前后全部 src/contents 文件 SHA-256 一致，Git 状态一致且干净 |

不设置 `ASTRO_BLOG_TEST_PATH` 时，`npm test` 运行 19 个临时文件系统测试，明确跳过 1 个真实博客专项。E2E 默认使用上述本机博客路径，其他机器请设置变量。

## 服务测试覆盖

- 中文与空格目录、项目验证、禁止执行配置、无 Git 仓库仍可读取。
- 最近项目授权、10 条去重排序、重启恢复、忘记记录、串行原子设置更新。
- 损坏配置原样保留，不静默覆盖。
- 真实标题与文件名不同、published 而非 date、category 单字符串、tags 数组、top 整数。
- 非补零日期、闰日、时区保留、非法日期诊断。
- 普通文章草稿与日报 draft 不适用分开处理，日报必需摘要和可选数组。
- 递归 MDX、UTF-8 BOM、CRLF、未知字段、源码 / 正文保真、revision 随外部变动更新。
- 损坏 YAML、未闭合 frontmatter、别名循环逐文件隔离。
- 路径穿越、绝对路径、Windows ADS、集合外文件、过大文章、junction 逃逸拒绝。
- 真实临时 Git 仓库的 clean / modified / added / untracked / ignored 状态；porcelain rename / conflict 解析；远程凭据脱敏；禁用 fsmonitor。

测试中的 Git init / add / commit 仅操作新建临时 fixture 仓库，用于验证文件状态。业务客户端没有对应写操作，原始博客没有提交或 push。

## Electron 端到端覆盖

生产入口测试启动实际 Electron 二进制，加载构建后的 renderer，经真实 preload / IPC / Node 文件系统完成项目校验和读取。

通过点击 UI 验证选择项目、搜索标题、分类 / 标签过滤、日期排序、分页、日报属性、只读 MDX 源码、重复点击当前文章、刷新、切换项目、浅深色切换和重启恢复。还验证取消目录选择、选择无效 Astro 项目时保留当前项目、任意未授权目录和路径穿越请求被拒绝、renderer 无 require / ipcRenderer，并检查 sandbox / contextIsolation / nodeIntegration 配置。

自动化测试将原生目录对话框的返回值设为测试路径，避免等待人工操作；之后所有业务链路使用真实实现。它不替代人工用 Windows 文件夹选择器点选目录的验收，也不注入模拟文章数据。

开发测试执行 electron-vite dev，连接其实际 Electron 窗口，检查欢迎 UI 与 IPC；验证 `127.0.0.1:5187` 的开发地址。随机调试端口仅由该测试启用，正常 `npm run dev` 不开启远程调试。

测试使用隔离的 Electron 用户配置，不更改日常客户端偏好。截图位于 `docs/images/`：欢迎页、浅色日报详情、深色内容库详情。已检查实际截图的文字、布局、滚动区和主题。

## 验收边界

本阶段没有编辑或发布流程，因此没有运行原博客 dev / build、Git fetch / merge / push，也没有安装包、签名或部署验收。相关能力明确在 FEATURES.md 中列为后续工作。

当前每次手动刷新重新扫描文件；没有外部文件自动监听。单文件上限 4 MB、扫描条目上限 20,000、目录深度上限 32；超限会报告读取问题。本文的安全与正确性结论仅涵盖已列测试，不宣称抵御同机恶意进程持续进行文件系统竞态攻击。
