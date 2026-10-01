# APK 下载发布

用户要求每次交付 APK 时上传腾讯云并给出可点击下载地址。此规则与工程总目录约定同时执行。

## 当前交付（2026-10-01）

- 固定版本：[0.2.2 release / 5e4e4f9](https://123.207.232.151/family-learning/downloads/android/family-learning-0.2.2-release-5e4e4f9.apk)
- 最新版本：[latest.apk](https://123.207.232.151/family-learning/downloads/android/latest.apk)
- 公开元数据：[latest.json](https://123.207.232.151/family-learning/downloads/android/latest.json)
- APK 源码提交：`5e4e4f9aad803ad09adb0fd7f42078e324c1ec6a`；versionCode 4；大小：6,680,973 字节。
- SHA-256：`c94642eb723e08d03b5e2dfd1bf70aca14f5209210140eb992cf310e814df34e`。
- 0.1.0 固定链接继续保留；新版已内置腾讯服务地址，并使用长期发布签名。

这是家庭试用包，未完成安卓真机拍照验收。后台已于 2026-10-01 13:32 上线，见 [移动后台上线记录](移动后台上线记录.md)。0.2.1 可在 App 内使用私下提供的启用码首次注册并直接登录，见 [首次开通修复](移动首次开通修复.md)。0.2.0 可直接覆盖升级，无需卸载。0.1.0 调试版升级前应确认本机草稿已上传，再卸载旧版；之后沿用固定发布签名。

0.2.2 新增更新入口与系统安装引导，详见 [安卓更新发布记录](安卓更新发布记录.md)。

## 文件与配置位置

工程根目录 `P=/home/ubuntu/codex_project/workspace_own/family-learning-hub`。

| 位置 | 用途 |
| --- | --- |
| `P/artifacts/android/<批次>/` | 私有 APK、Git bundle、内部报告及 manifest 归档 |
| `P/artifacts/public/android/` | 公开 APK 副本及不含内部路径的发布元数据 |
| `P/config/apk-releases.json` | 私有版本登记，保留旧版固定链接 |
| `P/config/nginx/family-learning-apk-downloads.conf` | 精确文件名下载路由；其他下载路径返回 404 |
| `P/config/systemd/var-www-familylearningapk.mount` | 只读挂载单元 |
| `P/runtime/tools/publish-apk.py` | 服务器发布工具，对应源码 `scripts/publish-apk.py` |
| `P/backups/releases/apk-publish-<时间>-<随机码>/` | 发布前配置及发布验证记录 |
| `P/temp/development/apk-publish-latest.json` | 最新发布的内部验证记录 |

`/var/www/familylearningapk` 是公开子目录的只读绑定挂载，不是额外存储副本。`/etc` 中只保留指向工程配置的链接。挂载启用 `ro,nosuid,nodev,noexec`，无需开放私有工程父目录的读取权限。

## 后续发布

先构建、校验签名并计算 APK 的 SHA-256，将包和内部报告上传到新的私有归档批次。以 root 运行工具，必须填写实际版本、完整源码提交、哈希和字节数；示例对应本次已验证文件：

```sh
P=/home/ubuntu/codex_project/workspace_own/family-learning-hub
sudo python3 "$P/runtime/tools/publish-apk.py" \
  --source "$P/artifacts/android/20261001-5e4e4f9/family-learning-0.2.2-release.apk" \
  --version 0.2.2 --channel release \
  --version-code 4 \
  --changelog '新增版本更新标识、手动检查更新、下载进度与系统安装引导；保留App内首次注册，可从0.2.0/0.2.1覆盖升级。' \
  --commit 5e4e4f9aad803ad09adb0fd7f42078e324c1ec6a \
  --sha256 c94642eb723e08d03b5e2dfd1bf70aca14f5209210140eb992cf310e814df34e \
  --bytes 6680973 \
  --notes '家庭试用版，内置腾讯服务地址；支持多孩子、照片上传、手动分题与手写校对；识别结果需人工核对，精确区域仍需手动框选；尚未完成安卓真机验收；0.1.0 调试版升级前需确认草稿已上传并卸载旧版，之后沿用固定发布签名。'
```

固定版本文件禁止覆盖为不同内容；重新构建产生不同二进制时应使用新版本或新提交。工具备份配置，更新路由，校验 Nginx 后平滑重载；等待新配置生效，再完整下载固定地址和 latest 地址核对大小/哈希，检查 Range、公开元数据和私有路径拒绝访问。TLS 使用系统信任链，不关闭证书校验。失败会恢复配置和 latest 指向，保留不可变文件供排查。

## App 检查更新协议

公开 `latest.json` 保留 `app,version,channel,commit,publishedAt,fileName,downloadUrl,bytes,sha256,notes`，新增整数 `versionCode` 和简短中文字符串 `changelog`。客户端以 `versionCode` 与本机版本比较；`downloadUrl` 指向固定版本 APK，下载后可核对字节数及 SHA-256。目前没有最低版本字段或强制更新规则。

该地址使用 `Cache-Control: no-store`；安卓 Origin `https://localhost` 可 GET/HEAD/OPTIONS，响应带精确的 `Access-Control-Allow-Origin` 及 `Vary: Origin`。其他来源不获得允许跨来源读取的头，无 Origin 的普通读取保持正常；公开文件仍限已有精确文件名，不开放工程目录。

发布参数中的 `--version-code` 必须与私有批次 `manifest.json` 的 versionCode 匹配；新 APK 不得复用旧 versionCode，latest 不接受版本号倒退。旧的不可变版本 JSON 保持原字节不变；更新客户端读取 latest.json。后续新版本 JSON 同时包含更新字段。

发布后还需从服务器之外完整下载复核，并在交付消息中给出地址、版本和实际验收边界。网站发布时必须保留 `config/nginx/family-learning-location.conf` 中的下载 snippet include，不能直接用较旧 Git 模板覆盖。

## 首次 APK 发布时的移动后台差项（历史记录）

2026-10-01 核实：生产运行版本仍为 `20261001T023232Z-private-sync-f44496e`；服务器源码工作区 HEAD 为 `58b3ee3`。公网移动 session 路径返回 404；`family-learning-worker.service` 尚未安装，`FAMILY_MOBILE_ORIGINS` 尚未配置。整合源码和 APK 已归档、第一阶段移动接口和独立 worker 已完成开发及隔离测试，本轮只发布 APK 下载。

上线前仍须按顺序完成：

1. 安排短暂停写，停止相关写入进程，备份数据库、扫描原件和私有配置，记录哈希；在独立目录验证恢复，关闭真实 AI。
2. 从已验证整合提交构建 Linux 运行版本，核对正式数据目录、服务用户、worker 单元与日志权限；配置精确移动来源（安卓为 `https://localhost`），不要照搬开发来源。
3. 单独决定模型任务的启用边界。现有代码会依据 AI 配置启用识别能力，不能仅因已有密钥就启动真实识别 worker；本轮没有增加开关或启用真实模型。
4. 部署并验证家庭初始化、移动登录、不同家庭隔离、原件上传/读取、人工框选与步骤复核，再用真机验收相机和完整流程。保留已有网页首次家庭设置流程；APK 没有开放注册入口。
5. 回退同时恢复对应数据库和文件快照，不能只切换旧代码：新版本导入后以 SQLite 中的扫描文档/版本为准，旧 `record.json` 只是兼容投影。回退前另存上线后新增数据，避免丢失。

上述后台部署、显式识别开关、一致性备份与恢复验证已在后续移动后台上线中完成；合成图片实测成功 1 次。真机与真实手写效果、诊断、变式练习及掌握度报告仍不属于本次 APK 发布验收。
