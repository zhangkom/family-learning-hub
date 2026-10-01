# 手机端拍题预处理模块 v1

2026-10-01；交给唯一总协调「ai教育服务总线程3」集成。基线 de93e78，分支 `codex/photo-preprocessing-v1`，第一批核心提交 7c8b743。

本提交是独立模块，不改变当前相机、上传、框题、后台或发布版本。总线程接入前不会在已有 App 中生效。不是完整 APK，也未完成红米真机验收。

## 实现范围

- Android Capacitor 原生插件 `PhotoProcessing`，不依赖 GMS、云端 API、OpenCV 或 ML 运行库。
- 按账号与学生持久保存相机/相册返回的原始文件字节及 SHA-256。这里的「原片」是相机插件返回文件，不保证等于传感器 RAW 或系统相机最初文件。
- 正确处理全部 8 种 EXIF 方向，包括镜像；源图四角透视变换、90°旋转、缩放合为一次 Canvas 几何绘制。
- 默认 `enhancement: 'none'`。可选 `light` 用低分辨率局部背景亮度估计做受限 RGB 增益，最高 1.18 倍，保留颜色、不二值化、不锐化、不补字、不擦字。
- 预览和处理版本另存，处理原片不被覆盖。输出 JPEG 不复制 EXIF/GPS。
- 提供质量指标和建议：可能模糊、低光、低对比度或空白、光照不均或彩色背景、输出过小。阈值未经真实手机标定，只作提示，不能据此判定照片可识别。
- 输出哈希、原片哈希、参数及双向几何矩阵。前端读取待上传文件时校验大小与 SHA-256。

不包含：自动纸张找边、自动切题、弯曲展平、手写擦除、严重反光恢复、已校准的模糊检测、系统保存/分享导出目的地、后台元数据接口。自动找边/轻量模型需单独做收益验证；后台现有切题工作不由本模块重复实现。

第一版用 Android 原生几何和像素操作完成基础算法，不先增加 OpenCV 库。研究中的 DocAligner、UVDoc、LP-IOANet 均未打包、下载或调用，不得在 UI 中宣传已经接入小模型。

## 集成入口与数据流

`clients/android/src/photo-processing/index.ts` 导出接口。总线程需在 `MainActivity.onCreate` 的 `super.onCreate` **之前**注册：

```java
registerPlugin(PhotoProcessingPlugin.class);
```

`android/app/build.gradle` 本提交仅增加直接依赖 `androidx.exifinterface:exifinterface:1.4.1`，现有相机插件也使用该版本。不增加权限。

```ts
import {
  photoProcessingAvailable, importOriginal, preparePhoto,
  previewUrl, readConfirmedUpload, fullPage,
} from './photo-processing';

// 进入相机前固定 owner 与 studentId，期间切换账户/学生不能改变本次归属。
// owner 沿用现有草稿所属账号键；禁止用会变化的会话 token。
if (photoProcessingAvailable() && photo.uri) {
  const original = await importOriginal(owner, photo.uri, studentId);
  // 保存 originalId 与学生关联；original.previewUri 是已纠正 EXIF 的源图预览。
  const result = await preparePhoto(owner, original, {
    corners: fullPage, // 或用户在源图预览中确认的四角
    quarterTurns: 0,
    enhancement: 'none', // 开关开启后可用 'light'，需要重新预览
    maxEdge: 3072,
    jpegQuality: 94,
  });
  const src = previewUrl(result);
  // 显示 src 与质量提示，让用户实际确认。不能创建结果后直接传 true 自动上传。
  // 用户确认事件中：
  const { file, name, processing } = await readConfirmedUpload(result, true);
  // 将 file/name/processing、owner、original.studentId 保存成可恢复上传草稿。
  // 使用原有 api.upload 上传 file；processing 需要总线程与后台约定后落库。
  // 上传完成只移除上传草稿，绝不调用 deleteOriginal。
}
```

接口最终增加了必填 `studentId`，避免原片归属在删除上传草稿后丢失。相机的 `uri` 是原生 content/file URI，Camera 8.x 也可能返回无协议的绝对路径（已按已安装插件源码兼容）；原生层仅允许本应用私有/缓存目录内文件，或用户选取的content URI。`webPath` 用于 WebView 显示，不能代替 `uri` 传入导入方法。浏览器/iOS/未注册插件时 `photoProcessingAvailable()` 返回 false，由调用方保留原有流程，不能伪造本地处理成功。

`getOriginal(owner,id)` 恢复原片与预览；`listOriginals(owner,offset,limit,studentId?)` 按账号分页（默认30，最多100），指定学生时在原生层先按学生过滤再分页。新 UI 总是指定学生。`deleteOriginal(owner,id,true)` 是独立的明确删除操作，会删除该原片及处理版本；不能挂在上传、退出登录或清草稿动作上。应用内账号隔离依赖调用方真实会话 owner，该参数不是服务器认证凭据。

处理结果可完整保存于现有本地草稿；调用 `readConfirmedUpload` 返回的 `processing` 已排除本机文件 URI，不含账号明文。上传应绑定原片学生，不能取上传时刚切换到的学生。登录切换后丢弃旧异步 UI 结果，但已存档原片仍留在原所属账号目录。

## 坐标约定

- `corners`: 长度8，`[x0,y0,x1,y1,x2,y2,x3,y3]`，左上、右上、右下、左下，屏幕顺时针。
- 坐标基于 **EXIF 方向纠正后、尚未裁切/用户旋转的源图**。归一化图片边缘范围 `[0,1]`。源图宽高是 `uprightWidth/uprightHeight`。
- 不能把旋转后结果预览中的四角直接作为源图四角。先用 `outputToSource` 反向映射，或回到源图预览编辑。
- `sourceToOutput` / `outputToSource`: 行优先 3×3 单应矩阵，坐标都归一化，采用齐次除法。输出已包含用户 `quarterTurns`。
- `pointerToImage` 专门处理 `object-fit:contain` 的预览留白，点击留白返回 null。调用方应传实际图片视口的 boundingClientRect；有 CSS 旋转或缩放时先转换指针。
- 上传后切题/框题仍基于 **处理图**。`mapQuestionToOriginal(outputToSource,rect)` 能将归一化题框映射回原片四边形，不是强行压成轴对齐矩形。
- 矩阵不能恢复已经裁掉、压缩掉的像素；真正的重新处理必须读取本机原片。

四角必须凸、顺时针、不交叉、不退化且面积至少为源图0.5%；不合格直接报错，不静默猜角。用户可选择全图，不强迫裁切。

## 持久化与上传语义

```text
Android filesDir/photo-originals-v1/<sha256(owner)>/<originalId>/
  original            # 导入字节，不覆盖
  record.json         # 原片 SHA-256、学生、原始/正向尺寸、EXIF方向、时间
  preview.jpg         # EXIF正向预览，最长边1200
  <outputId>.jpg      # 独立处理图
  <outputId>.json     # 处理参数、几何关系、输出SHA-256与质量提示
```

导入使用独立临时目录，完整记录写入后同文件系统改名。输出先 `.part` 写完再提交；失败不改原片，异常时删除本次未提交文件。断电/进程强杀可能留下不出现在列表中的 `.import-*`、`.part` 或未提交输出，后续可加管理清理；原片目录不能混入缓存清理。插件串行执行；忙时返回 `PHOTO_BUSY`，界面禁用重复操作即可。

原片在手机应用专属持久目录，不依赖系统相册权限；应用目前禁止系统自动备份，卸载/清除应用数据会失去原片。本批原片管理组件已提供该说明；总线程仍需接入真实系统保存/分享目的地，不能宣传永久或跨设备留存。磁盘不足时停止导入，不静默删除历史原片。

服务器只收到用户确认的处理图，正式保存仍使用项目 `data/`。处理后上传件可以沿用已有物理 `original` 路径，但元数据必须说明 `sourceKind: processed-photo`，不应称作「未经处理的相机原图」。历史上传件不能被重新标注或覆盖。后端需要保存原片ID/hash、处理版本、矩阵与参数，且验证 `processing.studentId` 与该上传所属学生一致；这些元数据不替代服务器归属认证。

## 资源边界

- 输入最多32 MiB，JPEG/PNG/WebP，边长最多50000、像素最多1亿；只有文件字节保存，无全分辨率无界解码。
- 原生解码通过整数采样限制约1200万像素；输出最多约800万像素、最长边4096，默认3072。解码采样是2的幂，50MP等大图实际输出可能低于请求边长，详见返回的 decodedWidth/decodedHeight。
- 不放大低分辨率来源；极窄输出拒绝，小输出给提示。高分辨率小题裁取可在后续加入区域解码优化。
- 最后一次 JPEG 编码，质量默认94，可选90–100；超过8 MiB报错，由用户调整选区/尺寸，不循环降低质量掩盖细节损失。
- 单个操作的Bitmap峰值约为解码图＋输出图，加小尺寸分析缓冲；真实峰值RSS、延迟和温升仍需真机测量。不能把模型0字节说成运行内存0。
- 光照增强最多提亮18%，不能承诺消除硬阴影；默认关闭以保留未增强的证据版本。合成逐像素测试发生在JPEG编码前，编码后的笔画保真仍需实图比对。

## 验证与集成验收

第一批已执行：客户端68项测试（包含本模块17项）；TypeScript/Vite构建；客户端oxlint。Java纯逻辑测试覆盖1000个透视往返点、8种EXIF×4种旋转、非法四角、缩放上限、合成阴影及细线。合成白纸左右亮度差60降到28，是特定样例结果，不是识别准确率。

原生编译：`:app:compileDebugJavaWithJavac` 已通过（JDK21 / Android SDK36 / Gradle8.14.3，离线编译；只编译，不生成交付APK）。

复现Java测试（只生成合成数据）：

```powershell
./clients/android/scripts/verify-photo-processing.ps1 -JavaHome <JDK21目录> -OutputDirectory <本工程artifacts/qa/photo-preprocessing-v1>
```

图像和测试产物放本工程 `artifacts/qa/photo-preprocessing-v1/`，不含真实孩子照片。未在红米运行，也没有调用线上AI或改动服务器。

总线程集成验收应覆盖：横拍/镜像的四角和题框一致、淡铅笔和数学符号放大对比、原片哈希处理前后一致、上传后原片仍可重开、断网重试与杀进程恢复、账号/学生切换、低存储错误、全图/裁图的图片质量及真实端到端时间。达到可用标准后由总线程统一递增版本、生成增量包和发布。

## 第二批：独立 UI、恢复与原片读取

统一入口 `clients/android/src/photo-processing/public.ts`。没有改 App、Review、RegionEditor、api、types、版本号或注册入口，不自动启用生产上传。生产调用方不应传 `services`；该依赖注入仅供隔离的浏览器合成测试使用。

```tsx
import { PhotoPreparation, OriginalPhotoLibrary, importOriginal,
  listPhotoDeliveries, recoverPhotoDelivery, removePhotoDelivery } from './photo-processing/public';

<PhotoPreparation owner={owner} studentId={studentId} studentLabel={studentLabel}
  original={original} onCancel={closePreparation}
  onConfirm={delivery => acceptConfirmedDelivery(delivery)} />;

<OriginalPhotoLibrary owner={owner} studentId={studentId} studentLabel={studentLabel}
  onResume={original => openPreparation(original)} />;
```

`PhotoPreparation` 支持整张图、原片四角点选/拖动/键盘微调、90°旋转、默认关闭的轻微提亮、原片与处理件对照、放大滚动检查、质量建议、显式生成和确认、取消保留。选择角始终在正向原片坐标中，旋转只作用于生成结果。账号、学生、原片 ID/hash 改变会同步重建整个会话；取消/卸载组件会丢弃迟到的异步结果，文件读取可取消。原生处理已开始后不会强杀线程，可能留下完整处理副本，原片不变；此时立即打开原片列表可能收到 `PHOTO_BUSY`，支持重试。

确认成功回调 `PhotoDelivery` 的两个字段用途不同：

- `record`：仅供本机恢复，含账号、学生、原片记录、已确认处理记录、本机 URI；**绝不能整体传给服务器或写入日志**。
- `upload`：`file/name/processing/sourceKind`，只包含已确认处理图及无本机路径的处理元数据。`sourceKind` 为 `processed-photo`。后端契约未定，本批不发送请求。

确认先用账号重新读取原片记录，校验学生、源 hash、输出文件目录及处理图字节/hash，再保存本机恢复引用，最后调用 `onConfirm`。本次结果只回调一次；宿主应接手展示上传状态并处理网络失败，不能在回调返回后另取当前学生覆盖 `record.studentId`。

恢复记录保存在 WebView `localStorage`，键前缀 `family-photo-delivery-v1:`，按 `[owner,studentId,outputId]` 隔离；只保存数 KB 的引用，不在 WebView 再复制大图。存储失败向用户报错，原生原片保留。`listPhotoDeliveries(owner,studentId)` 只返回当前范围；宿主提供待提交入口，用户重试时调用 `recoverPhotoDelivery(record,owner,studentId,signal?)` 重新验证原片归属及输出 bytes/hash，再取 `upload`。文件丢失或记录损坏必须报错，不能宣称已提交。只有得到服务器成功确认或用户明确放弃这份待提交草稿后，调用 `removePhotoDelivery`；该函数不删除原片或原生处理件。

`OriginalPhotoLibrary` 按学生分页，重新打开前复核原片 ID/hash/学生。未提供 `onExport` 时不显示导出按钮，明确说明尚未接入导出、本机保存不等于备份。宿主实现真实保存/分享目的地后可传 `onExport(fileInfo,signal)`；取消选择应抛出取消异常，不能解析成成功。退出账号时宿主必须尊重 signal，并停止相应导出流程。当前不新增权限或分享插件。

`readOriginalUpload(owner,original,signal?)` 是可选的原字节读取/导出能力，返回 Blob、原 MIME、文件名、ID/hash/学生和 `uploadEligibility`。原片 >8 MiB 时状态为 `exceeds-current-limit`，返回原字节供本机导出，绝不重压缩、不放宽服务端限制。它不被默认交付流程调用；默认原片留手机、处理件上传，遵循用户本对话明确要求，不强制双传。若未来确需可选双传，必须另定用户选择、后台契约和超限处理。

第二批验证：客户端 75 项测试（本模块 24 项），TypeScript/Vite、oxlint、Android `compileDebugJavaWithJavac`；新增测试覆盖原片字节/MIME、>8 MiB 显式超限、hash 损坏、取消、学生过滤、处理件单文件交付、本机记录重开、账号/学生隔离、跨原片目录拒绝、存储满失败与不删除原片。浏览器合成桥接测试覆盖四角留白/触摸点选/键盘微调、旋转/提亮参数、放大与预览确认、参数改变作废、账号/学生变化后的迟到处理和确认、失败取消、处理途中取消、原片恢复及 320/390/768 宽度布局。

```powershell
$env:PLAYWRIGHT_MODULE_PATH = '<可用的playwright包目录>'
$env:PHOTO_QA_OUTPUT = '<工程目录>/artifacts/qa/photo-preprocessing-v2'
# 在 clients/android 中运行；脚本只开本机 127.0.0.1:3293，结束自动关闭。
node scripts/verify-photo-preparation.mjs
```

合成 HTML/TSX 夹具在 `scripts/`，不会进入现有产品构建入口。测试图片只是合成 SVG；模拟桥只检查传入参数和 UI 生命周期，不验证真实 Canvas 输出、原生文件生命周期或红米性能。第二批截图与 `browser-result.json` 在工程 `artifacts/qa/photo-preprocessing-v2/`。未生成 APK，未调用真实题图/线上 AI，未修改服务器。
