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

## 拍题资料归档约定

- 用户要求拍题图片及文档始终保存在腾讯云同一工程内：正式原件在 `data/`，处理副本在 `temp/`，备份在 `backups/`。原件不得放入 APK 公开下载目录或临时清理范围。
- 保持 `data/<sha256(scanOwner)>/scans/<scanId>/original` 的稳定位置；通过家庭归属、`studentId`、`createdAt`、逐题 `subject`、`source` 关联分类，不因科目、知识点或错因修订移动原件。0.2.6 已支持逐题选科、错题收录及单题讲解；通用标签、难题分类和完整分类浏览仍属后续开发。
- 上传时间保存为 UTC，日期分类向用户展示时按 `Asia/Shanghai` 解释。历史记录缺少 `studentId`/`child` 时需人工核对；代码的 `dabao` 兼容回退不是归属证据。详细结构和核实范围见 `docs/工程目录.md`。
