# 第一阶段开发记录

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

1. CodeMirror 源码编辑、新建 draft:true 普通文章；AI 日报独立表单。
2. YAML AST 最小更新，保留未知字段、注释、行尾与 MDX import / 表达式。
3. 基于 revision 的并发写入检测、原子保存、恢复记录与外部文件变更提示。
4. 资源导入及文章相对链接，再实现真实 Astro dev 脚本与准确 URL。
5. 最后实现选择性提交、安全合并服务器日报、构建校验与显式推送。

研究发现普通文章直接路由可能生成 draft 页面；发布阶段必须验收 RSS、搜索及直接 URL 的草稿行为。参见 RESEARCH.md。当前没有修改原博客以解决后续阶段问题。
