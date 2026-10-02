package cn.familylearning.study;

import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

/** Bounded streaming transport. No token in a URI, manifest, log or redirect. */
final class CloudOriginalDownload {
    static final long MAX_BYTES=32L*1024*1024;
    static URL url(String base,String path,boolean debug) throws Exception {
        URI uri=new URI(base);
        boolean production="https".equals(uri.getScheme())&&"123.207.232.151".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443);
        boolean loopback=debug&&"http".equals(uri.getScheme())&&("127.0.0.1".equals(uri.getHost())||"localhost".equals(uri.getHost()));
        if((!production&&!loopback)||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||
            !"/family-learning/api/mobile/v1".equals(uri.getRawPath())||
            path==null||!path.matches("/cloud-photos/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/file"))
            throw new IllegalArgumentException("云盘下载地址不属于本项目");
        return new URL(base+path);
    }
    static void validate(long bytes,String sha,String mime,String token) {
        if(bytes<1||bytes>MAX_BYTES||sha==null||!sha.matches("[0-9a-f]{64}")||
            !("image/jpeg".equals(mime)||"image/png".equals(mime)||"image/webp".equals(mime)))throw new IllegalArgumentException("云盘原图信息无效");
        if(token==null||token.isEmpty()||token.length()>16384||token.chars().anyMatch(c->c<=32||c>=127))throw new IllegalArgumentException("请重新登录后下载");
    }
    static String safeName(String name,String mime) {
        String extension="image/png".equals(mime)?".png":"image/webp".equals(mime)?".webp":".jpg";
        String clean=name==null?"":name.replaceAll("[\\p{Cntrl}/\\\\:*?\"<>|]","_").trim();
        if(clean.isEmpty()||clean.equals(".")||clean.equals(".."))return "原图"+extension;
        return clean.length()>120?clean.substring(0,100)+extension:clean;
    }
    static final class Job {
        final AtomicBoolean cancelled=new AtomicBoolean();
        volatile HttpURLConnection connection;
        void cancel(){cancelled.set(true);HttpURLConnection current=connection;if(current!=null)current.disconnect();}
        void check() throws InterruptedIOException {if(cancelled.get())throw new InterruptedIOException("cancelled");}
        void download(URL url,String token,long bytes,String sha,String mime,File destination) throws Exception {
            validate(bytes,sha,mime,token);boolean success=false;
            try {
                check();HttpURLConnection c=(HttpURLConnection)url.openConnection();connection=c;
                c.setInstanceFollowRedirects(false);c.setConnectTimeout(20000);c.setReadTimeout(30000);
                c.setUseCaches(false);c.setRequestProperty("Authorization","Bearer "+token);
                c.setRequestProperty("Accept-Encoding","identity");check();
                if(c.getResponseCode()!=200)throw new IOException("download HTTP response rejected");
                if(c.getContentLengthLong()!=-1&&c.getContentLengthLong()!=bytes)throw new IOException("download size mismatch");
                String contentType=c.getContentType();
                if(contentType==null||!mime.equals(contentType.split(";",2)[0].trim().toLowerCase(Locale.ROOT)))throw new IOException("download MIME mismatch");
                MessageDigest digest=MessageDigest.getInstance("SHA-256");long count=0;
                try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(destination)) {
                    byte[] buffer=new byte[65536];int n;
                    while((n=in.read(buffer))!=-1) {check();count+=n;if(count>bytes)throw new IOException("download exceeds expected size");digest.update(buffer,0,n);out.write(buffer,0,n);}
                    check();if(count!=bytes||!hex(digest.digest()).equals(sha))throw new IOException("download integrity mismatch");out.getFD().sync();
                }
                success=true;
            } finally {HttpURLConnection c=connection;connection=null;if(c!=null)c.disconnect();if(!success&&destination.exists()&&!destination.delete())destination.deleteOnExit();}
        }
    }
    static void verify(File file,long bytes,String sha) throws Exception {
        if(bytes<1||bytes>MAX_BYTES||file.length()!=bytes)throw new IOException("saved file size mismatch");
        MessageDigest md=MessageDigest.getInstance("SHA-256");
        try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[65536];int n;while((n=in.read(buffer))!=-1)md.update(buffer,0,n);}
        if(!hex(md.digest()).equals(sha))throw new IOException("saved file hash mismatch");
    }
    private static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
}
