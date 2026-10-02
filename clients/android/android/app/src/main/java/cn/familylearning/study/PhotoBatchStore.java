package cn.familylearning.study;

import java.io.*;
import java.util.*;

/** Durable metadata only. Image bytes live in the existing original store, never in this manifest. */
final class PhotoBatchStore {
    static int maxItems(String purpose) {
        checkPurpose(purpose);
        // A cloud selection may span many 200-image upload groups; this manifest contains metadata only.
        return Integer.MAX_VALUE;
    }
    static final class Item {
        String originalId, uri, status = "pending", error = "";
        Item(String uri) { this.uri=uri; originalId=UUID.randomUUID().toString(); }
    }
    final File file;
    String id, studentId, purpose, state = "selecting", treeUri = "";
    int limit;
    long createdAt;
    final List<Item> items = new ArrayList<>();

    private PhotoBatchStore(File file) { this.file=file; }
    static PhotoBatchStore create(File root,String student,String purpose,int limit) throws IOException {
        checkStudent(student); checkPurpose(purpose);
        if(limit<1||limit>maxItems(purpose)) throw new IllegalArgumentException("每批最多选择 "+maxItems(purpose)+" 张照片");
        String id=UUID.randomUUID().toString();
        PhotoBatchStore batch=new PhotoBatchStore(path(root,id));
        batch.id=id; batch.studentId=student; batch.purpose=purpose; batch.limit=limit;
        batch.createdAt=System.currentTimeMillis(); batch.save(); return batch;
    }
    static void checkStudent(String student) {
        if(student==null||student.trim().isEmpty()||student.length()>200) throw new IllegalArgumentException("请先选择学生");
    }
    static void checkPurpose(String purpose) {
        if(!"processed".equals(purpose)&&!"cloud-original".equals(purpose)) throw new IllegalArgumentException("照片批次用途无效");
    }
    private static File path(File root,String id) {
        if(id==null||!id.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")) throw new IllegalArgumentException("照片批次编号无效");
        return new File(new File(root,".batches"),id+".properties");
    }
    static PhotoBatchStore load(File root,String id,String student) throws IOException {
        checkStudent(student);
        PhotoBatchStore batch=read(path(root,id));
        if(!batch.studentId.equals(student)) throw new IllegalArgumentException("照片批次学生归属不匹配");
        return batch;
    }
    static List<PhotoBatchStore> list(File root) throws IOException {
        File dir=new File(root,".batches");
        if(!dir.exists()) return new ArrayList<>();
        File[] files=dir.listFiles(); if(files==null) throw new IOException("batch list failed");
        Set<String> names=new HashSet<>();
        for(File f:files) {
            String name=f.getName();
            if(name.endsWith(".properties.bak")) name=name.substring(0,name.length()-4);
            if(name.endsWith(".properties")) names.add(name);
        }
        List<PhotoBatchStore> batches=new ArrayList<>();
        for(String name:names) batches.add(read(new File(dir,name)));
        batches.sort(Comparator.comparingLong((PhotoBatchStore b)->b.createdAt).reversed());
        return batches;
    }
    private static PhotoBatchStore read(File file) throws IOException {
        File backup=new File(file.getPath()+".bak");
        if(!file.exists()&&backup.exists()&&!backup.renameTo(file)) throw new IOException("batch recovery failed");
        if(!file.isFile()) throw new IOException("batch missing");
        Properties p=new Properties(); try(InputStream in=new FileInputStream(file)){p.load(in);}
        PhotoBatchStore b=new PhotoBatchStore(file);
        try {
            b.id=p.getProperty("id"); b.studentId=p.getProperty("student"); b.purpose=p.getProperty("purpose");
            b.treeUri=p.getProperty("treeUri","");
            if(!b.treeUri.isEmpty()&&(!b.treeUri.startsWith("content://")||b.treeUri.length()>8192))throw new IllegalArgumentException();
            checkStudent(b.studentId); checkPurpose(b.purpose);
            if(!path(file.getParentFile().getParentFile(),b.id).equals(file)) throw new IllegalArgumentException();
            b.state=p.getProperty("state");
            if(!Arrays.asList("selecting","ready","completed","cancelled").contains(b.state)) throw new IllegalArgumentException();
            b.limit=Integer.parseInt(p.getProperty("limit")); b.createdAt=Long.parseLong(p.getProperty("createdAt"));
            int count=Integer.parseInt(p.getProperty("count"));
            if(b.limit<1||b.limit>maxItems(b.purpose)||count<0||count>b.limit||b.createdAt<=0) throw new IllegalArgumentException();
            for(int i=0;i<count;i++) {
                Item item=new Item(p.getProperty(i+".uri","")); item.originalId=p.getProperty(i+".id");
                path(file.getParentFile().getParentFile(),item.originalId);
                item.status=p.getProperty(i+".status"); item.error=p.getProperty(i+".error","");
                if(!Arrays.asList("pending","imported","failed").contains(item.status)||item.uri.length()>8192) throw new IllegalArgumentException();
                b.items.add(item);
            }
        } catch(RuntimeException e) {throw new IOException("invalid batch record",e);}
        return b;
    }
    void select(List<String> uris) throws IOException {
        if(!state.equals("selecting")) throw new IllegalArgumentException("该相册选择已经结束");
        LinkedHashSet<String> unique=new LinkedHashSet<>(uris);
        for(String uri:unique) if(uri==null||!uri.startsWith("content://")||uri.length()>8192) throw new IllegalArgumentException("系统未返回有效的照片地址");
        limit=Math.max(limit,unique.size());
        for(String uri:unique) items.add(new Item(uri));
        state=items.isEmpty()?"cancelled":"ready"; save();
    }
    Item item(int index) {
        if(index<0||index>=items.size()) throw new IllegalArgumentException("照片序号无效");
        return items.get(index);
    }
    void imported(int index) throws IOException {
        Item item=item(index); item.status="imported"; item.uri=""; item.error="";
        state=items.stream().allMatch(i->i.status.equals("imported"))?"completed":"ready"; save();
    }
    void failed(int index,String message) throws IOException {
        Item item=item(index); item.status="failed"; item.error=message; save();
    }
    void cancel() throws IOException { state="cancelled"; for(Item i:items)i.uri=""; save(); }
    void save() throws IOException {
        File dir=file.getParentFile(); if(!dir.isDirectory()&&!dir.mkdirs()) throw new IOException("batch directory failed");
        Properties p=new Properties();
        p.setProperty("id",id);p.setProperty("student",studentId);p.setProperty("purpose",purpose);p.setProperty("state",state);
        p.setProperty("limit",Integer.toString(limit));p.setProperty("createdAt",Long.toString(createdAt));p.setProperty("count",Integer.toString(items.size()));
        p.setProperty("treeUri",treeUri);
        for(int n=0;n<items.size();n++) {Item i=items.get(n);p.setProperty(n+".id",i.originalId);p.setProperty(n+".uri",i.uri);p.setProperty(n+".status",i.status);p.setProperty(n+".error",i.error);}
        File tmp=new File(file.getPath()+".part"),bak=new File(file.getPath()+".bak");
        try(FileOutputStream out=new FileOutputStream(tmp)){p.store(out,"Photo batch v1");out.getFD().sync();}
        if(bak.exists()&&!bak.delete())throw new IOException("batch backup cleanup failed");
        if(file.exists()&&!file.renameTo(bak))throw new IOException("batch backup failed");
        if(!tmp.renameTo(file))throw new IOException("batch commit failed");
        if(bak.exists()&&!bak.delete())throw new IOException("batch backup cleanup failed");
    }
}

