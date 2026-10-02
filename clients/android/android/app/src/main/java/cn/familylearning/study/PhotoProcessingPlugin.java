package cn.familylearning.study;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.net.Uri;
import android.app.Activity;
import android.content.Intent;
import android.content.ClipData;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import androidx.exifinterface.media.ExifInterface;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

/** Local-only document preparation. The caller explicitly chooses what to upload. */
@CapacitorPlugin(name = "PhotoProcessing")
public class PhotoProcessingPlugin extends Plugin {
    private static final long MAX_SOURCE_BYTES = 32L * 1024 * 1024;
    private static final long MAX_UPLOAD_BYTES = 8L * 1024 * 1024;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean();
    private final AtomicBoolean downloading = new AtomicBoolean();
    private volatile CloudOriginalDownload.Job downloadJob;
    private volatile PluginCall downloadCall;
    private interface Task { JSObject run() throws Exception; }

    private void run(PluginCall call, Task task) {
        if (!busy.compareAndSet(false, true)) { call.reject("正在处理另一张照片，请稍候", "PHOTO_BUSY"); return; }
        try {
            worker.execute(() -> {
                JSObject result;
                try { result=task.run(); }
                catch (IllegalArgumentException e) { call.reject(e.getMessage(), "PHOTO_INVALID"); return; }
                catch (OutOfMemoryError e) { call.reject("手机可用内存不足，请关闭其他应用后重试", "PHOTO_MEMORY"); return; }
                catch (Exception e) { call.reject("照片处理未完成，请检查本机空间并重试", "PHOTO_IO"); return; }
                finally { busy.set(false); }
                call.resolve(result);
            });
        } catch (RuntimeException e) { busy.set(false); call.reject("照片处理已停止", "PHOTO_STOPPED"); }
    }
    @Override protected void handleOnDestroy() { CloudOriginalDownload.Job job=downloadJob;if(job!=null)job.cancel();worker.shutdown(); }

    @PluginMethod public void importPhoto(PluginCall call) {
        run(call, () -> importAt(ownerRoot(call),call.getString("studentId"),call.getString("uri"),UUID.randomUUID().toString()));
    }
    private JSObject importAt(File root,String studentId,String input,String id) throws Exception {
            PhotoBatchStore.checkStudent(studentId);
            File pending = new File(root, ".import-" + id), target = new File(root, id);
            // Stable IDs in the batch manifest close the crash window between file commit and item commit.
            if(new File(target,"record.json").isFile()) {
                JSObject existing=originalResult(target);
                if(!studentId.equals(existing.getString("studentId"))) throw new IllegalArgumentException("原片学生归属不匹配");
                return existing;
            }
            if (input == null || input.length() > 8192) throw new IllegalArgumentException("未取得本机照片地址");
            if (root.getUsableSpace() < MAX_SOURCE_BYTES + 64L*1024*1024)
                throw new IllegalArgumentException("本机空间不足，请先导出或清理旧照片");
            if(pending.exists()) removeTree(pending,root);
            mkdir(pending);
            boolean saved = false;
            try {
                File original = new File(pending, "original");
                try (InputStream in = openSource(input); FileOutputStream out = new FileOutputStream(original)) {
                    byte[] buf = new byte[65536]; long size=0; int n;
                    while((n=in.read(buf))!=-1) {
                        size+=n;
                        if(size>MAX_SOURCE_BYTES) throw new IllegalArgumentException("原照片超过 32 MB，请选择较小图片");
                        out.write(buf,0,n);
                    }
                    out.getFD().sync();
                }
                BitmapFactory.Options dimensions = bounds(original);
                int orientation;
                try { orientation = new ExifInterface(original).getAttributeInt(ExifInterface.TAG_ORIENTATION, 1); }
                catch (IOException e) { throw new IllegalArgumentException("无法读取照片方向，请重新选择图片"); }
                if(orientation==0) orientation=1;
                PhotoGeometry.exif(orientation);
                JSObject meta = new JSObject();
                meta.put("schemaVersion",1); meta.put("originalId",id); meta.put("createdAt",System.currentTimeMillis());
                meta.put("studentId",studentId);
                meta.put("sha256",digest(original)); meta.put("bytes",original.length()); meta.put("mime",dimensions.outMimeType);
                meta.put("width",dimensions.outWidth); meta.put("height",dimensions.outHeight); meta.put("orientation",orientation);
                meta.put("uprightWidth",orientation>=5?dimensions.outHeight:dimensions.outWidth);
                meta.put("uprightHeight",orientation>=5?dimensions.outWidth:dimensions.outHeight);
                // A preview is disposable. The imported byte stream above is never rewritten.
                Render rendered = render(original, orientation, PhotoGeometry.FULL, 0, 1200);
                try { encode(rendered.bitmap,new File(pending,"preview.jpg"),90); }
                finally { rendered.bitmap.recycle(); }
                writeJson(new File(pending,"record.json"),meta);
                if(!pending.renameTo(target)) throw new IOException("import commit failed");
                saved=true;
                return originalResult(target);
            } finally { if(!saved) removeTree(pending,root); }
    }

    @PluginMethod public void getOriginal(PluginCall call) { run(call, () -> originalResult(photoDir(call))); }

    @PluginMethod public void pickOriginalBatch(PluginCall call) {
        if(downloading.get()){call.reject("请先完成当前原图保存","DOWNLOAD_BUSY");return;}
        if(!busy.compareAndSet(false,true)) {call.reject("正在处理另一张照片，请稍候","PHOTO_BUSY");return;}
        worker.execute(() -> {
            try {
                PhotoBatchStore b=PhotoBatchStore.create(ownerRoot(call),call.getString("studentId"),call.getString("purpose","processed"),integer(call,"limit",100,1,100));
                // Capacitor serializes these non-sensitive identifiers for an activity/process restore.
                call.getData().put("batchId",b.id);
                Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/jpeg","image/png","image/webp"});
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,b.limit>1);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    try {startActivityForResult(call,intent,"originalBatchSelected");}
                    catch(Exception e) {busy.set(false);call.reject("无法打开系统相册，请稍后重试","PHOTO_PICKER");}
                });
            } catch(Exception e) {busy.set(false);call.reject("无法建立相册批次，请检查选择数量与本机空间","PHOTO_INVALID");}
        });
    }
    @ActivityCallback private void originalBatchSelected(PluginCall call,ActivityResult result) {
        busy.set(false);
        if(call==null)return; // The durable selecting record is still visible for explicit cancellation.
        run(call,() -> {
            PhotoBatchStore b=batch(call);
            if(b.state.equals("cancelled")) return batchResult(b);
            Intent data=result.getData();
            if(result.getResultCode()!=Activity.RESULT_OK||data==null) {b.cancel();return batchResult(b);}
            List<String> uris=new ArrayList<>();
            ClipData clips=data.getClipData();
            if(clips!=null) for(int i=0;i<clips.getItemCount();i++)uris.add(clips.getItemAt(i).getUri().toString());
            else if(data.getData()!=null)uris.add(data.getData().toString());
            try {b.select(uris);} catch(IllegalArgumentException e) {b.cancel();throw e;}
            for(int i=0;i<b.items.size();i++) {
                try {getContext().getContentResolver().takePersistableUriPermission(Uri.parse(b.items.get(i).uri),Intent.FLAG_GRANT_READ_URI_PERMISSION);}
                catch(SecurityException e) {b.failed(i,"此图片来源未保留读取权限；可在当前会话重试，或重新选择照片");}
            }
            return batchResult(b);
        });
    }
    private PhotoBatchStore batch(PluginCall call) throws Exception {
        return PhotoBatchStore.load(ownerRoot(call),call.getString("batchId"),call.getString("studentId"));
    }
    private static JSObject batchResult(PhotoBatchStore b) throws Exception {
        JSObject result=new JSObject(); result.put("schemaVersion",1);result.put("batchId",b.id);result.put("studentId",b.studentId);
        result.put("purpose",b.purpose);result.put("state",b.state);result.put("limit",b.limit);result.put("createdAt",b.createdAt);
        JSArray items=new JSArray();
        for(int n=0;n<b.items.size();n++) {PhotoBatchStore.Item item=b.items.get(n);JSObject value=new JSObject();
            value.put("index",n);value.put("originalId",item.originalId);value.put("status",item.status);
            if(!item.error.isEmpty())value.put("error",item.error);items.put(value);
        }
        result.put("items",items);return result;
    }
    @PluginMethod public void getOriginalBatch(PluginCall call) {run(call,()->batchResult(batch(call)));}
    @PluginMethod public void listOriginalBatches(PluginCall call) {
        run(call,()-> {
            String student=call.getString("studentId"),purpose=call.getString("purpose");PhotoBatchStore.checkStudent(student);
            if(purpose!=null)PhotoBatchStore.checkPurpose(purpose);
            JSArray batches=new JSArray();for(PhotoBatchStore b:PhotoBatchStore.list(ownerRoot(call)))
                if(b.studentId.equals(student)&&(purpose==null||purpose.equals(b.purpose)))batches.put(batchResult(b));
            JSObject result=new JSObject();result.put("batches",batches);return result;
        });
    }
    @PluginMethod public void importBatchItem(PluginCall call) {
        run(call,()-> {
            PhotoBatchStore b=batch(call);int index=integer(call,"index",-1,0,99);
            if(b.state.equals("cancelled")||b.state.equals("selecting"))throw new IllegalArgumentException("此照片批次尚未选择或已取消");
            PhotoBatchStore.Item item=b.item(index);String uri=item.uri;JSObject original=null;
            try { JSObject imported=importAt(ownerRoot(call),b.studentId,item.uri,item.originalId);b.imported(index);original=imported; }
            catch(IllegalArgumentException e) {b.failed(index,e.getMessage());}
            catch(OutOfMemoryError e) {b.failed(index,"手机可用内存不足，可关闭其他应用后单张重试");}
            catch(Exception e) {b.failed(index,"照片未导入，可重试；若来源文件已移动或失去权限，请重新选择");}
            if(original!=null)releaseUnusedGrant(uri);
            JSObject result=new JSObject();result.put("batch",batchResult(b));if(original!=null)result.put("original",original);return result;
        });
    }
    @PluginMethod public void cancelOriginalBatch(PluginCall call) {
        run(call,()-> {PhotoBatchStore b=batch(call);List<String> uris=new ArrayList<>();for(PhotoBatchStore.Item i:b.items)uris.add(i.uri);
            b.cancel();for(String uri:uris)releaseUnusedGrant(uri);return batchResult(b);});
    }
    @PluginMethod public void forgetOriginalBatch(PluginCall call) {
        run(call,()-> {PhotoBatchStore b=batch(call);
            if(!b.state.equals("completed")&&!b.state.equals("cancelled"))throw new IllegalArgumentException("请先完成导入或明确取消该批次");
            deleteFile(new File(b.file.getPath()+".bak"));deleteFile(new File(b.file.getPath()+".part"));deleteFile(b.file);return new JSObject();});
    }
    private void releaseUnusedGrant(String uri) {
        if(uri==null||uri.isEmpty())return;
        try {
            File roots=new File(getContext().getFilesDir(),"photo-originals-v1");File[] owners=roots.listFiles(File::isDirectory);
            if(owners==null)return;
            // An identical source URI may still belong to another pending batch/account.
            for(File root:owners)for(PhotoBatchStore b:PhotoBatchStore.list(root))for(PhotoBatchStore.Item item:b.items)if(uri.equals(item.uri))return;
            getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(uri),Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch(Exception ignored) { /* Never delete an original or revoke a shared grant when uncertain. */ }
    }

    private File downloads() throws IOException {
        File dir=new File(getContext().getCacheDir(),"cloud-original-downloads-v1");mkdir(dir);return dir;
    }
    private File downloadFile(String id) throws IOException {
        if(!validId(id))throw new IllegalArgumentException("下载编号无效");return new File(downloads(),id+".verified");
    }
    private static JSObject downloadResult(boolean saved) {JSObject r=new JSObject();r.put("saved",saved);r.put("cancelled",!saved);return r;}
    @PluginMethod public void downloadCloudOriginal(PluginCall call) {
        final String token=call.getString("token");
        // Activity calls can be serialized by Capacitor. Credentials must disappear BEFORE launch/save.
        call.getData().remove("token");
        if(busy.get()){call.reject("请先完成当前照片操作","PHOTO_BUSY");return;}
        if(!downloading.compareAndSet(false,true)){call.reject("请先完成当前原图保存","DOWNLOAD_BUSY");return;}
        CloudOriginalDownload.Job job=new CloudOriginalDownload.Job();downloadJob=job;downloadCall=call;
        worker.execute(()-> {
            File part=null,verified=null;
            try {
                String id=call.getString("requestId");verified=downloadFile(id);part=new File(downloads(),id+".part");
                // Only abandoned temporaries age out. A recent verified file may await an activity restore.
                File[] abandoned=downloads().listFiles();if(abandoned!=null)for(File f:abandoned)
                    if(f.lastModified()<System.currentTimeMillis()-24L*60*60*1000)deleteFile(f);
                long bytes=integer(call,"bytes",-1,1,(int)MAX_SOURCE_BYTES);
                String mime=call.getString("mime"),sha=call.getString("sha256");
                CloudOriginalDownload.validate(bytes,sha,mime,token);
                boolean debug=(getContext().getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0;
                java.net.URL url=CloudOriginalDownload.url(call.getString("base"),call.getString("path"),debug);
                if(downloads().getUsableSpace()<bytes+32L*1024*1024)throw new IOException("insufficient private space");
                job.download(url,token,bytes,sha,mime,part);job.check();
                if(!part.renameTo(verified))throw new IOException("download commit failed");
                call.getData().remove("base");call.getData().remove("path");
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(mime);
                intent.putExtra(Intent.EXTRA_TITLE,CloudOriginalDownload.safeName(call.getString("name"),mime));
                getActivity().runOnUiThread(()-> {
                    try {job.check();startActivityForResult(call,intent,"cloudOriginalDestination");}
                    catch(Exception e) {
                        cleanupDownload(call);
                        if(job.cancelled.get())call.resolve(downloadResult(false));
                        else call.reject("无法打开系统保存位置，请重新下载保存","DOWNLOAD_SAVE_FAILED");
                    }
                });
            } catch(Exception e) {
                cleanupDownload(call);
                if(job.cancelled.get())call.resolve(downloadResult(false));
                else call.reject("原图下载未完成或校验失败，未保存；请检查网络与存储后重试","DOWNLOAD_FAILED");
            }
        });
    }
    @PluginMethod public void cancelCloudOriginalDownload(PluginCall call) {
        PluginCall active=downloadCall;
        if(active!=null&&Objects.equals(active.getString("requestId"),call.getString("requestId"))) {
            active.getData().put("cancelled",true);CloudOriginalDownload.Job job=downloadJob;if(job!=null)job.cancel();
        }
        call.resolve();
    }
    @ActivityCallback private void cloudOriginalDestination(PluginCall call,ActivityResult result) {
        if(call==null){downloading.set(false);return;}
        worker.execute(()-> {
            Uri destination=result.getData()==null?null:result.getData().getData();boolean saved=false;
            try {
                if(result.getResultCode()!=Activity.RESULT_OK||destination==null||Boolean.TRUE.equals(call.getBoolean("cancelled"))) {call.resolve(downloadResult(false));return;}
                if(!"content".equals(destination.getScheme()))throw new IOException("invalid output uri");
                File source=downloadFile(call.getString("requestId"));
                CloudOriginalDownload.verify(source,integer(call,"bytes",-1,1,(int)MAX_SOURCE_BYTES),call.getString("sha256"));
                try(InputStream in=new FileInputStream(source);OutputStream out=getContext().getContentResolver().openOutputStream(destination,"wt")) {
                    if(out==null)throw new IOException("output unavailable");byte[] buffer=new byte[65536];int n;
                    while((n=in.read(buffer))!=-1) {if(Boolean.TRUE.equals(call.getBoolean("cancelled")))throw new java.io.InterruptedIOException();out.write(buffer,0,n);}out.flush();
                }
                saved=true;call.resolve(downloadResult(true));
            } catch(Exception e) {
                if(Boolean.TRUE.equals(call.getBoolean("cancelled")))call.resolve(downloadResult(false));
                else call.reject("原图未能保存到所选位置，请重新下载保存","DOWNLOAD_SAVE_FAILED");
            } finally {
                if(!saved&&destination!=null&&result.getResultCode()==Activity.RESULT_OK) {
                    try {DocumentsContract.deleteDocument(getContext().getContentResolver(),destination);}catch(Exception ignored){}
                }
                cleanupDownload(call);
            }
        });
    }
    private void cleanupDownload(PluginCall call) {
        try {String id=call.getString("requestId");deleteFile(downloadFile(id));deleteFile(new File(downloads(),id+".part"));}catch(Exception ignored){}
        downloadJob=null;downloadCall=null;downloading.set(false);
    }

    @PluginMethod public void listOriginals(PluginCall call) {
        run(call, () -> {
            File root=ownerRoot(call);
            int offset=integer(call,"offset",0,0,1000000), limit=integer(call,"limit",30,1,100);
            String studentId=call.getString("studentId");
            if(studentId!=null&&(studentId.trim().isEmpty()||studentId.length()>200)) throw new IllegalArgumentException("请先选择学生");
            File[] dirs=root.listFiles(f->f.isDirectory()&&validId(f.getName())&&new File(f,"record.json").isFile());
            if(dirs==null) throw new IOException("list failed");
            Arrays.sort(dirs,Comparator.comparingLong((File f)->new File(f,"record.json").lastModified()).reversed().thenComparing(File::getName));
            ArrayList<File> matching=new ArrayList<>();
            for(File dir:dirs) {
                if(studentId==null||studentId.equals(readJson(new File(dir,"record.json")).getString("studentId"))) matching.add(dir);
            }
            JSArray originals=new JSArray();
            for(int i=offset;i<Math.min(matching.size(),offset+limit);i++) originals.put(originalResult(matching.get(i)));
            JSObject result=new JSObject();result.put("originals",originals);result.put("total",matching.size());
            return result;
        });
    }

    /** Explicit user deletion only; uploading never invokes this method. */
    @PluginMethod public void deleteOriginal(PluginCall call) {
        run(call, () -> {
            if(!Boolean.TRUE.equals(call.getBoolean("confirmDelete"))) throw new IllegalArgumentException("删除原片需要明确确认");
            File dir=photoDir(call), root=dir.getParentFile();
            removeTree(dir,root);
            return new JSObject();
        });
    }

    @PluginMethod public void process(PluginCall call) {
        run(call, () -> {
            File dir=photoDir(call), original=new File(dir,"original");
            JSObject src=readJson(new File(dir,"record.json"));
            double[] corners=quad(call);
            int turns=integer(call,"quarterTurns",0,0,3), maxEdge=integer(call,"maxEdge",3072,256,4096);
            int jpegQuality=integer(call,"jpegQuality",94,90,100);
            String enhancement=call.getString("enhancement","none");
            if(!"none".equals(enhancement)&&!"light".equals(enhancement)) throw new IllegalArgumentException("不支持此增强模式");
            String hash=digest(original);
            if(!hash.equals(src.getString("sha256"))) throw new IOException("source hash mismatch");
            if(dir.getUsableSpace()<32L*1024*1024) throw new IllegalArgumentException("本机空间不足，无法保存处理图片");
            Render rendered=render(original,src.getInt("orientation"),corners,turns,maxEdge);
            String outputId=UUID.randomUUID().toString();
            File partial=new File(dir,outputId+".part"), output=new File(dir,outputId+".jpg"), record=new File(dir,outputId+".json");
            boolean committed=false;
            try {
                PhotoLight.Analysis analysis=analyze(rendered.bitmap);
                JSObject quality=quality(analysis,rendered.bitmap.getWidth(),rendered.bitmap.getHeight());
                if("light".equals(enhancement)) brighten(rendered.bitmap,analysis);
                encode(rendered.bitmap,partial,jpegQuality);
                if(partial.length()>MAX_UPLOAD_BYTES) throw new IllegalArgumentException("处理图片仍超过 8 MB，原片已保留。请在保留完整题目的前提下重新选区，或取消后重新拍照、选图");
                JSObject result=new JSObject();
                result.put("schemaVersion",1);result.put("algorithmVersion","android-photo-v1");
                result.put("originalId",src.getString("originalId"));result.put("outputId",outputId);
                result.put("studentId",src.getString("studentId"));
                result.put("sourceSha256",hash);result.put("sha256",digest(partial));result.put("bytes",partial.length());
                result.put("mime","image/jpeg");result.put("width",rendered.bitmap.getWidth());result.put("height",rendered.bitmap.getHeight());
                result.put("sourceWidth",src.getInt("uprightWidth"));result.put("sourceHeight",src.getInt("uprightHeight"));
                result.put("exifOrientation",src.getInt("orientation"));
                result.put("decodedWidth",rendered.decodedWidth);result.put("decodedHeight",rendered.decodedHeight);
                result.put("sourceSpace","exif-upright-normalized-edges");result.put("outputSpace","normalized-edges");
                result.put("corners",array(corners));result.put("quarterTurns",turns);result.put("enhancement",enhancement);
                result.put("jpegQuality",jpegQuality);result.put("maxEdge",maxEdge);
                result.put("sourceToOutput",array(rendered.sourceToOutput));
                result.put("outputToSource",array(PhotoGeometry.inverse(rendered.sourceToOutput)));
                result.put("quality",quality);result.put("createdAt",System.currentTimeMillis());
                if(!partial.renameTo(output)) throw new IOException("output commit failed");
                writeJson(record,result);committed=true;
                result.put("uri",Uri.fromFile(output).toString());
                return result;
            } finally {
                rendered.bitmap.recycle();
                if(!committed) { deleteFile(partial);deleteFile(output);deleteFile(record);deleteFile(new File(dir,record.getName()+".part")); }
            }
        });
    }

    private static final class Render {
        final Bitmap bitmap; final int decodedWidth,decodedHeight; final double[] sourceToOutput;
        Render(Bitmap b,int w,int h,double[] transform){bitmap=b;decodedWidth=w;decodedHeight=h;sourceToOutput=transform;}
    }
    private static Render render(File original,int orientation,double[] quad,int turns,int maxEdge) throws IOException {
        BitmapFactory.Options options=bounds(original);
        options.inJustDecodeBounds=false;options.inPreferredConfig=Bitmap.Config.ARGB_8888;
        options.inSampleSize=1;
        // Decode at most 12 MP; a large source remains intact on disk. Limit preview work too.
        int decodeEdge=Math.max(2048,maxEdge);
        while((long)(options.outWidth/options.inSampleSize)*(options.outHeight/options.inSampleSize)>12000000L
            ||Math.max(options.outWidth,options.outHeight)/options.inSampleSize>decodeEdge*2)
            options.inSampleSize*=2;
        Bitmap input=BitmapFactory.decodeFile(original.getPath(),options);
        if(input==null) throw new IOException("decode failed");
        Bitmap output=null;
        try {
            int rawWidth=input.getWidth(),rawHeight=input.getHeight();
            int[] size=PhotoGeometry.outputSize(quad,orientation>=5?rawHeight:rawWidth,orientation>=5?rawWidth:rawHeight,maxEdge,turns);
            if(size[0]<16||size[1]<16) throw new IllegalArgumentException("选区太窄，无法生成可读题图");
            double[] normalized=PhotoGeometry.multiply(PhotoGeometry.rotation(turns),PhotoGeometry.inverse(PhotoGeometry.rectangleToQuad(quad)));
            double[] transform=PhotoGeometry.multiply(PhotoGeometry.scale(size[0],size[1]),
                PhotoGeometry.multiply(normalized,PhotoGeometry.multiply(PhotoGeometry.exif(orientation),PhotoGeometry.scale(1.0/rawWidth,1.0/rawHeight))));
            float[] values=new float[9];for(int i=0;i<9;i++) values[i]=(float)transform[i];
            Matrix matrix=new Matrix();matrix.setValues(values);
            output=Bitmap.createBitmap(size[0],size[1],Bitmap.Config.ARGB_8888);
            Canvas canvas=new Canvas(output);canvas.drawColor(Color.WHITE);
            canvas.drawBitmap(input,matrix,new Paint(Paint.FILTER_BITMAP_FLAG|Paint.ANTI_ALIAS_FLAG));
            return new Render(output,rawWidth,rawHeight,normalized);
        } catch (Exception|OutOfMemoryError e) { if(output!=null)output.recycle();throw e; }
        finally { input.recycle(); }
    }
    private static PhotoLight.Analysis analyze(Bitmap source) {
        double scale=Math.min(1,512.0/Math.max(source.getWidth(),source.getHeight()));
        Bitmap small=Bitmap.createScaledBitmap(source,Math.max(1,(int)Math.round(source.getWidth()*scale)),Math.max(1,(int)Math.round(source.getHeight()*scale)),true);
        try {
            int[] pixels=new int[small.getWidth()*small.getHeight()];
            small.getPixels(pixels,0,small.getWidth(),0,0,small.getWidth(),small.getHeight());
            return PhotoLight.analyze(pixels,small.getWidth(),small.getHeight());
        } finally { if(small!=source)small.recycle(); }
    }
    private static JSObject quality(PhotoLight.Analysis a,int w,int h) {
        JSObject result=new JSObject();JSArray warnings=new JSArray();
        if(a.percentile90<120) warnings.put("low-light");
        if(a.percentile90-a.percentile10<12&&a.laplacianVariance<35&&a.darkFraction<.001) warnings.put("low-contrast-or-blank");
        if(a.backgroundRange>50) warnings.put("uneven-light-or-colored-background");
        if(a.laplacianVariance<35&&a.percentile90-a.percentile10>=12) warnings.put("possible-blur");
        if(Math.min(w,h)<400) warnings.put("small-output");
        result.put("warnings",warnings);result.put("advisoryOnly",true);
        result.put("laplacianVariance",a.laplacianVariance);result.put("darkFraction",a.darkFraction);
        result.put("backgroundRange",a.backgroundRange);result.put("percentile10",a.percentile10);result.put("percentile90",a.percentile90);
        return result;
    }
    private static void brighten(Bitmap bitmap,PhotoLight.Analysis a) {
        int w=bitmap.getWidth(),h=bitmap.getHeight();int[] row=new int[w];
        for(int y=0;y<h;y++) {
            bitmap.getPixels(row,0,w,0,y,w,1);
            for(int x=0;x<w;x++) row[x]=PhotoLight.brighten(row[x],a.gain((x+.5)/w,(y+.5)/h));
            bitmap.setPixels(row,0,w,0,y,w,1);
        }
    }
    private static BitmapFactory.Options bounds(File file) {
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;
        BitmapFactory.decodeFile(file.getPath(),options);
        if(options.outWidth<1||options.outHeight<1||(long)options.outWidth*options.outHeight>100000000L
            ||Math.max(options.outWidth,options.outHeight)>50000
            ||!Arrays.asList("image/jpeg","image/png","image/webp").contains(options.outMimeType))
            throw new IllegalArgumentException("请选择有效的 JPEG、PNG 或 WebP 照片（不超过一亿像素）");
        return options;
    }
    private InputStream openSource(String value) throws IOException {
        Uri uri=Uri.parse(value);
        if("content".equals(uri.getScheme())) {
            InputStream in=getContext().getContentResolver().openInputStream(uri);
            if(in==null)throw new IOException("no input");return in;
        }
        if("file".equals(uri.getScheme())||uri.getScheme()==null) {
            if(uri.getPath()==null)throw new IllegalArgumentException("本机照片地址无效");
            File f=new File(uri.getPath()).getCanonicalFile();
            boolean allowed=inside(f,getContext().getCacheDir())||inside(f,getContext().getFilesDir());
            File external=getContext().getExternalCacheDir();
            if(external!=null)allowed|=inside(f,external);
            for(File privateExternal:getContext().getExternalFilesDirs(null))
                if(privateExternal!=null)allowed|=inside(f,privateExternal);
            if(!allowed)throw new IllegalArgumentException("请通过系统相机或相册选择照片");
            return new FileInputStream(f);
        }
        throw new IllegalArgumentException("只接受本机照片，请传入相机返回的 uri");
    }
    private File ownerRoot(PluginCall call) throws Exception {
        String owner=call.getString("owner");
        if(owner==null||owner.trim().isEmpty()||owner.length()>1024)throw new IllegalArgumentException("未指定照片所属账号");
        String key=hex(MessageDigest.getInstance("SHA-256").digest(owner.getBytes(StandardCharsets.UTF_8)));
        File root=new File(new File(getContext().getFilesDir(),"photo-originals-v1"),key);mkdir(root);return root;
    }
    private File photoDir(PluginCall call) throws Exception {
        String id=call.getString("originalId");
        if(!validId(id))throw new IllegalArgumentException("原片编号无效");
        File dir=new File(ownerRoot(call),id);
        if(!new File(dir,"original").isFile()||!new File(dir,"record.json").isFile())throw new IllegalArgumentException("本机原片不存在，可能已被删除或清理");
        return dir;
    }
    private static boolean validId(String id) { return id!=null&&id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"); }
    private static JSObject originalResult(File dir) throws Exception {
        JSObject meta=readJson(new File(dir,"record.json"));
        meta.put("originalUri",Uri.fromFile(new File(dir,"original")).toString());
        meta.put("previewUri",Uri.fromFile(new File(dir,"preview.jpg")).toString());return meta;
    }
    private static double[] quad(PluginCall call) throws Exception {
        JSONArray a=call.getArray("corners");
        if(a==null)return PhotoGeometry.FULL.clone();
        if(a.length()!=8)throw new IllegalArgumentException("四角坐标应包含八个数值");
        double[] q=new double[8];for(int i=0;i<8;i++){if(!(a.get(i) instanceof Number))throw new IllegalArgumentException("边角坐标必须是数字");q[i]=a.getDouble(i);}
        PhotoGeometry.validateQuad(q);return q;
    }
    private static int integer(PluginCall call,String name,int fallback,int min,int max) {
        Object value=call.getData().opt(name);
        if(value==null||value==JSONObject.NULL)return fallback;
        if(!(value instanceof Number))throw new IllegalArgumentException("处理参数无效："+name);
        double d=((Number)value).doubleValue();
        if(!Double.isFinite(d)||d!=Math.rint(d)||d<min||d>max)throw new IllegalArgumentException("处理参数超出范围："+name);
        return (int)d;
    }
    private static JSArray array(double[] values) throws org.json.JSONException { JSArray a=new JSArray();for(double x:values)a.put(x);return a; }
    private static void encode(Bitmap bitmap,File dest,int quality) throws IOException {
        try(FileOutputStream stream=new FileOutputStream(dest)) {
            if(!bitmap.compress(Bitmap.CompressFormat.JPEG,quality,stream))throw new IOException("encode failed");
            stream.getFD().sync();
        }
    }
    private static String digest(File f) throws Exception {
        MessageDigest md=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(f)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)md.update(b,0,n);}
        return hex(md.digest());
    }
    private static String hex(byte[] bytes) { StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString(); }
    private static void writeJson(File f,JSObject value) throws IOException {
        File part=new File(f.getParentFile(),f.getName()+".part");
        try(FileOutputStream out=new FileOutputStream(part)){out.write(value.toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
        if(!part.renameTo(f))throw new IOException("record commit failed");
    }
    private static JSObject readJson(File f) throws Exception {
        if(f.length()>65536)throw new IOException("record too large");
        try(InputStream in=new FileInputStream(f);ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>65536)throw new IOException("record too large");}
            return new JSObject(out.toString(StandardCharsets.UTF_8.name()));
        }
    }
    private static void mkdir(File dir) throws IOException { if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("directory creation failed"); }
    private static boolean inside(File child,File root) throws IOException { return child.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator); }
    private static void deleteFile(File file) throws IOException { if(file.exists()&&!file.delete())throw new IOException("file deletion failed"); }
    private static void removeTree(File dir,File root) throws IOException {
        if(!inside(dir,root))throw new IOException("invalid removal path");
        if(!dir.exists())return;
        File[] children=dir.listFiles();
        if(children==null)throw new IOException("cannot list directory");
        for(File child:children){if(child.isDirectory())removeTree(child,root);else{if(!inside(child,root))throw new IOException("invalid file");deleteFile(child);}}
        deleteFile(dir);
    }
}
