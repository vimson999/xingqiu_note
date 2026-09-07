# PRD：基于真实浏览器的豆包朗读音频生成服务

## 1. 背景

当前已经验证：豆包网页端的“朗读”音频不是普通的 mp3/wav/m4a 下载链接，而是网页通过 WebSocket/AudioWorklet 播放的实时音频数据。

在豆包页面中，朗读音频最终会以 `Float32Array` PCM 片段的形式，通过：

```js
MessagePort.prototype.postMessage({
  message: "dataIn",
  data: Float32Array(...)
})
```

发送给 AudioWorklet。当前 Chrome 插件方案通过注入页面主环境，劫持 `MessagePort.prototype.postMessage`，捕获 `dataIn` PCM 数据，并按 `24000Hz / mono / 16bit PCM` 封装为 WAV 文件。

本 PRD 目标是把这个能力从“人工打开网页并手动下载”扩展为“外部系统提交文本，自动化浏览器完成豆包交互，最终产出 WAV 文件”的内部工具。

## 2. 产品目标

构建一个本地/内网服务，使调用方可以通过接口提交文本任务，由系统自动控制已登录豆包账号的真实浏览器：

1. 打开豆包网页。
2. 输入用户文本。
3. 等待豆包回复。
4. 触发豆包朗读。
5. 通过插件捕获朗读 PCM。
6. 导出 WAV。
7. 返回任务状态和 WAV 下载地址。

核心定位：**个人或内部低并发自动化工具**，不是公开高并发 TTS 服务。

## 3. 非目标

以下内容不在第一版范围内：

- 不导出豆包 Cookie 到后端系统。
- 不模拟豆包私有接口。
- 不复刻豆包 WebSocket 协议。
- 不绕过登录、验证码、风控或平台限制。
- 不做高并发任务。
- 不承诺商业级稳定性。
- 第一版不做 MP3，仅输出 WAV。

## 4. 技术路线选择

### 4.1 不推荐方案：Cookie + 后端模拟请求

理论上可以尝试导出 Cookie，并在后端复刻豆包网页请求。但该方案不适合作为主方案。

主要问题：

- 仅 Cookie 通常不够，可能还需要 localStorage、设备 ID、CSRF、动态签名、conversation id、WebSocket 状态。
- 前端协议更新后容易失效。
- 账号凭证进入后端系统，安全风险高。
- 更容易触发风控。
- 维护成本不可控。

### 4.2 推荐方案：真实浏览器自动化 + 插件 PCM 捕获

使用 Playwright/Puppeteer 控制真实 Chrome 页面，由浏览器保留登录态并正常访问豆包网页。

优势：

- 不暴露 Cookie 给调用方。
- 不复刻豆包接口协议。
- 登录态、页面状态、风控提示都由真实浏览器处理。
- 只要豆包网页能正常播放朗读，插件即可捕获 PCM。
- 更接近人工操作路径。

限制：

- 单账号/单浏览器应串行处理任务。
- 速度受豆包生成和朗读播放时间影响。
- 页面 UI 改版会影响自动点击逻辑。
- 登录失效、验证码、风控提示需要人工处理。

## 5. 系统架构

```text
调用方
  |
  | POST /api/doubao-tts/jobs { text }
  v
API 服务
  |
  | 创建任务
  v
任务队列
  |
  | 串行调度
  v
浏览器 Worker
  |
  | Playwright 控制真实 Chrome
  v
豆包网页
  |
  | 提交文本 -> 等待回复 -> 点击朗读
  v
Chrome 插件注入脚本
  |
  | 捕获 dataIn PCM -> 封装 WAV
  v
本地文件存储
  |
  | 返回 WAV 下载地址
  v
调用方
```

## 6. 依赖组件

### 6.1 Chrome 插件

插件负责在豆包页面中捕获音频：

- content script 在 `document_start` 注入。
- injected script 运行在页面主环境。
- 劫持 `MessagePort.prototype.postMessage`。
- 捕获 `message === "dataIn"` 的 Float32 PCM。
- 提供页面函数：

```js
window.downloadDoubaoWav()
window.clearDoubaoAudio()
```

建议进一步提供内部函数，便于自动化脚本直接获取 Blob 或触发下载。

### 6.2 Playwright 浏览器 Worker

Worker 负责：

- 启动带固定 `userDataDir` 的 Chrome。
- 加载 Chrome 插件。
- 打开豆包页面。
- 保持豆包登录态。
- 执行任务队列中的文本。
- 监听下载事件。
- 保存 WAV 到指定目录。

### 6.3 API 服务

API 服务负责：

- 接收任务。
- 校验参数。
- 入队。
- 查询状态。
- 提供下载。
- 记录日志。

## 7. 用户流程

### 7.1 初始化流程

1. 运维/用户启动本地服务。
2. 服务启动 Playwright Chrome。
3. Chrome 加载豆包音频捕获插件。
4. 用户首次手动登录豆包。
5. 服务确认豆包页面可访问、插件已注入。
6. 系统进入 `READY` 状态。

### 7.2 单任务流程

1. 调用方提交文本。
2. API 返回 `job_id`。
3. Worker 获取任务。
4. Worker 清空豆包音频缓存。
5. Worker 在豆包输入框填入文本。
6. Worker 点击发送。
7. Worker 等待豆包回复完成。
8. Worker 点击豆包朗读按钮。
9. 插件捕获 PCM 片段。
10. Worker 等待音频片段稳定或朗读结束。
11. Worker 触发 WAV 下载。
12. Worker 保存 WAV 文件。
13. 任务状态变为 `SUCCEEDED`。
14. 调用方下载 WAV。

## 8. API 设计

### 8.1 创建任务

```http
POST /api/doubao-tts/jobs
Content-Type: application/json
Authorization: Bearer <token>
```

请求：

```json
{
  "text": "需要让豆包回复并朗读的文本",
  "metadata": {
    "source": "optional-source-id"
  }
}
```

响应：

```json
{
  "job_id": "job_20260614_000001",
  "status": "queued"
}
```

### 8.2 查询任务状态

```http
GET /api/doubao-tts/jobs/{job_id}
Authorization: Bearer <token>
```

响应：

```json
{
  "job_id": "job_20260614_000001",
  "status": "running",
  "step": "playing_audio",
  "progress": 70,
  "created_at": "2026-06-14T10:00:00+08:00",
  "started_at": "2026-06-14T10:00:03+08:00",
  "completed_at": null,
  "error": null,
  "audio": {
    "chunks": 18,
    "seconds": 23.4,
    "sample_rate": 24000
  }
}
```

### 8.3 下载 WAV

```http
GET /api/doubao-tts/jobs/{job_id}/download
Authorization: Bearer <token>
```

成功时返回：

```http
Content-Type: audio/wav
Content-Disposition: attachment; filename="job_20260614_000001.wav"
```

### 8.4 取消任务

```http
POST /api/doubao-tts/jobs/{job_id}/cancel
Authorization: Bearer <token>
```

## 9. 任务状态机

```text
queued
  -> running
  -> succeeded
  -> failed
  -> canceled
```

`running` 内部步骤：

```text
prepare_browser
clear_audio_cache
submit_text
wait_response
start_reading
capture_audio
download_wav
save_file
```

失败状态示例：

```text
login_required
captcha_required
page_not_ready
input_not_found
send_failed
response_timeout
read_button_not_found
audio_capture_timeout
download_failed
unknown_error
```

## 10. 功能需求

### 10.1 任务提交

- 支持通过接口提交文本。
- 文本不能为空。
- 第一版限制文本长度，例如 5000 字以内。
- 超长文本直接拒绝或进入拆分策略，MVP 建议直接拒绝。

### 10.2 队列调度

- MVP 只支持单 Worker 串行执行。
- 同一时间只允许一个任务控制豆包页面。
- 新任务进入队列等待。
- 支持任务超时。

建议超时：

- 等待豆包回复：120 秒。
- 等待音频捕获开始：30 秒。
- 等待音频稳定：60 秒或按文本长度动态调整。
- 总任务超时：300 秒。

### 10.3 浏览器自动化

Worker 需要完成：

- 打开豆包页面。
- 检测是否登录。
- 定位输入框。
- 填入文本。
- 点击发送。
- 等待回复完成。
- 定位朗读按钮。
- 点击朗读。
- 等待插件捕获音频。
- 触发 WAV 下载。

页面选择器必须集中维护，避免散落在业务代码里。

### 10.4 音频捕获

插件捕获要求：

- 捕获 `dataIn`。
- PCM 数据复制后保存，避免源 ArrayBuffer 被复用或释放。
- 固定采样率 24000Hz。
- 输出 WAV：
  - mono
  - 16bit PCM
  - `.wav`

### 10.5 文件存储

WAV 文件保存到服务端本地目录，例如：

```text
storage/doubao_tts/{yyyyMMdd}/{job_id}.wav
```

同时保存任务元数据：

```json
{
  "job_id": "job_20260614_000001",
  "text_hash": "sha256...",
  "wav_path": "storage/doubao_tts/20260614/job_20260614_000001.wav",
  "duration_seconds": 23.4,
  "sample_rate": 24000,
  "chunks": 18
}
```

## 11. 安全与边界

### 11.1 账号安全

- 不允许调用方传入或读取豆包 Cookie。
- 登录态只保存在本机 Chrome profile / Playwright `userDataDir`。
- 不对外暴露浏览器调试端口。
- API 必须加鉴权。

### 11.2 访问控制

接口必须支持：

- API token。
- IP 白名单，视部署环境决定。
- 文本长度限制。
- 调用频率限制。
- 队列长度限制。

### 11.3 合规边界

系统不得实现：

- 绕过登录。
- 绕过验证码。
- 绕过风控。
- 批量高并发规避平台限制。
- 抓取或转存用户 Cookie 给第三方。

如果页面出现验证码、登录异常、风控提示，Worker 应停止任务并返回人工处理状态。

## 12. 可观测性

每个任务需要记录：

- 创建时间。
- 开始时间。
- 完成时间。
- 当前步骤。
- 页面 URL。
- 关键 DOM 是否找到。
- 音频片段数。
- 捕获时长。
- 下载文件路径。
- 错误栈。
- 截图，失败时保存。

建议日志示例：

```text
[job_001] prepare_browser ok
[job_001] clear_audio_cache ok
[job_001] submit_text ok length=128
[job_001] wait_response ok elapsed=18.2s
[job_001] start_reading ok
[job_001] capture_audio chunks=16 seconds=21.8
[job_001] download_wav ok path=...
```

## 13. MVP 验收标准

### 13.1 服务可启动

- 启动 API 服务。
- 启动 Playwright Chrome。
- Chrome 加载豆包音频捕获插件。
- 登录态有效时，服务状态为 `READY`。

### 13.2 单任务成功

提交一段短文本：

```json
{
  "text": "请用一段话解释液冷服务器的价值。"
}
```

系统应：

- 成功提交到豆包。
- 等待豆包回复。
- 成功触发朗读。
- 捕获 PCM。
- 生成 WAV。
- `GET /download` 可以下载文件。
- WAV 可正常播放。

### 13.3 连续任务成功

连续提交 3 个任务：

- 任务必须串行执行。
- 每个任务开始前必须清空音频缓存。
- 每个 WAV 不包含上一个任务的音频。

### 13.4 失败可诊断

当豆包未登录、找不到朗读按钮、超时等情况发生时：

- 任务进入 `failed`。
- 返回明确错误码。
- 保存失败截图和日志。

## 14. 迭代计划

### Phase 1：MVP

- API 服务。
- 单 Worker 串行队列。
- Playwright 控制豆包网页。
- 使用现有插件捕获 PCM。
- WAV 下载。
- 基础日志和失败截图。

### Phase 2：稳定性

- 更稳的 DOM 选择器。
- 登录态检测。
- 风控/验证码检测。
- 音频结束检测优化。
- 任务重试。

### Phase 3：体验优化

- 管理后台。
- 队列可视化。
- 文件名自定义。
- 批量文本导入。
- WAV 转 MP3，可选。

## 15. 关键技术风险

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 豆包 UI 改版 | 自动化点击失效 | 选择器集中维护，失败截图辅助修复 |
| 登录失效 | 任务无法执行 | Worker 检测登录态，返回 `login_required` |
| 验证码/风控 | 任务中断 | 不绕过，返回人工处理状态 |
| 音频未捕获 | 无法生成 WAV | 检查插件注入、朗读按钮、dataIn 捕获 |
| 多任务并发污染 | WAV 串音或页面状态错乱 | MVP 严格串行 |
| HTTP 同步超时 | 调用失败 | 使用异步任务 API |

## 16. 推荐技术栈

- API：FastAPI / Flask / Node.js Express，任选团队熟悉方案。
- 队列：内存队列 MVP；后续可换 Redis Queue / Celery / BullMQ。
- 浏览器自动化：Playwright。
- 浏览器：Chromium/Chrome persistent context。
- 文件存储：本地目录 MVP；后续可换对象存储。
- 数据库：SQLite MVP；后续 PostgreSQL。

## 17. 实现建议

第一版建议不要做复杂抽象，先打通单机链路：

```text
POST text
  -> enqueue
  -> Playwright 单任务执行
  -> WAV 保存到本地
  -> 返回 download URL
```

等稳定后，再考虑多账号、多 Worker、后台管理、MP3 转码。

## 18. 结论

该方案技术上可实现，且比“导出 Cookie 后端模拟豆包请求”更稳定、更安全。

适用场景：

- 个人使用。
- 内部低频任务。
- 成本敏感、但可接受真实网页等待时间的自动化流程。

不适用场景：

- 公开商业 API。
- 高并发 TTS 服务。
- 无人值守且要求强 SLA 的生产系统。
