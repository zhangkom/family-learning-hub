package cn.familylearning.study;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipFile;

/** Bounded authenticated DOCX transport. Credentials never enter a URL or external activity. */
final class WorksheetDownload {
    static final String MIME="application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    static final long MAX_BYTES=64L*1024*1024;
    static URL url(String base,boolean debug) throws Exception {
        URI uri=new URI(base);
        boolean production="https".equals(uri.getScheme())&&"123.207.232.151".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443);
        boolean loopback=debug&&"http".equals(uri.getScheme())&&("127.0.0.1".equals(uri.getHost())||"localhost".equals(uri.getHost()));
        if((!production&&!loopback)||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||!"/family-learning/api/mobile/v1".equals(uri.getRawPath()))
            throw new IllegalArgumentException("导出地址不属于本项目");
        return new URL(base+"/worksheets/export");
    }
    static String safeName(String name) {
        String value=name==null?"":name.replaceAll("[\\p{Cntrl}/\\\\:*?\"<>|]","_").trim();
        if(value.isEmpty())value="错题练习卷.docx";
        if(!value.toLowerCase(Locale.ROOT).endsWith(".docx"))value+=".docx";
        return value.length()>180?value.substring(0,175)+".docx":value;
    }
    static void validate(String token,String body) {
        if(token==null||token.isEmpty()||token.length()>16384||token.chars().anyMatch(c->c<=32||c>=127))throw new IllegalArgumentException("请重新登录后导出");
        if(body==null||body.getBytes(StandardCharsets.UTF_8).length>250000||!body.startsWith("{"))throw new IllegalArgumentException("导出选择无效");
    }
    static String sha256(File file) throws Exception {
        MessageDigest md=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)md.update(buffer,0,n);}
        return hex(md.digest());
    }
    static void verify(File file,long bytes,String sha) throws Exception {
        if(bytes<1||bytes>MAX_BYTES||file.length()!=bytes||sha==null||!sha.matches("[a-f0-9]{64}")||!sha256(file).equals(sha))throw new IOException("DOCX integrity mismatch");
        try(ZipFile zip=new ZipFile(file)) {
            if(zip.getEntry("[Content_Types].xml")==null||zip.getEntry("word/document.xml")==null)throw new IOException("invalid DOCX package");
        }
    }
    static final class DownloadFailure extends IOException {
        final int status;
        DownloadFailure(int status){super(status==401?"登录已失效，请重新登录":status==409?"题目已变化或打印排版未就绪，请重新检查":status==429?"导出较频繁，请稍后重试":"Word 生成未完成，请重试");this.status=status;}
    }
    static final class Job {
        final AtomicBoolean cancelled=new AtomicBoolean();
        volatile HttpURLConnection connection;
        void cancel(){cancelled.set(true);HttpURLConnection current=connection;if(current!=null)current.disconnect();}
        void check() throws InterruptedIOException {if(cancelled.get())throw new InterruptedIOException("cancelled");}
        String download(URL url,String token,String body,File file) throws Exception {
            validate(token,body);boolean success=false;
            try {
                check();HttpURLConnection c=(HttpURLConnection)url.openConnection();connection=c;
                c.setInstanceFollowRedirects(false);c.setConnectTimeout(20000);c.setReadTimeout(60000);c.setUseCaches(false);
                c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Authorization","Bearer "+token);c.setRequestProperty("Content-Type","application/json");c.setRequestProperty("Accept-Encoding","identity");
                byte[] request=body.getBytes(StandardCharsets.UTF_8);c.setFixedLengthStreamingMode(request.length);
                try(OutputStream out=c.getOutputStream()){check();out.write(request);}check();
                int status=c.getResponseCode();if(status!=200)throw new DownloadFailure(status);
                if(c.getContentType()==null||!MIME.equals(c.getContentType().split(";",2)[0].trim().toLowerCase(Locale.ROOT)))throw new IOException("unexpected DOCX MIME");
                long expected=c.getContentLengthLong();if(expected>MAX_BYTES||expected==0)throw new IOException("DOCX too large or empty");
                String expectedSha=c.getHeaderField("X-Content-SHA256");if(expectedSha!=null&&!expectedSha.matches("[a-f0-9]{64}"))throw new IOException("invalid checksum header");
                MessageDigest digest=MessageDigest.getInstance("SHA-256");long count=0,deadline=System.nanoTime()+120000000000L;
                try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(file)) {
                    byte[] buffer=new byte[65536];int n;
                    while((n=in.read(buffer))!=-1){check();count+=n;if(count>MAX_BYTES||System.nanoTime()>deadline)throw new IOException("DOCX download limit exceeded");digest.update(buffer,0,n);out.write(buffer,0,n);}
                    check();if(count<1||expected>=0&&count!=expected)throw new IOException("DOCX size mismatch");out.getFD().sync();
                }
                String sha=hex(digest.digest());if(expectedSha!=null&&!sha.equals(expectedSha))throw new IOException("DOCX checksum mismatch");
                verify(file,count,sha);success=true;return sha;
            } finally {HttpURLConnection c=connection;connection=null;if(c!=null)c.disconnect();if(!success&&file.exists()&&!file.delete())file.deleteOnExit();}
        }
    }
    private static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
}
