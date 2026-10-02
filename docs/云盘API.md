# 私有照片云盘 API v1（开发中，未上线）

前缀 `/family-learning/api/mobile/v1`，全部云盘接口要求现有 Bearer 登录并沿用 CORS。云盘独立于 scans、错题和模型任务，上传不触发 AI。服务端类型见 `lib/cloud-photos.ts`。

`GET /setup` 新增 `cloudPhotos`：`{version:1,maxBatchItems:100,maxFileBytes:8388608,maxPixels:32000000,mimeTypes:["image/jpeg","image/png","image/webp"],recommendedConcurrency:2}`。字段缺失时客户端不启用此流程。每批1–100张；逐个 multipart 请求，客户端默认并发2。超量、超过8MiB/3200万像素、动画或其他格式明确拒绝，不通过偷偷压缩原图绕过限制。HEIC/GIF/PDF 首版不支持。

## 创建批次

`POST /cloud-photo-batches` JSON：

```json
{"studentId":"当前孩子ID","clientBatchId":"客户端固定UUID","expectedCount":10}
```

首次201，完全相同重试200，返回 `{batch:{id,studentId,clientBatchId,expectedCount,createdAt}}`。服务端 id 用于后续 batchId。clientBatchId 在家庭内唯一，异参数409 `IDEMPOTENCY_CONFLICT`。批次不自动过期，最多接收 expectedCount 个不同上传标识；进度及停止/重试由客户端管理，不需要服务端关闭批次接口。

## 上传和回执

`POST /cloud-photos`，multipart 精确字段 `studentId`、`batchId`、`clientRequestId`（每张固定UUID）、`sha256`（原始字节小写64位hex）、`file`（带文件名与真实MIME的原图）。未知或重复字段拒绝；studentId 必须属于家庭且与批次一致。首次201，完全相同重试200，返回 `{photo:CloudPhoto}`。

CloudPhoto 字段：`id,batchId,studentId,clientRequestId,originalName,mimeType,size,sha256,width,height,orientation,createdAt`。文件名会净化；size/sha256 对应服务器持久保存的原始字节。width/height 是按 EXIF 纠正后的显示尺寸，orientation 是原 EXIF 方向。服务器保留相机元数据与文件字节，不转码原件。

同 clientRequestId 异原图、SHA、孩子、批次或净化后的文件名返回409 `IDEMPOTENCY_CONFLICT`。客户端必须固定标识和表单，回执丢失后用相同内容重试，可得到同一 photo。不同标识不做相册内容去重。手机原片可在验证回执的字节数/hash/孩子后继续保留；不自动删除。

## 浏览和下载

- `GET /cloud-photos?studentId=<必需>&limit=30&cursor=<可选>`：limit1–100，倒序 `(createdAt,id)`，返回 `{photos:CloudPhoto[],nextCursor:null|string,storage:{usedBytes,limitBytes}}`。cursor 是不透明值，绑定家庭和孩子。storage 是当前家庭全部孩子的云盘用量，不包含 scans。
- `GET /cloud-photos/:id`：`{photo:CloudPhoto}`，跨家庭404。
- `GET /cloud-photos/:id/thumbnail`：EXIF纠正、最长边640的JPEG，供私有预览。
- `GET /cloud-photos/:id/file`：原始字节/原始MIME，`Content-Disposition: attachment`，净化的UTF8文件名。

二进制接口均要求 Authorization，返回 private/no-store、nosniff；客户端用 fetch→blob，不使用带令牌的查询链接或公开静态地址。

## 限制与错误

家庭云盘上限2GiB，全服务云盘上限8GiB，磁盘保留至少2GiB并为新原件的首次备份留空间。并发接收有限，服务忙或限流时保留同一上传ID退避重试；停止不再启动后续项，已在途请求可能成功，恢复时应幂等核对。

错误沿用 `{error,code}`：400 `INVALID_INPUT`；401 `UNAUTHENTICATED`；404 `NOT_FOUND`；413 `TOO_LARGE`；409 `BATCH_LIMIT_REACHED` / `IDEMPOTENCY_CONFLICT`；429 `RATE_LIMITED`；503 `UPLOAD_BUSY` / `STORAGE_LOW`；507 `STORAGE_QUOTA`。

原件位于工程 `data/<sha256(accountId)>/cloud-photos/<photoId>/original`，独立 immutable record.json 保存回执字段。分类只修改或查询元数据，不移动原件；本版不提供删除/移动。缩略图为可重建内存缓存，不改变原件。新表为附加表，旧后台忽略云盘；回退必须保留 data 与新版云盘备份工具。

2026-10-02 开发前只读检查：腾讯可用39,156,809,728字节，既有 Nginx `client_max_body_size 9m` 足以容纳8MiB图片和64KiB表单开销。此记录不代表将来仍有同样空间；上传及部署分别重查。尚未发布新后台。
