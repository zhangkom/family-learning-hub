# Mobile API v1

首轮契约，2026-10-01。服务器基础路径：`/family-learning/api/mobile/v1`。JSON UTF-8；时间为 ISO 8601 UTC，revision 为非负整数。Android 开发者使用相同字段，不把学生选择保存在服务器会话上。

## 身份与错误

除登录、OPTIONS 外都必须 `Authorization: Bearer <token>`；本 API 忽略网页 Cookie，不设置 Cookie。token 有效期 7 天，数据库只保存哈希，退出撤销当前设备，修改家庭密码撤销全部网页和移动会话。现有家庭在网页 `/account` 开通；本轮不增加公开注册。

无 Origin 的原生请求可用；浏览器 Origin 必须精确匹配服务端 `FAMILY_MOBILE_ORIGINS`（逗号分隔）或站点自身 `FAMILY_PUBLIC_ORIGIN`。双方联调配置为 `https://localhost,http://127.0.0.1:3178`。不允许通配符，不发送 Allow-Credentials，客户端使用 `credentials: 'omit'`。网页自己的 Cookie API 仍执行原有同源检查。

错误统一 `{error: string, code: string}`，可展示 error。常用状态：400 `INVALID_INPUT`、401 `UNAUTHENTICATED`、403 `ORIGIN_DENIED`、404 `NOT_FOUND`、409 `REVISION_CONFLICT` / `IDEMPOTENCY_CONFLICT`、413 `TOO_LARGE`、429 `RATE_LIMITED`、503 `UNAVAILABLE`。409 时重新 GET，保留本机草稿供用户比较，不自动覆盖。

## 接口

| 方法与路径 | 输入 | 成功响应 |
| --- | --- | --- |
| POST `/session/login` | `{username,password,deviceName?}` | 200 `{token,user:{id,username},expiresAt}` |
| GET `/session` | 无 | 200 `{user:{id,username},expiresAt}`；过期为 401 |
| POST `/session/logout` | `{}` | 200 `{ok:true}` |
| GET `/students` | 无 | 200 `{students:Student[]}` |
| POST `/students` | `{name,grade?}` | 201 `{student:Student}` |
| GET `/scans?studentId=...` | studentId 必填 | 200 `{scans:Scan[],recognition:boolean}` |
| POST `/scans` | multipart：studentId、subject、source、file、clientRequestId | 首次 201、同一重试 200 `{scan:Scan}` |
| GET `/scans/:id` | 无 | 200 `{scan:Scan}` |
| GET `/scans/:id/file` | Bearer 鉴权 | 原文件字节、原 Content-Type；不可直接用于不带鉴权的 img src，客户端转 Blob URL |
| POST `/scans/:id/recognize` | `{revision}` | 202 `{scan:Scan}`；任务持久化后立即返回 |
| PUT `/scans/:id/review` | `{revision,questions:Question[]}` | 200 `{scan:Scan}`；所有修改一次原子提交 |

`Student={id,name,grade?,createdAt,legacyChildId?}`。id 为不透明字符串；旧记录保留 `dabao`、`xiaobao`，同时返回对应 legacyChildId，新学生使用 UUID。学生按家庭隔离，每家庭最多 30 名；姓名 1–60 字，年级可选最多 80 字。不保存全局“当前学生”，上传和后台任务固定归属创建时的 studentId。

上传支持 JPEG/PNG/WebP/PDF，单文件最多 8 MiB，家庭原件总量最多 500 MiB。subject 使用中文学科名，首批为 `数学`；source 1–200 字。clientRequestId 使用 UUID，客户端同一次上传重试必须复用；同标识改变学生、文件或元数据会返回 409。上传本身不调用模型，初始状态 `needs_review`，questions 为空；随后显式提交 recognize。PDF 暂存及手动整理可用，识别受模型能力限制。

## 资料与题目

```ts
type Scan = {
  id: string; studentId: string; subject: string; source: string;
  originalName: string; mimeType: string; size: number; createdAt: string;
  revision: number;
  status: 'queued' | 'processing' | 'needs_review' | 'ready' | 'failed';
  questions: Question[];
  confirmedAt?: string; error?: string;
};
type Region = {
  id: string; kind: 'stem' | 'figure' | 'answer' | 'annotation';
  x: number; y: number; width: number; height: number;
};
type AnswerStep = {
  id: string; order: number; text: string; latex?: string;
  regionIds: string[];
  author: 'student' | 'teacher' | 'unknown';
  crossedOut: boolean; uncertain: boolean;
};
type Question = {
  id: string; number: string; prompt: string; diagram: string;
  knowledgePoints: string[]; parentQuestionId?: string;
  regions: Region[]; sharedRegionIds?: string[];
  answerSteps: AnswerStep[]; uncertainties: string[]; confirmed: boolean;
  referenceAnswer?: string; explanation?: string;
};
```

补充字段为 `sharedRegionIds`、`referenceAnswer`、`explanation`，不改变双方原先约定字段。sharedRegionIds 可引用同页其他题定义的题干/配图区域，避免复制公共图形；parentQuestionId 引用同页父题，禁止循环。题目、区域、步骤 id 由客户端生成并保持稳定（建议 UUID），重排、修改题号不更换 id。保存题目数量允许 0–100；空列表用于清空错误草稿，不会被标为 ready。

坐标采用原始上传文件按 EXIF 方向显示后的完整图像归一化坐标 0–1（左上角为原点），框必须完全在图像内。当前服务不旋转或裁剪原件，不输出不可逆的处理坐标。编辑器预览缩放不能改变存储坐标。识别适配器首轮只提供候选文字、题目关系和可见步骤，**不把模型猜测的坐标当可靠框线**；缺可靠区域时 regions 为空，uncertainties 明示待手动框选。客户端应允许先保存无框草稿。

AnswerStep.order 表示可见步骤的阅读顺序，不代表真实下笔时间。原图保持不可变，转写每次保存留修订历史；AI 提取结果 confirmed 一律为 false。referenceAnswer/explanation 与孩子步骤分开，不能用参考解法补造原笔迹。本轮不把校对、确认或空白作答计入独立作答/掌握统计，也不实现习惯标签和自动诊断。

每题 confirmed 由人工决定，可部分确认；至少一题且全部 confirmed 时 scan 为 ready，否则 needs_review。确认表示用户校对完成，不代表孩子答对。保存时提交整份 questions，未编辑题目仍须保留。取消确认后 confirmedAt 清除。新结果不自动进入旧版错题统计。

## 后台任务与版本

识别使用独立后台进程、SQLite 持久队列和租约，最多尝试 3 次；重启可恢复，错误只展示安全信息。GET 资料轮询建议 2 秒起、最长 10 秒，退出页面停止轮询。每次状态或内容变更 revision 增加，用户提交前使用最新 revision。

recognize 返回的 scan 可能已包含比请求 revision 更新的 queued 状态。同一资料排队/处理期间重复 recognize 返回现有任务状态（仍需传当前 revision）。人工 review 可取消在途任务，旧租约/旧版本结果不得覆盖新修改；任务固定家庭、学生、原件和版本。已有题目/确认内容不被再次识别覆盖，需先明确保存空草稿。失败可按最新 revision 重试。识别调用遵守家庭每日额度，租约恢复可能重试模型请求，不能保证外部计费恰好一次。

所有资料、原件、学生、任务在服务器验证家庭归属。跨家庭 ID 一律 404。父母网页使用同一服务层和资料版本，但通过独立 `/api/family/workspace/...` Cookie 路由访问，不转存移动 token。

## 本轮边界与验收

首轮交付账号/学生、资料与原件、矩形与步骤校对、持久识别队列、家长查看及旧大小宝兼容。邀请多家庭、证据诊断、分步 tutor、独立变式及 mastery/周报在后续阶段，不因保存资料而宣称已完成。

## 本机启动与存储升级

源码工作区使用 Node 24：先执行 `npm run build:self-hosted`，再执行 `node scripts/start-mobile-dev.mjs`。默认只监听 `127.0.0.1:3285`，复制运行包到独立测试目录，创建随机密码的合成家庭，并输出 `work/mobile-dev-connection.json` 的位置。该文件仅供本机联调读取，不能输出密码或提交 Git。开发 CORS 已包含客户端的 3178 端口；AI 密钥强制清空，不向模型发送资料。结束联调后根据连接文件的 pid 确认对应进程再停止。`node scripts/verify-mobile-web.mjs` 在另一独立测试端口 3286 验证家长网页，并在 `outputs/mobile-backend/` 留下合成截图。

构建包新增 `worker/worker.mjs`。部署时使用 `deploy/family-learning-worker.service` 模板，实际配置仍放工程 `config/systemd/` 并由系统入口链接；先预建由服务用户持有的 worker 日志，再启用 worker。它与网页共用同一私有 SQLite 与原件目录，每个进程持有自己的 SQLite 连接，使用事务和租约领取任务。此模板尚未安装到生产，联调不代表发布。

新增表均使用可重复执行的 CREATE IF NOT EXISTS：students、mobile_sessions、scan_documents、scan_versions、scan_uploads、scan_jobs。旧扫描首次读取时导入 scan_documents 并保存 legacy-import 修订，原图不移动也不改写。导入后 **SQLite 中的 scan_documents 与 scan_versions 是校对和版本历史的权威数据**；原 record.json 作为旧版兼容投影/导入来源，不保证包含每次后台或手机校对的新版本。备份同时包含 SQLite、原件和 record.json，不可只恢复 JSON 文件。

发布前同时停止网页和 worker，保留数据及配置的一致快照，再验证恢复；日常在线备份仍沿用已有快照工具。回退到不认识这些表的旧版本时，必须同时恢复相应发布前数据快照，不能仅切换旧运行代码并继续写旧 JSON。新增学生的资料不塞入大小宝旧课程统计；已有明确勾选的错题在首次结构化校对前存入原历史。

合成资料验证：两个家庭越权、三学生归属、Cookie/Bearer 隔离、CORS、注销/改密撤销、上传幂等、旧资料可读、关系/坐标校验、过期任务恢复、双 worker 租约竞争、人工版本保护、备份恢复。真实手写和自动切题质量需另行用授权样本评估。本轮不发布生产。
