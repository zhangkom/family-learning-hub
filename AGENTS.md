# Family Learning Hub

## 工作位置

- 腾讯云工程总目录：`/home/ubuntu/codex_project/workspace_own/family-learning-hub`；源码与 Git 根目录在其 `code/` 子目录。
- GitHub：`https://github.com/zhangkom/family-learning-hub`；当前功能分支为 `codex/family-private-sync`。
- 正式服务运行于工程内 `runtime/current`，由 `family-learning-hub.service` 管理。目录职责见 `docs/工程目录.md`。
- 同级 `7080laoyou` 属于另一个项目及其上传存档，不属于本项目操作范围。

## 开发与验证

使用 Node 24。首次执行 `npm ci --no-audit --no-fund`；Windows 与 Linux 的依赖分别安装，不复制 `node_modules`。

本项目检查：`npm test`、`npx tsc --noEmit`、`npx oxlint app server lib scripts vite.config.ts`、`npm run build:self-hosted`。
全仓库 `npm run lint` 在原有通用 UI 组件中存在已知问题，不能将它表述为通过。
浏览器验证使用 `scripts/verify-family.mjs`；它创建独立测试数据和临时服务。没有设置 `FAMILY_TEST_AI=1` 时不会调用真实模型。

开发服务器应只监听回环地址并使用独立端口、独立测试数据目录。构建项目不会自动发布；发布按 `docs/腾讯云部署.md` 执行，保留旧版本和回退路径。

## 数据与凭据

正式学习数据在工程总目录的 `data/`，配置在 `config/`。应用使用专用系统用户 `family-learning-app`，由 systemd 的私有挂载视图限制访问范围。
密钥、启用码、真实扫描、学习数据库和备份不得进入 Git、公开静态目录、日志或构建产物。
`work/`、`outputs/`、`dist/` 与 `private-learning-data/` 为忽略目录；其中本次移交的 QA 截图及备份文件使用合成测试数据。
定时完整备份在 `backups/daily/`，发布前备份在 `backups/releases/`，迁移回退资料在 `backups/migrations/`。不要把整个工程根目录初始化为 Git 仓库。

## Android 交付

用户于 2026-10-01 明确要求：每次生成用于交付的 APK，都上传到腾讯云，并在回复中提供可下载地址。仅有本地文件或服务器私有归档不算完成交付。

下载入口只公开 APK 和必要的公开版本信息；不得直接开放 `artifacts/`、源码包、Git bundle、配置或学习数据。每版保留独立地址，验证公网 HTTPS 下载和 SHA-256，并更新最新版本入口。交付说明包含版本、文件大小、验证状态及尚未完成的关键功能。

同一应用的后续安装更新递增 `versionCode`，保留原版本，沿用妥善保管的签名。调试包必须标明开发测试用途；编译、浏览器联调或下载成功不能表述为真机验收通过。具体记录见 `docs/android-client.md`。

用户要求后续优先增量更新：从支持差异包的客户端（0.2.5 / code 7）升级时，发布前生成并验证适用基线的差异包；只有明显节省流量才公开。首次安装、不支持差异包的旧版、基线不匹配及差异包失败均保留完整 APK 兜底。补丁必须逐字节还原正式 APK，并复核大小、SHA-256、包名、签名与递增版本；不得将差异包当作能直接安装的 APK，也不得绕过系统安装确认。每次发布报告实际节省量，不承诺固定比例。

## 拍题资料归档约定

- 2026-10-02 用户要求云盘仅用于留存原件；APK 分析、提取、框题和预览优先读取私有 data/files 中保留的本机原片及处理图，不为这些操作自动下载刚上传的图片。本机副本丢失时需明确提示，由用户选择恢复；不把云端 AI 请求误称为离线分析。
- 图片云盘的 200 张是上传分组大小，不是一次选图或队列总量上限。超过 200 张自动拆组，支持继续选图、续传；旧服务器按其公布的较小分组上限兼容。
- 2026-10-02 用户进一步要求：云盘上传保留来源照片的原文件名，不改成“原图-编号”；同名不是同一文件的证据，继续使用独立编号、校验值及回执。拍题/云盘选择只显示“已选 X 张”，不设100张总量限制；提供文件夹起止范围和全选，上传仍按200张分组。旧版未记录的原文件名不得猜造。

- 用户要求拍题图片及文档始终保存在腾讯云同一工程内：正式原件在 `data/`，处理副本在 `temp/`，备份在 `backups/`。原件不得放入 APK 公开下载目录或临时清理范围。
- 保持 `data/<sha256(scanOwner)>/scans/<scanId>/original` 的稳定位置；通过家庭归属、`studentId`、`createdAt`、`subject`、`source` 关联分类，不因科目、知识点或错因修订移动原件。0.2.6 已支持逐题选科、错题收录及待核对 AI 讲解；通用标签和难题分类仍属于后续开发。
- 上传时间保存为 UTC，日期分类向用户展示时按 `Asia/Shanghai` 解释。历史记录缺少 `studentId`/`child` 时需人工核对；代码的 `dabao` 兼容回退不是归属证据。详细结构和核实范围见 `docs/工程目录.md`。
