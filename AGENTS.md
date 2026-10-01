# Family Learning Hub

## 工作位置

- 腾讯云开发目录：`/home/ubuntu/codex_project/workspace_own/family-learning-hub`。
- GitHub：`https://github.com/zhangkom/family-learning-hub`；当前功能分支为 `codex/family-private-sync`。
- 正式服务仍运行于 `/opt/family-learning-hub/current`，由 `family-learning-hub.service` 管理。
- 同级 `7080laoyou` 属于另一个项目及其上传存档，不属于本项目操作范围。

## 开发与验证

使用 Node 24。首次执行 `npm ci --no-audit --no-fund`；Windows 与 Linux 的依赖分别安装，不复制 `node_modules`。

本项目检查：`npm test`、`npx tsc --noEmit`、`npx oxlint app server lib scripts vite.config.ts`、`npm run build:self-hosted`。
全仓库 `npm run lint` 在原有通用 UI 组件中存在已知问题，不能将它表述为通过。
浏览器验证使用 `scripts/verify-family.mjs`；它创建独立测试数据和临时服务。没有设置 `FAMILY_TEST_AI=1` 时不会调用真实模型。

开发服务器应只监听回环地址并使用独立端口、独立测试数据目录。构建项目不会自动发布；发布按 `docs/腾讯云部署.md` 执行，保留旧版本和回退路径。

## 数据与凭据

正式学习数据在 `/var/lib/family-learning-hub`（systemd 私有 StateDirectory），配置在 `/etc/family-learning-hub.env` 与 `/etc/family-learning-sync.env`。
密钥、启用码、真实扫描、学习数据库和备份不得进入 Git、公开静态目录、日志或构建产物。
`work/`、`outputs/`、`dist/` 与 `private-learning-data/` 为忽略目录；其中本次移交的 QA 截图及备份文件使用合成测试数据。
定时完整备份保留在私有数据目录的 `backups/`，线上数据无需搬到开发目录。
