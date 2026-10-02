# 私有照片云盘 API v1

前缀 `/family-learning/api/mobile/v1`，全部云盘接口要求现有 Bearer 登录并沿用 CORS。云盘独立于 scans、错题和模型任务，上传不触发 AI。服务端类型见 `lib/cloud-photos.ts`。

`GET /setup` 新增 `cloudPhotos`：`{version:1,maxBatchItems:100,maxFileBytes:33554432,maxPixels:32000000,mimeTypes:["image/jpeg","image/png","image/webp"],recommendedConcurrency:1}`。字段缺失时客户端不启用此流程。每批1–100张；逐个 multipart 请求，客户端默认串行1张。超量、超过32MiB/3200万像素、动画或其他格式明确拒绝，不通过偷偷压缩原图绕过限制。HEIC/GIF/PDF 首版不支持。

## 创建批次

`POST /cloud-photo-batches` JSON：

```json
{"studentId":"当前孩子ID","clientBatchId":"客户端固定UUID","expectedCount":10}
```

首次201，完全相同重试200，返回 `{batch:{id,studentId,clientBatchId,expectedCount,createdAt}}`。服务端 id 用于后续 batchId。clientBatchId 在家庭内唯一，异参数409 `IDEMPOTENCY_CONFLICT`。批次不自动过期，最多接收 expectedCount 个不同上传标识；进度及停止/重试由客户端管理，不需要服务端关闭批次接口。

## 上传和回执

`POST /cloud-photos`，multipart 精确字段 `studentId`、`batchId`、`clientRequestId`（每张固定UUID）、`sha256`（原始字节小写64位hex）、`file`（带文件名与真实MIME的原图）。未知或重复字段拒绝；studentId 必须属于家庭且与批次一致。首次201，完全相同重试200，返回 `{photo:CloudPhoto}`。

CloudPhoto 字段：`id,batchId,studentId,clientRequestId,originalName,mimeType,size,sha256,width,height,orientation,createdAt`。文件名会净化；size/sha256 对应服务器持久保存的原始字节。width/height 是按 EXIF 纠正后的显示尺寸，orientation 是原 EXIF 方向。服务器保留相机元数据与文件字节，不转码原件。

同 clientRequestId 异原图、SHA、孩子、批次或净化后的文件名返回409 `IDEMPOTENCY_CONFLICT`。photoId 与 batchId 是小写标准UUID（8-4-4-4-12十六进制）；客户端必须固定标识和表单，回执丢失后用相同内容重试，可得到同一 photo。不同标识不做相册内容去重。手机原片可在验证回执的字节数/hash/孩子后继续保留；不自动删除。

## 浏览和下载

- `GET /cloud-photos?studentId=<必需>&limit=30&cursor=<可选>`：limit1–100，倒序 `(createdAt,id)`，返回 `{photos:CloudPhoto[],nextCursor:null|string,storage:{usedBytes,limitBytes}}`。cursor 是不透明值，绑定家庭和孩子。storage 是当前家庭全部孩子的云盘用量，不包含 scans。
- `GET /cloud-photos/:id`：`{photo:CloudPhoto}`，跨家庭404。
- `GET /cloud-photos/:id/thumbnail`：EXIF纠正、最长边640的JPEG，供私有预览。
- `GET /cloud-photos/:id/file`：原始字节/原始MIME，`Content-Disposition: attachment`，净化的UTF8文件名。

二进制接口均要求 Authorization，返回 private/no-store、nosniff；客户端用 fetch→blob，不使用带令牌的查询链接或公开静态地址。

## 限制与错误

家庭云盘上限2GiB，全服务云盘上限8GiB，磁盘保留至少2GiB并为新原件的首次备份留空间。并发接收有限，服务忙或限流时保留同一上传ID退避重试；停止不再启动后续项，已在途请求可能成功，恢复时应幂等核对。

每个 Web 进程同时只接收一个上传；额外上传立即503，不在内存排队。图片验证、缩略图和候选题框共用一个图片子进程名额，子进程关闭后才释放。缩略图最多排队32项、等待30秒，上传验证优先；单图检查12秒超时，上传接收120秒超时。每家庭每小时最多600次上传尝试、60个新批次。

错误沿用 `{error,code}`：400 `INVALID_INPUT`；401 `UNAUTHENTICATED`；404 `NOT_FOUND`；413 `TOO_LARGE`；409 `BATCH_LIMIT_REACHED` / `IDEMPOTENCY_CONFLICT`；429 `RATE_LIMITED`；503 `UPLOAD_BUSY` / `STORAGE_LOW`；507 `STORAGE_QUOTA`。

原件位于工程 `data/<sha256(accountId)>/cloud-photos/<photoId>/original`，独立 immutable record.json 保存回执字段。分类只修改或查询元数据，不移动原件；本版不提供删除/移动。缩略图为可重建内存缓存，不改变原件。新表为附加表，旧后台忽略云盘；回退必须保留 data 与新版云盘备份工具。

备份先取得 SQLite 副本，再按该副本中的云盘回执校验和复制原件、record.json。后续快照对已校验的上一份备份原件使用硬链接节省空间，不与在线原件共享 inode；不支持硬链接时复制。沿用30份快照保留规则。原件缺失或哈希不匹配会使备份失败，不能将不完整快照视为可恢复备份。

正常成功、错误和取消都会清理本次临时上传。进程被强制终止可能遗留 `temp/cloud-photos/<UUID>` 或 `data/<家庭哈希>/cloud-photos/.pending-<UUID>`；运维只可在确认没有相关上传进程后清理这些暂存目录，不能按年龄删除正式 UUID 原件目录。原件目录发布后、数据库提交前的意外退出，可由相同上传ID和相同字节重试恢复回执。

2026-10-02 11:56（北京时间）已上线后台 `2665722`。仅本工程 Nginx 上调为 `33m` 并关闭请求体代理缓存，旧 scans 服务端8MiB限制保持不变。云盘采用流式临时文件接收与独立图片子进程；工程 `temp/cloud-photos` 已配置服务专用可写绑定和0700权限。上传逐次重查剩余空间。Windows/Linux各170项测试、同生产身份384MiB内存限制下的32MiB/3200万像素原图、30冷缩略图、备份恢复及887旧后台兼容验证通过。详见 [0.3.0发布记录](030发布记录.md)。
