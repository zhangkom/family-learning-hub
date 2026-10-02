package cn.familylearning.study;

import com.sun.net.httpserver.HttpServer;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Real filesystem and HTTP-stream tests. No Android runtime, SAF UI or physical-device claim. */
public final class PhotoBatchTransportTest {
    private static int checks=0;
    private interface Checked {void run() throws Exception;}
    private static void check(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
    private static void rejects(Checked action,String name)throws Exception{try{action.run();}catch(Exception expected){checks++;return;}throw new AssertionError(name);}
    private static String sha(byte[] bytes)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    public static void main(String[] args)throws Exception {
        File root=Files.createTempDirectory(Path.of(args[0]),"native-batch-").toFile();
        File alice=new File(root,"owner-a"),bob=new File(root,"owner-b");alice.mkdirs();bob.mkdirs();
        PhotoBatchStore batch=PhotoBatchStore.create(alice,"学生甲","cloud-original",200);
        List<String> sources=new ArrayList<>();for(int i=0;i<450;i++)sources.add("content://synthetic/"+i);
        batch.select(sources);String first=batch.items.get(0).originalId;
        check(batch.items.size()==450&&batch.limit==450,"cloud selection expands beyond 200 without truncation");check(new HashSet<>(batch.items.stream().map(i->i.originalId).toList()).size()==450,"stable unique IDs");
        batch.imported(0);batch.failed(1,"source unavailable");
        PhotoBatchStore resumed=PhotoBatchStore.load(alice,batch.id,"学生甲");
        check(resumed.items.get(0).originalId.equals(first)&&resumed.items.get(0).status.equals("imported")&&resumed.items.get(0).uri.isEmpty(),"restart keeps completed ID and drops source grant ref");
        check(resumed.items.get(1).status.equals("failed")&&!resumed.items.get(1).uri.isEmpty(),"restart keeps retry reference");
        rejects(()->PhotoBatchStore.load(alice,batch.id,"学生乙"),"student isolation");
        rejects(()->PhotoBatchStore.load(bob,batch.id,"学生甲"),"owner isolation");
        rejects(()->PhotoBatchStore.load(alice,"../escape","学生甲"),"path traversal");
        rejects(()->PhotoBatchStore.create(alice,"学生甲","processed",101),"processed count validation");
        PhotoBatchStore overflow=PhotoBatchStore.create(alice,"学生甲","processed",99);
        rejects(()->overflow.select(sources),"provider exceeding remaining count rejected without truncation");
        check(PhotoBatchStore.load(alice,overflow.id,"学生甲").items.isEmpty(),"overflow stores no partial selection");
        PhotoBatchStore duplicate=PhotoBatchStore.create(alice,"学生甲","processed",1);
        duplicate.select(List.of(sources.get(0),sources.get(0)));check(duplicate.items.size()==1,"duplicate URI deduplication");
        // Simulate process loss between backup rename and new manifest publication.
        File backup=new File(resumed.file.getPath()+".bak");check(resumed.file.renameTo(backup),"simulate interrupted manifest replacement");
        resumed=PhotoBatchStore.load(alice,batch.id,"学生甲");check(resumed.items.size()==450,"atomic backup recovered");
        for(int i=1;i<450;i++)resumed.imported(i);
        check(PhotoBatchStore.load(alice,batch.id,"学生甲").state.equals("completed"),"completed persisted until application acknowledgment");
        duplicate.cancel();check(PhotoBatchStore.load(alice,duplicate.id,"学生甲").items.get(0).uri.isEmpty(),"cancellation clears pending access reference");

        String path="/cloud-photos/11111111-1111-4111-8111-111111111111/file";
        String production="https://123.207.232.151/family-learning/api/mobile/v1";
        check(CloudOriginalDownload.url(production,path,false).getHost().equals("123.207.232.151"),"production scope");
        for(String bad:List.of("https://evil.test/family-learning/api/mobile/v1",production+"?token=x",production+"/",production.replace("https:","http:"),production.replace("123.207","user:pass@123.207")))
            rejects(()->CloudOriginalDownload.url(bad,path,false),"reject external/credential/query/non-HTTPS base");
        for(String bad:List.of(path+"?token=x",path.replace("/file","/%2e%2e/session"),"//evil.test/file",path.toUpperCase()))
            rejects(()->CloudOriginalDownload.url(production,bad,false),"reject unsafe path");
        byte[] payload=new byte[2*1024*1024+17];new Random(42).nextBytes(payload);String digest=sha(payload);
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);ExecutorService serverWorkers=Executors.newCachedThreadPool();server.setExecutor(serverWorkers);
        AtomicReference<String> mode=new AtomicReference<>("ok");AtomicInteger leaked=new AtomicInteger();CountDownLatch started=new CountDownLatch(1);
        server.createContext("/leak",exchange->{leaked.incrementAndGet();exchange.sendResponseHeaders(204,-1);exchange.close();});
        server.createContext("/family-learning/api/mobile/v1"+path,exchange->{
            try {
                if(!"Bearer synthetic-token".equals(exchange.getRequestHeaders().getFirst("Authorization"))||exchange.getRequestURI().getRawQuery()!=null){exchange.sendResponseHeaders(401,-1);return;}
                if(mode.get().equals("redirect")){exchange.getResponseHeaders().set("Location","/leak");exchange.sendResponseHeaders(302,-1);return;}
                exchange.getResponseHeaders().set("Content-Type",mode.get().equals("mime")?"image/jpeg":"image/png");
                exchange.sendResponseHeaders(200,payload.length);started.countDown();
                try(OutputStream out=exchange.getResponseBody()) {
                    for(int n=0;n<payload.length;n+=4096){out.write(payload,n,Math.min(4096,payload.length-n));if(mode.get().equals("slow")){out.flush();try{Thread.sleep(2);}catch(InterruptedException ignored){}}}
                }
            }catch(IOException ignored){}finally{exchange.close();}
        });
        server.start();
        try {
            String local="http://127.0.0.1:"+server.getAddress().getPort()+"/family-learning/api/mobile/v1";
            rejects(()->CloudOriginalDownload.url(local,path,false),"release rejects loopback HTTP");
            URL url=CloudOriginalDownload.url(local,path,true);File temp=new File(root,"download.part");
            new CloudOriginalDownload.Job().download(url,"synthetic-token",payload.length,digest,"image/png",temp);
            check(Arrays.equals(Files.readAllBytes(temp.toPath()),payload),"byte-identical streamed download");CloudOriginalDownload.verify(temp,payload.length,digest);temp.delete();
            rejects(()->new CloudOriginalDownload.Job().download(url,"synthetic-token",payload.length,"0".repeat(64),"image/png",temp),"wrong SHA rejected");check(!temp.exists(),"hash failure cleans temp");
            rejects(()->new CloudOriginalDownload.Job().download(url,"synthetic-token",payload.length-1,digest,"image/png",temp),"wrong size rejected");check(!temp.exists(),"size failure cleans temp");
            mode.set("mime");rejects(()->new CloudOriginalDownload.Job().download(url,"synthetic-token",payload.length,digest,"image/png",temp),"wrong MIME rejected");
            mode.set("redirect");rejects(()->new CloudOriginalDownload.Job().download(url,"synthetic-token",payload.length,digest,"image/png",temp),"redirect rejected");check(leaked.get()==0,"no redirected request or token leak");
            mode.set("slow");CloudOriginalDownload.Job job=new CloudOriginalDownload.Job();AtomicReference<Throwable> error=new AtomicReference<>();
            Thread task=new Thread(()->{try{job.download(url,"synthetic-token",payload.length,digest,"image/png",temp);}catch(Throwable e){error.set(e);}});task.start();
            long until=System.currentTimeMillis()+5000;while((!temp.exists()||temp.length()==0)&&System.currentTimeMillis()<until)Thread.sleep(5);
            job.cancel();task.join(5000);check(!task.isAlive()&&error.get()!=null,"in-flight stream cancellation");check(!temp.exists(),"cancel cleans private partial");
            rejects(()->CloudOriginalDownload.validate(33554433,digest,"image/png","synthetic-token"),"32 MiB cap");
            rejects(()->CloudOriginalDownload.validate(1,digest,"image/png","bad\r\nHeader"),"header injection rejected");
            check(!CloudOriginalDownload.safeName("../../x\n.png","image/png").contains("/"),"save name sanitized");
        } finally {server.stop(0);serverWorkers.shutdownNow();}
        System.out.println("PASS "+checks+" real Java batch/filesystem/HTTP checks; Android activity UI and physical device not exercised.");
    }
}
