package cn.familylearning.study;

import com.sun.net.httpserver.HttpServer;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.zip.*;

public final class WorksheetDownloadTest {
    interface Checked {void run()throws Exception;}
    static int checks;
    static void assertTrue(boolean value,String name){if(!value)throw new AssertionError(name);checks++;}
    static void rejected(Checked call)throws Exception{boolean rejected=false;try{call.run();}catch(Exception e){rejected=true;}assertTrue(rejected,"expected rejection");}
    static byte[] docx(boolean valid)throws Exception{ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(ZipOutputStream zip=new ZipOutputStream(bytes)){zip.putNextEntry(new ZipEntry("[Content_Types].xml"));zip.write("<Types/>".getBytes(StandardCharsets.UTF_8));zip.closeEntry();if(valid){zip.putNextEntry(new ZipEntry("word/document.xml"));zip.write("<document>Synthetic only</document>".getBytes(StandardCharsets.UTF_8));zip.closeEntry();}}return bytes.toByteArray();}
    static String sha(byte[] bytes)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format("%02x",b&255));return s.toString();}
    public static void main(String[] args)throws Exception{
        Path root=Files.createTempDirectory("worksheet-download-test-");File target=root.resolve("test.docx").toFile();
        byte[] data=docx(true);String expected=sha(data);AtomicReference<String> mode=new AtomicReference<>("ok");AtomicInteger hits=new AtomicInteger();AtomicBoolean auth=new AtomicBoolean();
        CountDownLatch streaming=new CountDownLatch(1),release=new CountDownLatch(1);ExecutorService executor=Executors.newCachedThreadPool();HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);server.setExecutor(executor);
        server.createContext("/family-learning/api/mobile/v1/worksheets/export",exchange->{
            hits.incrementAndGet();auth.set("POST".equals(exchange.getRequestMethod())&&"Bearer synthetic-token".equals(exchange.getRequestHeaders().getFirst("Authorization"))&&new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8).equals("{\"studentId\":\"synthetic\"}"));
            String current=mode.get();try{
                if(current.equals("redirect")){exchange.getResponseHeaders().set("Location","/must-not-follow");exchange.sendResponseHeaders(302,-1);return;}
                if(current.equals("conflict")){exchange.sendResponseHeaders(409,-1);return;}
                byte[] content=current.equals("invalid")?docx(false):data;
                exchange.getResponseHeaders().set("Content-Type",current.equals("mime")?"text/html":WorksheetDownload.MIME);
                exchange.getResponseHeaders().set("X-Content-SHA256",current.equals("hash")?"a".repeat(64):sha(content));
                exchange.sendResponseHeaders(200,current.equals("oversize")?WorksheetDownload.MAX_BYTES+1:current.equals("truncated")?data.length+20:content.length);
                if(current.equals("hold")){exchange.getResponseBody().write(content,0,4);exchange.getResponseBody().flush();streaming.countDown();release.await(5,TimeUnit.SECONDS);}
                else if(!current.equals("oversize"))exchange.getResponseBody().write(content);
            }catch(Exception ignored){}finally{exchange.close();}
        });
        AtomicInteger redirects=new AtomicInteger();server.createContext("/must-not-follow",e->{redirects.incrementAndGet();e.sendResponseHeaders(200,-1);e.close();});server.start();
        try{
            String base="http://127.0.0.1:"+server.getAddress().getPort()+"/family-learning/api/mobile/v1";URL url=WorksheetDownload.url(base,true);
            assertTrue(WorksheetDownload.url("https://123.207.232.151/family-learning/api/mobile/v1",false).getPath().endsWith("/worksheets/export"),"fixed endpoint");
            rejected(()->WorksheetDownload.url(base,false));rejected(()->WorksheetDownload.url("https://evil.invalid/family-learning/api/mobile/v1",true));rejected(()->WorksheetDownload.url("https://user:secret@123.207.232.151/family-learning/api/mobile/v1",false));rejected(()->WorksheetDownload.url("https://123.207.232.151/family-learning/api/mobile/v1?token=x",false));
            rejected(()->WorksheetDownload.validate("bad\nheader","{}"));rejected(()->WorksheetDownload.validate("synthetic-token","{"+"a".repeat(250000)));
            String actual=new WorksheetDownload.Job().download(url,"synthetic-token","{\"studentId\":\"synthetic\"}",target);
            assertTrue(actual.equals(expected)&&target.length()==data.length&&auth.get(),"authenticated streamed DOCX");WorksheetDownload.verify(target,data.length,expected);checks++;
            Files.write(target.toPath(),new byte[data.length]);rejected(()->WorksheetDownload.verify(target,data.length,expected));
            for(String failure:new String[]{"hash","mime","invalid","oversize","truncated","redirect","conflict"}){mode.set(failure);rejected(()->new WorksheetDownload.Job().download(url,"synthetic-token","{\"studentId\":\"synthetic\"}",target));assertTrue(!target.exists(),"failed temporary removed: "+failure);}
            assertTrue(redirects.get()==0,"never redirect credentials");
            WorksheetDownload.Job cancelled=new WorksheetDownload.Job();cancelled.cancel();int before=hits.get();rejected(()->cancelled.download(url,"synthetic-token","{}",target));assertTrue(hits.get()==before,"cancel before network");
            mode.set("hold");WorksheetDownload.Job running=new WorksheetDownload.Job();Future<?> future=executor.submit(()->{try{running.download(url,"synthetic-token","{}",target);throw new AssertionError("cancel expected");}catch(Exception expectedFailure){}});
            assertTrue(streaming.await(5,TimeUnit.SECONDS),"stream reached");running.cancel();release.countDown();future.get(5,TimeUnit.SECONDS);assertTrue(!target.exists(),"cancel removes incomplete file");
            assertTrue(WorksheetDownload.safeName("../unsafe/name").endsWith(".docx")&&!WorksheetDownload.safeName("../unsafe/name").contains("/"),"safe name");
            System.out.println("WorksheetDownloadTest passed: "+checks+" checks; synthetic loopback only");
        }finally{release.countDown();server.stop(0);executor.shutdownNow();Files.deleteIfExists(target.toPath());Files.deleteIfExists(root);}
    }
}
