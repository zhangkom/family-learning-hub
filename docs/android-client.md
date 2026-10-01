# Android 客户端首轮交付

2026-10-01。工作名称“一起学”，面向大小宝与少数家庭。用户已授权本会话与“大小宝名校计划”并行开发。本文件记录首轮实现，完整教学能力仍以产品设计中的后续阶段为准。

## 分工与集成

| 会话 | 负责范围 | 分支 |
| --- | --- | --- |
| 本会话 | `clients/android/`、孩子端交互、Android 工程、客户端验证与整体联调 | `codex/android-family-client` |
| 大小宝名校计划 | `server/`、`lib/`、现有 `app/`、家长网页、根工具链配置、后台数据与任务 | `codex/mobile-backend-v1` |

接口以另一分支的 `docs/mobile-api-v1.md` 为准，部署基础路径 `/family-learning/api/mobile/v1`。两个分支从 `58b3ee3` 开始，开发目录独立，避免共同修改文件。由本会话收口接口与联调；集成后统一发布，不让两个会话同时操作生产数据、迁移或部署。

项目规模适合两个会话分工。一个会话顺序实现更简单，但界面和后台需要交替等待；当前接口明确后，独立客户端与后台可以并行。无需再按页面拆出更多会话，否则会增加接口协调与合并成本。

## 已实现

- React + Vite 静态客户端与 Capacitor Android 工程，适配手机单栏、平板双栏；当前名称、图标均为开发期默认。
- 家庭登录、服务端会话校验与注销，学生列表、新增学生和本设备选择；浏览器 token 仅内存，原生使用 Android Keystore 加密存储插件。
- 拍照和相册入口，JPEG/PNG/WebP 上传；上传前照片保存在 IndexedDB，按服务地址、家庭、学生隔离，重试复用请求 ID。服务端首轮限单张 8 MiB。
- 扫描列表、任务状态、鉴权原图；切换学生后迟到的列表响应不能覆盖当前学生资料。
- 归一化矩形框选、移动和右下角缩放、补题、拆分区域成新题、合并题目、删除题目/框；支持父题及共用题干/配图引用。
- 逐步手写转写编辑，区分孩子、老师与作者不明，保留涂改、不确定项和原图区域关联。每题可分别核对。
- 校对草稿自动保存在本机，重新打开恢复；409 冲突阻止覆盖，保留、复制或在浏览器导出本机草稿后加载服务器版本。旧轮询结果不能覆盖正在编辑的内容。
- 原生相机恢复事件处理、禁止明文 HTTP 与混合内容、关闭应用自动备份。没有模型密钥进入客户端。

## 本轮没有完成的能力

自动切题的可靠坐标、真实手写识别质量、逐步诊断、分步辅导、独立变式和长期学情尚未通过真实样本验收。首轮后台可返回识别候选；没有可信区域时提示手动框选，不伪造自动框线。此次真实接口联调关闭了模型调用。

APK 编译成功不等于真机相机、Keystore、相机进程恢复或各种厂商 WebView 已通过验证。尚未连接真实手机/平板进行这些检查，也未发布生产、分发给试用家庭或配置长期发布签名。开发 APK 不作为日常使用版；生产接口启用后还需真机验收。

## 开发与构建

客户端是独立 npm 项目，不修改服务器根 `package.json` 或锁文件。Node 24；Android 使用 Java 21、SDK 36 与项目 Gradle Wrapper。依赖由客户端 `package-lock.json` 固定。

```powershell
cd clients/android
npm ci --no-audit --no-fund
npm run dev
npm run build
npm run lint
npm test
npm run android:sync
cd android
.\gradlew.bat :app:assembleDebug
```

Vite 仅监听 `http://127.0.0.1:3178`。本机 Windows 排除端口包含 4178，故不用该端口。开发后端的 `FAMILY_MOBILE_ORIGINS` 需精确包含此来源和 Android 的 `https://localhost`，浏览器请求 `credentials: omit`；不要放宽网页 Cookie 路由的同源规则。

构建时可设置 `VITE_API_URL=https://自己的服务/family-learning/api/mobile/v1`，只放公开服务地址。未设置时，登录页提供初次服务地址配置。仅开发模式允许回环 HTTP；APK 和生产 Web 构建要求 HTTPS。不要在 APK 中使用 `server.url` 直接加载远程网页，也不要关闭证书验证。

默认生成 `android/app/build/outputs/apk/debug/app-debug.apk`，是调试签名。正式家庭试用版另行建立可持续保管的发布签名，不能把签名私钥、密码、学习原件和测试账号提交 Git。

## 验证记录

已通过客户端 TypeScript 与生产 Web 构建、客户端独立 lint、题目关系与区域单元测试、Capacitor 同步及 Android 调试 APK 编译。

`scripts/verify-browser.mjs` 使用合成照片和模拟接口，覆盖家庭登录、学生切换、第三名学生、草稿归属、上传、矩形绘制、步骤保存、版本冲突及冲突草稿重开，并检查 390px 手机页面无横向溢出。截图保存在忽略目录 `clients/android/test-results/`；界面中的样题标明合成资料。

`scripts/verify-integration.mjs` 使用后台会话提供的真实本机接口，验证登录/注销、新增动态学生、multipart 上传、鉴权原图、题目框和步骤保存后重开、本机校对草稿恢复及学生隔离。脚本拒绝非回环地址、非合成数据服务及开启模型调用的配置。连接文件通过 `FAMILY_DEV_CONNECTION_PATH` 指定，凭据不输出、不提交。

浏览器测试使用 `PLAYWRIGHT_MODULE_PATH` 指定已安装的 Playwright；默认 Chrome，可通过 `PLAYWRIGHT_CHANNEL` 更改。它们不测试 OCR 准确率或真实相机。真实接口结果保存在 `test-results/integration-result.json`。

下一轮按优先级验证：真实 Android 登录与拍照、专用切题及手写服务的授权样本、第一处可观察错误定位，再接入辅导和独立变式。多页整卷自动拼接与更多科目仍在后续范围。
