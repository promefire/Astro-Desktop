# 第一阶段测试记录

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
