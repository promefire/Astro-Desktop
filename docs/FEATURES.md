# 第一阶段功能状态

本文件描述当前交付；ASTRO_DESKTOP_FEATURES.md 描述完整产品规划。

| 模块 | 当前范围 |
| --- | --- |
| 项目初始化 | Electron / React / TypeScript strict / Vite / Tailwind，Main / Preload / Renderer 分层 |
| 桌面 UI | 欢迎、文章、普通文章、草稿、AI 日报、项目设置路由，列表与只读详情 |
| 项目接入 | Windows 原生目录选择，Astro / collection / Git 检查，最近项目及恢复 |
| 内容读取 | 真实递归 MD / MDX，Frontmatter、日期、类型、分类、标签及诊断 |
| 日报 | 独立 summary / highlights / tools / tags；无草稿控制 |
| 浏览 | 搜索、分类 / 标签筛选、排序和分页；源码只读，资源管理器定位 |
| 本地状态 | Git 只读状态，刷新，失败原因与异常文件提示 |
| 外观 | 浅色 / 深色 / 跟随系统，持久化 |
| 服务契约 | 编辑、资源、恢复、预览、Git 写操作与发布接口，尚无实现 |

未实现：克隆、环境版本探测界面、文章新建 / 编辑 / 删除 / 恢复、CodeMirror、Markdown 渲染预览、图片管理、自动保存、外部文件监听、Astro 进程控制、Git fetch / commit / merge / push、部署状态接入、安装包完整验收。这些功能没有假按钮或模拟成功。

下一阶段先完成「新建草稿 → 保真编辑 → 防冲突保存 → 恢复」闭环，然后实现图片与真实 Astro 预览，最后开发 Git 发布编排。
