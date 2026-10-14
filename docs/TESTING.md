# 测试记录

## 2026-10-14：Markdown HTML 支持开关

- `npm run build` 通过。
- `npm test`：**88 通过、1 跳过**。跳过项仍是未设置 `ASTRO_BLOG_TEST_PATH` 的真实博客专项。设置测试确认默认关闭、重启后保持打开，以及旧设置文件缺少 `markdownHtml` 时按关闭读取且不重写文件。
- `npx playwright test tests/e2e/markdown-html.spec.ts` 通过。隔离文章默认带 `mu-disable-html-render`；打开「启用 HTML 支持」后，光标离开 HTML 块时预览包含「彩色块」；再关闭后恢复原始标签。文章文件字节不变。
- 没有改写 `F:\blog\Astro_Blog`。

## 2026-10-14：编辑模式显示远程图片

- `npm run build` 通过。
- 新增 Electron 测试 `renders an https image inside the editor`：拦截一篇隔离文章中的 `https` 图片并确认编辑区能画出图片，页面不再出现 “Load image failed”，磁盘上的链接保持原样。该项通过。
- 没有改写 `F:\blog\Astro_Blog`。

## 2026-10-14：编辑模式与源码模式

- `npm run typecheck` 通过，`npm run build` 通过。
- `npm test`：**87 通过、1 跳过**。跳过项是 `tests/real-blog.test.ts`，因为没有设置 `ASTRO_BLOG_TEST_PATH`。`tests/source-state.test.ts` 覆盖 Frontmatter 按字节保留、注释和字段顺序，以及只把换行差异视为相同。
- `npx playwright test tests/e2e/`：12 项里 11 项通过。`desktop.spec.ts` 仍按「MDX 必须看到 Muya」断言，与「MDX 只进入源码模式」冲突而失败。断言改为源码模式、禁用编辑模式、不创建 Muya 后，单独重跑 `tests/e2e/desktop.spec.ts` 通过。同一构建上的其余 11 项已通过，没有在改断言后把全套再跑一遍。
- 模式专项 `tests/e2e/editor-modes.spec.ts` 覆盖：`.md` 默认编辑模式且正文可见；两种模式来回切换不丢文、不重复正文、切换本身不写文件；两种模式保存都写入真实文件并保留 Frontmatter；CRLF 标题可渲染且未保存前磁盘换行不变；未保存时的导航和关闭保护；恢复、放弃修改和重新加载同步两个编辑器；源码模式查找替换、撤销重做和 Ctrl+S；两个模式插入图片且第二次插入使用新文件名；`.mdx` 不能进入 Muya；深色主题、长文滚动和窄窗口；切换文章后正文不串篇。
- `tests/e2e/dev.spec.ts` 在开发模式 StrictMode 下确认只有一个 Muya 实例。
- 真实博客 E2E 使用默认路径 `F:\blog\Astro_Blog`，只读打开。测试前后比较 `src/contents` 文件哈希和 `git status --porcelain`，两者一致。没有保存、发布或提交原始博客。
- 测试截图在 `test-results/`，不纳入提交。本轮 E2E 重写过 `docs/images/` 下的文档截图，提交前已恢复为原版本。

## 2026-10-14：Muya 正文挂载与显示回归

- 修复前：新增开发模式回归无法找到 `.muya-editor-host`，复现 React StrictMode 重挂载后的空白问题。
- 修复后：`npm test` **86 通过、1 跳过**；跳过项为未设置 `ASTRO_BLOG_TEST_PATH` 的真实博客专项。
- `npm run build` 通过，包含 TypeScript strict 检查及 Main / Preload / Renderer 构建。
- Electron E2E **6 / 6 通过**：`dev.spec.ts`、`drafts.spec.ts`、`editor.spec.ts`、`external-editor.spec.ts`、`images.spec.ts`、`publish.spec.ts`。本次没有宣称全套 E2E 重跑。
- 开发回归验证正文实际存在、仅一个 Muya 实例、两篇文章反复切换不串文、CRLF 标题渲染为 h1、长文可滚到末尾、深色文字颜色及打开不修改原文件。
- 真实 `F:\blog\Astro_Blog` 只读打开抽查无 renderer 异常；前后比较内容目录中 57 个 Markdown/MDX 文件 SHA-256，均未改变。没有保存、发布或提交原始博客。
- 测试截图保存在 `test-results`，未纳入提交；旧测试自动生成的文档截图恢复为原版本。

## 2026-10-13：Muya 编辑器替换 CodeMirror（完整回归通过）

本次结果：TypeScript strict 通过；**86 / 86** 个单元测试通过（15 个测试文件，1 个真实博客专项因未设置 `ASTRO_BLOG_TEST_PATH` 跳过）；Main / Preload / Renderer 构建通过；完整 Electron E2E **10 / 10** 通过（删除、桌面、开发、草稿、编辑器、外部编辑器、图片、预览、发布、统计）。没有修改 `F:\blog\Astro_Blog`。

命令：`npm run typecheck`、`$env:ASTRO_BLOG_TEST_PATH = 'F:\blog\Astro_Blog'; npm test`、`npm run build`、`npx playwright test tests/e2e/`。

新增 `src/renderer/src/components/MuyaEditor.tsx`：Muya React 适配层。创建/销毁、`json-change` 事件获取正文（source=user）、撤销/重做、只读、图片粘贴（捕获阶段拦截 `paste`，避免与 Muya 默认粘贴重复）、Ctrl+S。删除 `SourceEditor.tsx`、`MarkdownPreview.tsx`，移除 CodeMirror 6、@lezer、react-markdown、remark-gfm 依赖。

重写 `ArticleEditor.tsx`：`extractFrontmatter` 保留原始 frontmatter，保存时与正文拼接。移除模式切换（源码/预览/左右分栏）、分隔条、预览窗格。状态改为正文（body）+ frontmatterRef。工具栏简化为撤销/重做、插入图片、外部编辑器、站点预览、重新加载、导出副本。

简化 `source-state.ts` 为 `markdownBody()`（从源提取正文）。更新 `editor.css` 适配 Muya 布局。

更新测试：

- `tests/source-state.test.ts`：保留 `markdownBody`（混合换行提取正文，3 项），移除 CodeMirror 撤销/重做坐标测试。
- `tests/e2e/editor.spec.ts`：适配 Muya DOM（`.muya-editor-host`、`muya.getMarkdown`、`muya.undo`），移除模式切换、分隔条、预览、查找替换场景。
- `tests/e2e/paste-images.spec.ts`：适配 Muya 图片粘贴（捕获阶段拦截，不经过 Muya 默认粘贴）。

回归验证：完整 Electron E2E **10 / 10** 通过。原有保存、恢复记录、外部编辑器、新建草稿、文章图片、列表删除、统计、本地预览、发布、安全保存等 E2E 流程在 Muya 编辑器下全部通过。

Muya 会规范化 Markdown 正文（空格、空行等可能改变），保存后与手动逐字节编辑源码不完全一致。Frontmatter 原文保留。MDX 可打开但不可通过 Muya 安全保存。详细见 [EDITOR.md](EDITOR.md)。

## 2026-10-13：自动 WebP 压缩

图片处理、图片存储与发布回归 18/18 通过；Electron 图片选择、真实 WebP 落盘、预览及保存端到端测试 1/1 通过；npm run build（包含 strict 类型检查）通过。测试真实 WebP 解码、体积压缩、透明度、方向、动画、无效输入及 S3 请求 MIME。云端请求使用注入 fetch，未访问真实 R2。

## 2026-10-13：S3 图片路径与随机文件名

- `npx vitest run tests/images.test.ts`：**9 / 9 通过**。验证远程请求路径仅含 `astro-desktop/` 与时间戳随机文件名，返回 Markdown URL 与对象路径一致，上传字节及 Content-Type 保留；无本地副本。
- 新增命名测试：固定本地日期、月日时分秒补零、WebP / JPEG / PNG 扩展名保留、同名图片在同一秒生成不同随机名称。
- 新增碰撞测试：请求携带并签名 `If-None-Match: *`，HTTP 412 返回名称冲突，不生成成功链接、不重试覆盖。原有本地图片、设置与监听专项继续通过。
- `npm run build`：包含 TypeScript strict 检查，Main / Preload / Renderer 均通过。
- S3 请求使用注入的 fetch 验证，不代表已完成新命名规则的真实 R2 上传验收。没有使用真实凭据，没有移动旧远程对象，没有修改原始博客。本次不涉及 UI 改动，未重跑全套 Electron E2E。

## 2026-10-13：发布到正文

本次在隔离临时博客中验证。发布只移动草稿和图片目录。共享图片会复制并保留原目录。目标冲突和磁盘版本不一致时不移动。中断后原文件和图片仍在草稿目录。设置真实博客变量后 **71 / 71** 个单元测试通过（13 个文件）；完整 Electron E2E **11 / 11** 通过。没有修改 `F:\blog\Astro_Blog`。

新增 `tests/publish-draft.test.ts` 与 `tests/e2e/publish.spec.ts`。

## 2026-10-13：文章图片

本次在隔离临时博客中验证。TypeScript strict 通过；设置真实博客变量后 **66 / 66** 个单元 / 文件系统测试通过（12 个文件）；Main / Preload / Renderer 构建通过；完整 Electron E2E **10 / 10** 通过。没有修改 `F:\blog\Astro_Blog`。S3/R2 使用注入的 fetch 检查签名请求和失败时不落本地文件，没有连接真实对象存储。

新增 `tests/images.test.ts` 与 `tests/e2e/images.spec.ts`。同名占用同时看 `.md`、`.mdx` 和图片目录。中文与空格路径按段编码。旧的 `./images/` 布局仍能在同一内容目录内预览。目录联接拒绝写入。

## 2026-10-12：列表删除文章

本次结果：TypeScript strict 通过；设置真实博客变量后 **59 / 59** 个单元 / 文件系统测试通过（11 个文件）；Main / Preload / Renderer 构建通过；完整 Electron E2E **9 / 9** 通过；依赖审计 **0** 个已知漏洞。没有修改 `F:\blog\Astro_Blog`。

命令：`npm run typecheck`、`$env:ASTRO_BLOG_TEST_PATH = 'F:\blog\Astro_Blog'; npm test`、`npm run test:e2e`（含构建）、`npm audit`。

新增 `tests/delete-article.test.ts`：只删除选中的草稿文件，并清掉它的恢复记录；同项目的正文和日报保留。硬链接、名为文章的目录、目录联接、路径穿越和切换后的旧项目请求都会拒绝，原文件仍在。

新增 `tests/e2e/delete.spec.ts`：隔离临时博客中，三点菜单打开删除项；取消和 Esc 不改文件；确认后该草稿从列表和磁盘消失，另一篇正文保留。

## 2026-10-12：简洁文章统计

本次结果：TypeScript strict 通过；设置真实博客变量后 **57 / 57** 个单元 / 文件系统测试通过（10 个文件）；Main / Preload / Renderer 构建通过；完整 Electron E2E **8 / 8** 通过；依赖审计 **0** 个已知漏洞。没有新增依赖。没有修改 `F:\blog\Astro_Blog` 的文件，也没有执行它的 dev、commit 或 push。

命令：`npm run typecheck`、`$env:ASTRO_BLOG_TEST_PATH = 'F:\blog\Astro_Blog'; npm test`、`npm run test:e2e`（含构建，临时目录设为 `F:\tmp`）、`npm audit`。

新增 `tests/article-stats.test.ts`：正文、草稿、日报按目录互斥；`post` 中的 `draft: true`、`drafts` 中的 `draft: false` 和无 `draft` 字段不改变分类。分类和标签只统计正文与草稿。重复标签只计一次，大小写不同的标签不合并。未填写 category 与名为「未分类」的分类分开。无效 category / tags 不计入排行，也不算作未分类或无标签。数量相同按名称稳定排序。筛选结果数量与统计相同。空项目只保留读取失败数。

新增 `tests/e2e/stats.spec.ts`：隔离临时博客中，Electron 读取三个目录并打开对应列表。点击分类、标签和无标签后的筛选数量与统计一致，筛选可清除。未保存修改取消后不改文件、不改变统计；保存分类后排行更新。新建草稿后草稿数和分类数更新。外部新增文件在刷新前不计入，刷新后计入。切换项目后不再显示上一项目的数量；缺失的草稿目录单独提示。1000×680 的浅色 / 深色截图在 `docs/images/stats-light.png` 与 `docs/images/stats-dark.png`，路径位于 `F:\tmp`。

预览进程测试清理临时目录时，Windows 可能短暂返回 EBUSY。清理增加了有限次重试，避免把已结束的进程记成测试失败。

已在本机 Windows 验证。统计不监听文件变化，不请求远程分析，也不表示文章已经发布。

## 2026-10-12：按目录区分正文与草稿

本次结果：TypeScript strict 通过；设置真实博客变量后 **54 / 54** 个单元 / 文件系统测试通过（9 个文件）；Main / Preload / Renderer 构建通过；完整 Electron E2E **7 / 7** 通过；依赖审计 **0** 个已知漏洞。没有新增依赖。没有修改 `F:\blog\Astro_Blog` 的文件，也没有执行它的 dev、commit 或 push。

命令：`npm run typecheck`、`$env:ASTRO_BLOG_TEST_PATH = 'F:\blog\Astro_Blog'; npm test`、`npm run test:e2e`（含构建）、`npm audit`。

`tests/drafts.test.ts` 增加目录分类：`post` 中的 `draft: true` 仍是正文，`drafts` 中的 `draft: false` 和无 `draft` 字段仍是草稿。缺失的草稿目录会提示且不把正文算成草稿；新建时只在项目内创建该目录。上级目录缺失、目录联接指向日报目录时拒绝写入。保存草稿仍写回原路径。新建文件不再包含 `draft:`。

预览测试确认 `src/contents/drafts` 没有站点路由时不调用打开函数。外部编辑器测试确认草稿路径会交给默认打开函数，且不改文件。Electron 新建场景确认新文件落在草稿目录，带 `draft: true` 的正文仍出现在正文列表。

真实博客目前没有 `src/contents/drafts`。读取会报告该目录不存在，不会自动创建。Git 状态在读取前后不变。

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
HTML / MDX 表达式不执行，原始 HTML 图片和脚本不进入预览；Markdown 里的 https 图片会显示。链接不导航。1000×680 窗口操作可见；原文件删除后恢复记录可查看、取消导出、真实导出及明确丢弃。

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
