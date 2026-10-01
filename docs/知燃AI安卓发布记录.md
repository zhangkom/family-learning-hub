# 知燃 AI 0.2.3 发布记录

本页是历史记录；当前新版为 [普通家庭注册与游客首页 0.2.4](普通家庭注册上线记录.md)。固定下载仍保留，latest 指向新版。

2026-10-01 17:59（北京时间），0.2.3 / versionCode 5 已发布。应用显示名称改为“知燃 AI”，更新图标和蓝色首页，题目与“我的”使用独立分页；加入权限说明，拍照/选图由操作触发，并完善取消和拒绝权限的提示。本次未部署后台，生产源码继续为 `294c892`。

## 安装包

- [固定下载](https://123.207.232.151/family-learning/downloads/android/family-learning-0.2.3-release-46b772c.apk)
- [最新版下载](https://123.207.232.151/family-learning/downloads/android/latest.apk)
- [更新清单](https://123.207.232.151/family-learning/downloads/android/latest.json)
- 源码：`46b772c8d8b358c97a2445998c8e03142968eb09`。
- 大小：6,687,421 字节。
- SHA-256：`0976985df78f6920b1d37e198da396f4a2c0fb6cd0d1d8d9f1dcc308a0f63bed`。
- 包名：`cn.familylearning.study`。
- 签名证书 SHA-256：`87da2ee368a7b1b2c8852d7d8ab99df831f981d8d47d6fd92c6be801d010bcb1`。

0.2.0、0.2.1、0.2.2 可覆盖升级，不必卸载。0.1.0 使用旧调试签名，切换前仍须先保留未上传草稿再卸载旧版。签名私钥未进入公开或一般归档目录。

## 权限与验收边界

最终 APK 经 aapt 检查：名称“知燃 AI”、版本码 5，不可调试。uses-permission 只有 `android.permission.INTERNET`、`android.permission.REQUEST_INSTALL_PACKAGES` 和 `cn.familylearning.study.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`。没有短信、电话、通讯录或定位权限。apksigner 独立验证 v2 签名有效，证书与旧版一致。

用户在红米 Turbo 3 安装时看到的短信权限提示，来源仍未确定。本次不宣称修复该提示，也未认定为厂商误报。相机和系统安装仍需真机验收。

安卓集成会话完成 37 项客户端测试；根工程 69 项测试、类型、范围 lint 和构建通过。实际隔离本机服务验证首次注册、登录、上传、人工校对和学生切换；合成数据、模拟原生桥验证启动/登录不主动申请权限、点击后拍照、拒绝后仍可选图、取消不报错、更新安装授权由操作触发及 360/390 宽度布局。这些结果不代表真机相机或真实题目识别已通过验收。

## 发布验证和归档

服务器完整下载固定地址及 latest 地址验证大小、哈希和 TLS。2026-10-01 18:01（北京时间）从本机外网再次经 latest 完整下载，跳转到上述固定 URL，6,687,421 字节和 SHA-256 均一致。公开清单显示“知燃 AI”及 versionCode 5；精确安卓来源 CORS、no-store、OPTIONS 204、Range 206 均通过。6 项本批私有文件外网返回 404，服务器发布流程另有 8 项私有路径拒绝检查。

原有 8 个公开 APK/固定版本 JSON 的 SHA-256 均未变。Web 和 worker 的运行目录、PID 保持不变，备份定时器正常。未修改短链接、域名、家庭账户或学习数据；未触发真实模型。

以下路径均相对于腾讯工程根目录 `/home/ubuntu/codex_project/workspace_own/family-learning-hub/`：

| 路径 | 内容 |
| --- | --- |
| `artifacts/android/20261001-46b772c/` | 12 件私有交付文件及 manifest：APK、完整 Git bundle、权限和签名报告、合成 QA 与发布工具源码 |
| `artifacts/public/android/` | 允许公开的 APK 和版本清单 |
| `artifacts/qa/apk-public-client-verification-023.json` | 外网完整下载及更新协议验证 |
| `artifacts/qa/apk-post-publish-023.json` | 历史文件哈希、进程及发布快照验证 |
| `backups/releases/apk-publish-20261001T095954Z-cc8a7c/` | 本次发布前配置及验证记录 |
| `backups/releases/apk-publisher-20261001T095953Z-zhiran/` | 更换发布工具前的工具副本 |

私有 Git bundle 已验证并导入 `codex/android-family-client` 引用；服务器 `code/` 的当前工作检出未切换。发布清单生成工具只对新版本写入“知燃 AI”，历史固定版本的名称和内容保留。
