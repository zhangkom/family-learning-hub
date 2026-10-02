package cn.familylearning.study;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentUris;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.LruCache;
import android.util.Size;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.*;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;

/** Explicit, local-only gallery. Only confirmed items enter the durable import batch. */
public final class AlbumRangeActivity extends Activity {
    private static final int BLUE = 0xff315ced, INK = 0xff182440, MUTED = 0xff65738b;
    private static final int PERMISSION_REQUEST = 71;
    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    private final ThreadPoolExecutor thumbnails = new ThreadPoolExecutor(2, 2, 20, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(48), new ThreadPoolExecutor.DiscardOldestPolicy());
    private final LruCache<String, Bitmap> cache = new LruCache<String, Bitmap>(12 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Bitmap value) { return value.getAllocationByteCount(); }
    };
    private final AlbumRangeSelection selection = new AlbumRangeSelection();
    private List<Photo> all = new ArrayList<>(), visible = new ArrayList<>();
    private File root;
    private String batchId, studentId, album = "", fingerprint = "";
    private int generation;
    private boolean loading, saving, destroyed;
    private CancellationSignal querySignal;
    private Bundle restore;
    private LinearLayout shell;
    private TextView info, count, empty;
    private Button albumButton, modeButton, confirm, permissions, allButton, clearButton;
    private GridView grid;
    private PhotoAdapter adapter;

    private static final class Photo {
        final String uri, name, bucket, albumName; final long date, id;
        Photo(String uri, String name, String bucket, String albumName, long date, long id) {
            this.uri=uri; this.name=name; this.bucket=bucket; this.albumName=albumName; this.date=date; this.id=id;
        }
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); setResult(RESULT_CANCELED); restore=state;
        try {
            String ownerKey=getIntent().getStringExtra("ownerKey");
            if(ownerKey==null||!ownerKey.matches("[a-f0-9]{64}"))throw new IllegalArgumentException();
            root=new File(new File(getFilesDir(),"photo-originals-v1"),ownerKey);
            batchId=getIntent().getStringExtra("batchId"); studentId=getIntent().getStringExtra("studentId");
            PhotoBatchStore batch=PhotoBatchStore.load(root,batchId,studentId);
            if(!batch.state.equals("selecting")){setResult(RESULT_OK);finish();return;}
            if(state!=null)album=state.getString("album","");
            buildUi();
            if(Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::onBackPressed);
        } catch(Exception e) { finish(); }
    }
    private void buildUi() {
        shell=new LinearLayout(this);shell.setOrientation(LinearLayout.VERTICAL);shell.setBackgroundColor(0xfff5f7fc);
        shell.setPadding(dp(12),0,dp(12),0);setContentView(shell);
        // Target SDK 36 enforces edge-to-edge: keep controls outside system bars/cutouts.
        shell.setOnApplyWindowInsetsListener((v,insets)->{
            int top=insets.getSystemWindowInsetTop(),bottom=insets.getSystemWindowInsetBottom();
            int left=insets.getSystemWindowInsetLeft(),right=insets.getSystemWindowInsetRight();
            if(Build.VERSION.SDK_INT>=30){android.graphics.Insets bars=insets.getInsets(android.view.WindowInsets.Type.systemBars()|android.view.WindowInsets.Type.displayCutout());top=bars.top;bottom=bars.bottom;left=bars.left;right=bars.right;}
            v.setPadding(dp(12)+left,top+dp(6),dp(12)+right,bottom+dp(8));return insets;
        });
        LinearLayout header=row();Button back=button("返回",false);back.setOnClickListener(v->onBackPressed());header.addView(back);
        TextView title=text("相册选图",20,INK);title.setTypeface(null,Typeface.BOLD);title.setGravity(Gravity.CENTER);
        header.addView(title,new LinearLayout.LayoutParams(0,dp(48),1));permissions=button("照片权限",false);permissions.setTextSize(12);permissions.setOnClickListener(v->permissionMenu());header.addView(permissions);shell.addView(header);
        info=text("先点第一张，滚动相册后再点最后一张。",13,MUTED);info.setPadding(dp(2),dp(6),dp(2),dp(8));shell.addView(info);
        LinearLayout tools=row();albumButton=button("全部照片 ▾",false);albumButton.setOnClickListener(v->chooseAlbum());tools.addView(albumButton,new LinearLayout.LayoutParams(0,dp(44),1));
        modeButton=button("范围选择",false);modeButton.setOnClickListener(v->{selection.setRangeMode(!selection.rangeMode);updateSelection();});tools.addView(modeButton);shell.addView(tools);
        FrameLayout content=new FrameLayout(this);shell.addView(content,new LinearLayout.LayoutParams(-1,0,1));
        grid=new GridView(this);grid.setNumColumns(3);grid.setHorizontalSpacing(dp(4));grid.setVerticalSpacing(dp(4));grid.setPadding(0,dp(8),0,dp(8));grid.setClipToPadding(false);grid.setFastScrollEnabled(true);
        adapter=new PhotoAdapter();grid.setAdapter(adapter);grid.setOnItemClickListener((p,v,pos,id)->{if(!loading&&!saving){selection.tap(pos,visible.size());updateSelection();}});
        content.addView(grid,new FrameLayout.LayoutParams(-1,-1));
        empty=text("",14,MUTED);empty.setGravity(Gravity.CENTER);empty.setPadding(dp(16),dp(24),dp(16),dp(24));content.addView(empty,new FrameLayout.LayoutParams(-1,-1));grid.setEmptyView(empty);
        count=text("已选 0 张",15,INK);count.setPadding(dp(2),dp(8),0,dp(4));shell.addView(count);
        LinearLayout actions=row();clearButton=button("清空",false);clearButton.setOnClickListener(v->{selection.clear();updateSelection();});actions.addView(clearButton);
        allButton=button("全选",false);allButton.setOnClickListener(v->{selection.all(visible.size());updateSelection();});actions.addView(allButton);
        confirm=button("确认选择",true);confirm.setOnClickListener(v->commitSelection());LinearLayout.LayoutParams cp=new LinearLayout.LayoutParams(0,dp(48),1);cp.leftMargin=dp(8);actions.addView(confirm,cp);shell.addView(actions);
        TextView note=text("按照片时间由新到旧 · 包含起止两张 · 确认后保存到本机",11,MUTED);note.setGravity(Gravity.CENTER);note.setPadding(0,dp(6),0,0);shell.addView(note);updateSelection();
    }
    private LinearLayout row(){LinearLayout v=new LinearLayout(this);v.setGravity(Gravity.CENTER_VERTICAL);return v;}
    private TextView text(String s,int sp,int color){TextView v=new TextView(this);v.setText(s);v.setTextSize(sp);v.setTextColor(color);return v;}
    private Button button(String s,boolean primary){Button b=new Button(this);b.setText(s);b.setTextSize(14);b.setAllCaps(false);b.setMinWidth(0);b.setMinimumWidth(0);b.setMinHeight(dp(44));b.setMinimumHeight(dp(44));b.setPadding(dp(12),dp(6),dp(12),dp(6));b.setTextColor(primary?Color.WHITE:INK);GradientDrawable bg=new GradientDrawable();bg.setColor(primary?BLUE:Color.WHITE);bg.setCornerRadius(dp(10));bg.setStroke(dp(1),primary?BLUE:0xffdce4f2);b.setBackground(bg);return b;}
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    private int access(){
        if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES)==PackageManager.PERMISSION_GRANTED)return 2;
        if(Build.VERSION.SDK_INT>=34&&checkSelfPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)==PackageManager.PERMISSION_GRANTED)return 1;
        if(Build.VERSION.SDK_INT<33&&checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE)==PackageManager.PERMISSION_GRANTED)return 2;
        return 0;
    }
    private void requestPhotos(){
        String[] required=Build.VERSION.SDK_INT>=34?new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED}:
            Build.VERSION.SDK_INT>=33?new String[]{Manifest.permission.READ_MEDIA_IMAGES}:new String[]{Manifest.permission.READ_EXTERNAL_STORAGE};
        requestPermissions(required,PERMISSION_REQUEST);
    }
    private void permissionMenu(){
        new AlertDialog.Builder(this).setTitle("相册读取权限").setMessage("范围选择需要显示你授权的照片缩略图。仅在确认后导入所选照片，上传仍需另行确认。只授权部分照片时，相册只显示这些照片。")
            .setPositiveButton("选择可访问照片",(d,w)->requestPhotos()).setNeutralButton("系统权限设置",(d,w)->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())))).setNegativeButton("取消",null).show();
    }
    @Override protected void onResume(){super.onResume();if(shell!=null&&!saving)reload();}
    @Override public void onRequestPermissionsResult(int request,String[] p,int[] results){super.onRequestPermissionsResult(request,p,results);if(request==PERMISSION_REQUEST&&shell!=null)reload();}
    private void reload(){
        int ticket=++generation; if(querySignal!=null)querySignal.cancel();cache.evictAll();thumbnails.getQueue().clear();
        loading=true;grid.setEnabled(false);updateSelection();
        if(access()==0){all=new ArrayList<>();visible=new ArrayList<>();selection.clear();restore=null;loading=false;adapter.notifyDataSetChanged();empty.setText("允许读取照片后，可点起点和终点选中整段。\n点击右上角“照片权限”授权。\n也可以返回，使用系统相册多选。");info.setText("仅在这里浏览授权照片，不会自动上传。");updateSelection();return;}
        empty.setText("正在读取本机相册…");CancellationSignal signal=new CancellationSignal();querySignal=signal;
        loader.execute(()->{
            try{
                List<Photo> loaded=new ArrayList<>();Uri collection=Build.VERSION.SDK_INT>=29?MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL):MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                String[] columns={MediaStore.Images.Media._ID,MediaStore.Images.Media.DISPLAY_NAME,MediaStore.Images.Media.BUCKET_ID,MediaStore.Images.Media.BUCKET_DISPLAY_NAME,MediaStore.Images.Media.DATE_TAKEN,MediaStore.Images.Media.DATE_ADDED};
                String filter=MediaStore.Images.Media.MIME_TYPE+" IN (?,?,?)";
                try(Cursor c=getContentResolver().query(collection,columns,filter,new String[]{"image/jpeg","image/png","image/webp"},MediaStore.Images.Media._ID+" DESC",signal)){
                    if(c==null)throw new IllegalStateException();
                    while(c.moveToNext()){
                        signal.throwIfCanceled();long id=c.getLong(0),taken=c.isNull(4)?0:c.getLong(4),added=c.isNull(5)?0:c.getLong(5)*1000;
                        loaded.add(new Photo(ContentUris.withAppendedId(collection,id).toString(),PhotoSelection.name(c.getString(1)),c.getString(2)==null?"":c.getString(2),c.getString(3)==null?"其他照片":c.getString(3),taken>0?taken:added,id));
                    }
                }
                loaded.sort(Comparator.comparingLong((Photo p)->p.date).reversed().thenComparing(Comparator.comparingLong((Photo p)->p.id).reversed()));
                runOnUiThread(()->{if(destroyed||ticket!=generation)return;all=loaded;loading=false;showAlbum(true);});
            }catch(Exception|OutOfMemoryError e){runOnUiThread(()->{if(destroyed||ticket!=generation)return;all=new ArrayList<>();visible=new ArrayList<>();selection.clear();loading=false;empty.setText("相册读取未完成。可检查照片权限后重试，或返回使用系统相册多选。");adapter.notifyDataSetChanged();updateSelection();});}
        });
    }
    private void chooseAlbum(){
        if(loading||saving)return;
        LinkedHashMap<String,String> albums=new LinkedHashMap<>();albums.put("","全部照片");for(Photo p:all)if(!p.bucket.isEmpty())albums.put(p.bucket,p.albumName);
        List<String> keys=new ArrayList<>(albums.keySet());String[] labels=new String[keys.size()];for(int i=0;i<labels.length;i++)labels[i]=albums.get(keys.get(i));
        new AlertDialog.Builder(this).setTitle("选择相册").setItems(labels,(d,which)->{String next=keys.get(which);if(!next.equals(album)){album=next;selection.clear();restore=null;fingerprint="";showAlbum(false);grid.setSelection(0);}}).setNegativeButton("取消",null).show();
    }
    private void showAlbum(boolean refreshed){
        List<Photo> next=new ArrayList<>();for(Photo p:all)if(album.isEmpty()||album.equals(p.bucket))next.add(p);
        String hash=fingerprint(next),old=fingerprint;visible=next;fingerprint=hash;
        boolean changed=refreshed&&!old.isEmpty()&&!old.equals(hash)&&selection.count()>0;
        if(!old.equals(hash))selection.clear();
        if(restore!=null){if(hash.equals(restore.getString("fingerprint"))){try{selection.restore(restore.getLongArray("bits"),restore.getInt("anchor",-1),restore.getBoolean("range",true),visible.size());}catch(IllegalArgumentException ignored){selection.clear();}}restore=null;}
        String label=album.isEmpty()?"全部照片":visible.isEmpty()?"当前相册":visible.get(0).albumName;
        albumButton.setText(label+" ▾");empty.setText(access()==1?"当前授权范围内没有支持的图片。\n可通过“照片权限”添加照片。":"此相册没有 JPEG、PNG 或 WebP 图片。");
        info.setText((access()==1?"仅显示已授权照片。":"")+"点第一张，滚动后点最后一张，整段选中。");
        if(changed)Toast.makeText(this,"相册内容或权限已变化，请重新选择范围",Toast.LENGTH_LONG).show();updateSelection();
    }
    private static String fingerprint(List<Photo> photos){try{MessageDigest d=MessageDigest.getInstance("SHA-256");for(Photo p:photos){d.update(p.uri.getBytes(StandardCharsets.UTF_8));d.update((byte)0);}StringBuilder b=new StringBuilder();for(byte v:d.digest())b.append(String.format(Locale.ROOT,"%02x",v&255));return b.toString();}catch(Exception e){throw new IllegalStateException(e);}}
    private void updateSelection(){
        if(count==null)return;count.setText("已选 "+selection.count()+" 张"+(selection.anchor()>=0?" · 请滚动后点结束照片":""));
        if(access()>0)info.setText(loading?"正在读取本机相册…":(access()==1?"仅显示已授权照片。":"")+(selection.rangeMode?"点第一张，滚动后点最后一张，整段选中。":"逐张点击可补选或取消；再次点击右侧按钮可切回范围选择。"));
        modeButton.setText(selection.rangeMode?"范围选择 ▾":"逐张调整 ▾");modeButton.setContentDescription(selection.rangeMode?"当前范围选择，点击切换逐张调整":"当前逐张调整，点击切换范围选择");
        boolean enabled=!loading&&!saving;confirm.setEnabled(enabled&&selection.count()>0);confirm.setText(saving?"正在保存…":"确认选择");
        albumButton.setEnabled(enabled);modeButton.setEnabled(enabled);clearButton.setEnabled(enabled&&selection.count()>0);allButton.setEnabled(enabled&&!visible.isEmpty());permissions.setEnabled(!saving);grid.setEnabled(enabled);
        adapter.notifyDataSetChanged();
    }
    private void commitSelection(){
        if(saving||loading||selection.count()==0)return;saving=true;updateSelection();
        List<String> uris=new ArrayList<>();for(int index:selection.indexes())uris.add(visible.get(index).uri);
        loader.execute(()->{try{PhotoBatchStore b=PhotoBatchStore.load(root,batchId,studentId);b.select(uris);runOnUiThread(()->{if(!destroyed){setResult(RESULT_OK);finish();}});}
            catch(Exception e){runOnUiThread(()->{if(!destroyed){saving=false;updateSelection();Toast.makeText(this,"选择未能保存，请检查本机空间后重试",Toast.LENGTH_LONG).show();}});}});
    }
    @Override public void onBackPressed(){if(!saving){setResult(RESULT_CANCELED);finish();}}
    @Override protected void onSaveInstanceState(Bundle state){state.putString("album",album);state.putString("fingerprint",fingerprint);state.putLongArray("bits",selection.savedBits());state.putInt("anchor",selection.anchor());state.putBoolean("range",selection.rangeMode);super.onSaveInstanceState(state);}
    @Override protected void onStop(){super.onStop();if(querySignal!=null)querySignal.cancel();generation++;}
    @Override protected void onDestroy(){destroyed=true;generation++;if(querySignal!=null)querySignal.cancel();loader.shutdown();thumbnails.shutdownNow();cache.evictAll();super.onDestroy();}

    private final class Cell extends FrameLayout {
        final ImageView image; final TextView badge,label; String uri="";CancellationSignal signal;
        Cell(){super(AlbumRangeActivity.this);image=new ImageView(AlbumRangeActivity.this);image.setScaleType(ImageView.ScaleType.CENTER_CROP);image.setBackgroundColor(0xffe5eaf3);addView(image,new FrameLayout.LayoutParams(-1,-1));
            badge=text("",13,Color.WHITE);badge.setGravity(Gravity.CENTER);FrameLayout.LayoutParams bp=new FrameLayout.LayoutParams(dp(44),dp(30),Gravity.TOP|Gravity.END);bp.setMargins(0,dp(3),dp(3),0);addView(badge,bp);
            label=text("",10,Color.WHITE);label.setMaxLines(1);label.setEllipsize(android.text.TextUtils.TruncateAt.END);label.setPadding(dp(4),dp(3),dp(4),dp(3));label.setBackgroundColor(0xa6000000);addView(label,new FrameLayout.LayoutParams(-1,-2,Gravity.BOTTOM));}
        @Override protected void onMeasure(int width,int height){super.onMeasure(width,View.MeasureSpec.makeMeasureSpec(View.MeasureSpec.getSize(width),View.MeasureSpec.EXACTLY));}
    }
    private final class PhotoAdapter extends BaseAdapter {
        private final SimpleDateFormat dates=new SimpleDateFormat("yyyy-MM-dd",Locale.CHINA);
        public int getCount(){return visible.size();}public Object getItem(int pos){return visible.get(pos);}public long getItemId(int pos){return visible.get(pos).id;}
        public View getView(int pos,View recycled,ViewGroup parent){
            Cell cell=recycled instanceof Cell?(Cell)recycled:new Cell();Photo photo=visible.get(pos);boolean selected=selection.contains(pos);
            cell.setPadding(selected?dp(3):0,selected?dp(3):0,selected?dp(3):0,selected?dp(3):0);cell.setBackgroundColor(selected?BLUE:Color.TRANSPARENT);
            cell.badge.setText(pos==selection.anchor()?"起点":selected?"✓":"");cell.badge.setBackgroundColor(selected?BLUE:0x66000000);
            cell.label.setText(dates.format(new Date(photo.date)));cell.setContentDescription((pos+1)+"，"+photo.name+"，"+dates.format(new Date(photo.date))+(selected?"，已选":"，未选"));
            if(!photo.uri.equals(cell.uri)||cell.image.getDrawable()==null){
                if(cell.signal!=null)cell.signal.cancel();cell.uri=photo.uri;cell.image.setImageDrawable(null);
                Bitmap cached=cache.get(photo.uri);if(cached!=null)cell.image.setImageBitmap(cached);
                else{CancellationSignal cancel=new CancellationSignal();cell.signal=cancel;int ticket=generation;
                    thumbnails.execute(()->{Bitmap bitmap=null;try{if(cancel.isCanceled()||destroyed)return;
                        bitmap=Build.VERSION.SDK_INT>=29?getContentResolver().loadThumbnail(Uri.parse(photo.uri),new Size(240,240),cancel):MediaStore.Images.Thumbnails.getThumbnail(getContentResolver(),photo.id,MediaStore.Images.Thumbnails.MINI_KIND,null);
                        if(bitmap!=null&&!cancel.isCanceled()&&!destroyed&&ticket==generation){cache.put(photo.uri,bitmap);Bitmap result=bitmap;runOnUiThread(()->{if(!destroyed&&!cancel.isCanceled()&&ticket==generation&&photo.uri.equals(cell.uri))cell.image.setImageBitmap(result);});}
                    }catch(Exception|OutOfMemoryError ignored){/* Unreadable items remain selectable and get an explicit import failure. */}});
                }
            }return cell;
        }
    }
}
