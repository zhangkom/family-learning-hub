package cn.familylearning.study;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.util.Objects;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name="WorksheetExport")
public class WorksheetExportPlugin extends Plugin {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    private volatile WorksheetDownload.Job job;
    private volatile PluginCall active;
    private File directory() throws IOException {
        File dir=new File(getContext().getCacheDir(),"worksheet-exports-v1");
        if(!dir.exists()&&!dir.mkdirs())throw new IOException("private storage unavailable");return dir;
    }
    private File file(String id) throws IOException {
        if(id==null||!id.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}"))throw new IOException("invalid request id");return new File(directory(),id+".docx");
    }
    private static JSObject result(boolean saved){JSObject value=new JSObject();value.put("saved",saved);value.put("cancelled",!saved);return value;}
    @PluginMethod public void exportWorksheet(PluginCall call) {
        final String token=call.getString("token"),body=call.getString("body"),base=call.getString("base");
        call.getData().remove("token");call.getData().remove("body");call.getData().remove("base");
        if(!busy.compareAndSet(false,true)){call.reject("请先完成当前 Word 保存","WORKSHEET_BUSY");return;}
        final WorksheetDownload.Job current=new WorksheetDownload.Job();job=current;active=call;
        worker.execute(()-> {
            try {
                File target=file(call.getString("requestId"));
                File[] abandoned=directory().listFiles();if(abandoned!=null)for(File f:abandoned)if(f.lastModified()<System.currentTimeMillis()-86400000L)f.delete();
                if(directory().getUsableSpace()<WorksheetDownload.MAX_BYTES+16L*1024*1024)throw new IOException("private storage full");
                boolean debug=(getContext().getApplicationInfo().flags&android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE)!=0;
                String sha=current.download(WorksheetDownload.url(base,debug),token,body,target);current.check();
                call.getData().put("bytes",target.length());call.getData().put("sha256",sha);
                Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(WorksheetDownload.MIME);
                intent.putExtra(Intent.EXTRA_TITLE,WorksheetDownload.safeName(call.getString("name")));
                getActivity().runOnUiThread(()-> {
                    try {current.check();startActivityForResult(call,intent,"worksheetDestination");}
                    catch(Exception e){cleanup(call);if(current.cancelled.get())call.resolve(result(false));else call.reject("无法打开系统保存位置，请重试","WORKSHEET_SAVE_FAILED");}
                });
            } catch(Exception e) {
                cleanup(call);
                if(current.cancelled.get())call.resolve(result(false));
                else if(e instanceof WorksheetDownload.DownloadFailure)call.reject(e.getMessage(),((WorksheetDownload.DownloadFailure)e).status==401?"WORKSHEET_UNAUTHORIZED":"WORKSHEET_HTTP_FAILED");
                else call.reject("Word 下载或校验未完成，请检查网络与存储后重试","WORKSHEET_DOWNLOAD_FAILED");
            }
        });
    }
    @PluginMethod public void cancelExport(PluginCall call) {
        PluginCall pending=active;if(pending!=null&&Objects.equals(pending.getString("requestId"),call.getString("requestId"))){pending.getData().put("cancelled",true);WorksheetDownload.Job current=job;if(current!=null)current.cancel();}call.resolve();
    }
    @ActivityCallback private void worksheetDestination(PluginCall call,ActivityResult result) {
        if(call==null){busy.set(false);return;}
        worker.execute(()-> {
            Uri destination=result.getData()==null?null:result.getData().getData();boolean saved=false;
            try {
                if(result.getResultCode()!=Activity.RESULT_OK||destination==null||Boolean.TRUE.equals(call.getBoolean("cancelled"))){call.resolve(result(false));return;}
                if(!"content".equals(destination.getScheme()))throw new IOException("invalid output uri");
                File source=file(call.getString("requestId"));WorksheetDownload.verify(source,call.getData().optLong("bytes",-1),call.getString("sha256"));
                try(InputStream in=new FileInputStream(source);OutputStream out=getContext().getContentResolver().openOutputStream(destination,"wt")) {
                    if(out==null)throw new IOException("output unavailable");byte[] buffer=new byte[65536];int n;
                    while((n=in.read(buffer))!=-1){if(Boolean.TRUE.equals(call.getBoolean("cancelled")))throw new InterruptedIOException();out.write(buffer,0,n);}out.flush();
                }
                saved=true;call.resolve(result(true));
            } catch(Exception e){if(Boolean.TRUE.equals(call.getBoolean("cancelled")))call.resolve(result(false));else call.reject("Word 未能保存到所选位置，请重试","WORKSHEET_SAVE_FAILED");}
            finally {
                if(!saved&&destination!=null&&result.getResultCode()==Activity.RESULT_OK)try{DocumentsContract.deleteDocument(getContext().getContentResolver(),destination);}catch(Exception ignored){}
                cleanup(call);
            }
        });
    }
    private void cleanup(PluginCall call) {
        try {File target=file(call.getString("requestId"));if(target.exists())target.delete();}catch(Exception ignored){}
        if(active==call){active=null;job=null;busy.set(false);}
    }
    @Override protected void handleOnDestroy(){WorksheetDownload.Job current=job;if(current!=null)current.cancel();worker.shutdown();super.handleOnDestroy();}
}
