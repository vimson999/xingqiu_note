# Knowledge Planet Assistant (知识星球助手) - 项目文档

## 1. 项目目标 (Project Goals)
打造一个半自动化的谷歌浏览器插件，辅助用户高效管理知识星球内容。
- **阶段一 (完成)**: 基础架构搭建，实现页面扫描与基础下载逻辑。
- **阶段二 (完成)**: 专家级 Dashboard 建设，支持批量下载、风控延时、列表管理。
- **阶段三 (完成)**: 上传辅助系统，支持自动填表与发布加速。
- **阶段四 (当前)**: 深度自动化与稳定性优化，攻克异步数据抓取痛点。

## 2. 研发标准 (Development Standards)
- **架构模式**: 专家级模块化架构 (src/config, src/utils, src/core, src/content, src/background)。
- **日志规范**: 结构化彩色日志，记录 [时间] [级别] [模块] [描述]。支持从 `chrome.storage.local` 回溯。
- **技术栈**: Manifest V3, Vanilla JS, CSS3。
- **配置管理**: 所有的选择器、API 路径均定义在 `src/config/` 中，严禁硬编码。
- **异常处理**: 全局 Try-Catch 覆盖关键逻辑，对异步 DOM 操作采用轮询校验机制。

## 3. 目录结构 (Directory Structure)
- `src/config/`: 全局配置（API、DOM 选择器、机构字典）。
- `src/utils/`: 通用工具（Logger, DOM Helper, Storage Wrapper）。
- `src/core/`: 核心业务逻辑（Downloader, Uploader）。
- `src/content/`: 页面注入逻辑（MutationObserver, 消息监听）。
- `src/background/`: Service Worker（任务调度、下载管理）。
- `src/popup/`: 交互 Dashboard UI（列表、排序、过滤）。

## 4. 项目记录 (Project Logs)
- **2026-03-18**: 
  - 项目初始化，确立专家级研发纪律。
  - 完成 v0.1.0 - v0.4.4 迭代。
  - 核心突破：攻克 Angular 异步详情层数据抓取，实现“身份校验”式深度扫描。
  - 完善功能：机构过滤、时间排序、高热度高亮、批量下载、上传辅助。

## 5. 明日计划 (Future Plans)
- [ ] **稳定性测试**: 针对长列表（>50个文件）进行深度扫描压力测试。
- [ ] **上传辅助增强**: 优化多文件并发上传时的标题自动填充逻辑。
- [ ] **UI 视觉打磨**: 引入专业图标库，优化 Dashboard 在不同分辨率下的显示。
- [ ] **配置中心化**: 允许用户在 UI 上直接修改 20s 等风控参数。
