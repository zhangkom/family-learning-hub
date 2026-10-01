package cn.familylearning.study;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

/** Explicit, user-requested updates for this app only. Never accesses family credentials. */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private volatile HttpsURLConnection connection;
    private String verifiedHash;
    private int verifiedCode;
    private String verifiedVersion;
    private long verifiedBytes;

    private File apkFile() { return new File(getContext().getCacheDir(), "app-updates/update.apk"); }

    @PluginMethod
    public void download(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("更新正在进行，请稍候"); return; }
        executor.execute(() -> {
            File part = new File(apkFile().getParentFile(), "update.part");
            File patch = new File(apkFile().getParentFile(), "update.delta");
            verifiedHash = null;
            try {
                String address = call.getString("downloadUrl", "");
                String sha256 = call.getString("sha256", "");
                String version = call.getString("version", "");
                Integer code = call.getInt("versionCode", 0);
                long bytes = call.getInt("bytes", 0).longValue();
                URL url = new URL(address);
                if (!url.getProtocol().equals("https") || !url.getHost().equals("123.207.232.151") ||
                    (url.getPort() != -1 && url.getPort() != 443) || url.getUserInfo() != null ||
                    url.getQuery() != null || url.getRef() != null ||
                    !url.getPath().matches("/family-learning/downloads/android/family-learning-[0-9]+\\.[0-9]+\\.[0-9]+-release-[a-f0-9]{7,40}\\.apk") ||
                    !sha256.matches("[a-fA-F0-9]{64}") || !version.matches("[0-9]+\\.[0-9]+\\.[0-9]+") ||
                    code < 1 || bytes < 1 || bytes > 256L * 1024 * 1024)
                    throw new Exception("更新信息无效，请重新检查更新");
                PackageInfo installed = installedPackage();
                if (code <= versionCode(installed)) throw new Exception("当前版本无需升级");
                File directory = apkFile().getParentFile();
                if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("无法创建更新文件，请检查剩余空间");
                if (directory.getUsableSpace() < bytes * 2 + 16L * 1024 * 1024) throw new Exception("剩余空间不足，请清理后重试");
                boolean usedDelta = false, fallback = false;
                JSONArray deltas = call.getArray("deltas");
                JSONObject delta = findDelta(deltas, installed, code, bytes);
                if (delta != null) {
                    try {
                        File base = new File(getContext().getApplicationInfo().sourceDir);
                        if (base.length() != delta.getLong("baseBytes") ||
                            !DeltaApplier.sha256(base).equalsIgnoreCase(delta.getString("baseSha256")))
                            throw new Exception("base mismatch");
                        transfer(new URL(delta.getString("downloadUrl")), patch, delta.getLong("bytes"), delta.getString("sha256"), "delta");
                        progress(100, "prepare");
                        DeltaApplier.apply(base, patch, part, delta.getLong("baseBytes"), delta.getString("baseSha256"), bytes, sha256);
                        verifyPackage(part, installed, code, version);
                        usedDelta = true;
                    } catch (Exception ignored) {
                        if (Thread.currentThread().isInterrupted()) throw new Exception("更新已中断，请重试");
                        fallback = true;
                        progress(0, "fallback");
                    } finally { if (patch.exists()) patch.delete(); }
                }
                if (!usedDelta) transfer(url, part, bytes, sha256, "full");
                progress(100, "verify");
                verifyPackage(part, installed, code, version);
                if (apkFile().exists() && !apkFile().delete()) throw new Exception("无法替换旧更新文件，请重试");
                if (!part.renameTo(apkFile())) throw new Exception("无法保存更新文件，请重试");
                verifiedHash = sha256; verifiedBytes = bytes; verifiedCode = code; verifiedVersion = version;
                JSObject result = new JSObject(); result.put("mode", usedDelta ? "delta" : "full"); result.put("fallback", fallback);
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e instanceof java.io.IOException ? "下载失败，请检查网络和剩余空间后重试" : safeMessage(e));
            } finally {
                if (part.exists()) part.delete();
                if (patch.exists()) patch.delete();
                busy.set(false);
            }
        });
    }

    private JSONObject findDelta(JSONArray deltas, PackageInfo installed, int code, long bytes) {
        if (deltas == null || deltas.length() > 4 || versionCode(installed) < 7 ||
            (getContext().getApplicationInfo().splitSourceDirs != null && getContext().getApplicationInfo().splitSourceDirs.length > 0)) return null;
        for (int i = 0; i < deltas.length(); i++) {
            try {
                JSONObject delta = deltas.getJSONObject(i);
                long from = delta.getLong("fromVersionCode"), size = delta.getLong("bytes"), baseBytes = delta.getLong("baseBytes");
                String hash = delta.getString("sha256");
                URL url = new URL(delta.getString("downloadUrl"));
                if (!delta.getString("format").equals("zai-copy-v1") || from != versionCode(installed) ||
                    from >= code || size < 1 || size > bytes * 0.8 || bytes - size < 65536 ||
                    baseBytes < 1 || baseBytes > DeltaApplier.MAX_BYTES || !hash.matches("[a-fA-F0-9]{64}") ||
                    !delta.getString("baseSha256").matches("[a-fA-F0-9]{64}") ||
                    !url.getProtocol().equals("https") || !url.getHost().equals("123.207.232.151") ||
                    (url.getPort() != -1 && url.getPort() != 443) || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null ||
                    !url.getPath().equals("/family-learning/downloads/android/family-learning-" + from + "-to-" + code + "-" + hash.substring(0, 16).toLowerCase(java.util.Locale.ROOT) + ".zaidelta.gz")) continue;
                return delta;
            } catch (Exception ignored) { /* Optional metadata must not block a verified full update. */ }
        }
        return null;
    }

    private void progress(int percent, String phase) {
        JSObject progress = new JSObject(); progress.put("percent", percent); progress.put("phase", phase);
        notifyListeners("downloadProgress", progress);
    }

    private void transfer(URL url, File part, long bytes, String sha256, String phase) throws Exception {
        try {
                connection = (HttpsURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(20000);
                connection.setUseCaches(false);
                connection.setRequestProperty("Accept-Encoding", "identity");
                if (connection.getResponseCode() != 200) throw new Exception("下载暂不可用，请稍后重试");
                long length = connection.getContentLengthLong();
                if (length != -1 && length != bytes) throw new Exception("安装包大小不符，请重新检查更新");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long total = 0, deadline = SystemClock.elapsedRealtime() + 180000;
                int lastPercent = -1;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(part)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (Thread.currentThread().isInterrupted() || SystemClock.elapsedRealtime() > deadline)
                            throw new Exception("下载超时，请重试");
                        total += count;
                        if (total > bytes) throw new Exception("安装包大小不符，请重新检查更新");
                        output.write(buffer, 0, count);
                        digest.update(buffer, 0, count);
                        int percent = (int) (total * 100 / bytes);
                        if (percent != lastPercent) {
                            progress(percent, phase);
                            lastPercent = percent;
                        }
                    }
                    output.getFD().sync();
                }
                if (total != bytes || !hex(digest.digest()).equalsIgnoreCase(sha256))
                    throw new Exception("安装包校验未通过，请重新下载");
        } finally {
                if (connection != null) { connection.disconnect(); connection = null; }
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.reject("更新正在进行，请稍候"); return; }
        executor.execute(() -> {
            try {
                File file = apkFile();
                if (verifiedHash == null || !file.isFile() || file.length() != verifiedBytes)
                    throw new Exception("更新文件已失效，请重新下载");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream input = new FileInputStream(file)) {
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
                }
                if (!hex(digest.digest()).equalsIgnoreCase(verifiedHash)) throw new Exception("安装包校验未通过，请重新下载");
                verifyPackage(file, installedPackage(), verifiedCode, verifiedVersion);
                boolean needsPermission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                    !getContext().getPackageManager().canRequestPackageInstalls();
                if (needsPermission) {
                    JSObject result = new JSObject(); result.put("permissionRequired", true); call.resolve(result);
                } else {
                    Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                    Intent intent = new Intent(Intent.ACTION_VIEW);
                    intent.setDataAndType(uri, "application/vnd.android.package-archive");
                    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    getActivity().runOnUiThread(() -> {
                        try {
                            getActivity().startActivity(intent);
                            JSObject result = new JSObject(); result.put("permissionRequired", false); call.resolve(result);
                        } catch (Exception ignored) { call.reject("系统未能打开安装页面，请稍后重试"); }
                    });
                }
            } catch (Exception e) { verifiedHash = null; call.reject(safeMessage(e)); }
            finally { busy.set(false); }
        });
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()))
                    : new Intent(Settings.ACTION_SECURITY_SETTINGS);
                getActivity().startActivity(intent);
                call.resolve();
            } catch (Exception ignored) { call.reject("无法打开系统安装设置"); }
        });
    }

    @SuppressWarnings("deprecation")
    private int signatureFlags() { return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES; }
    private PackageInfo installedPackage() throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), signatureFlags());
    }
    @SuppressWarnings("deprecation")
    private long versionCode(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    @SuppressWarnings("deprecation")
    private String[] signers(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 && info.signingInfo != null
            ? info.signingInfo.getApkContentsSigners() : info.signatures;
        if (signatures == null || signatures.length == 0) throw new Exception("安装包签名无效");
        String[] fingerprints = new String[signatures.length];
        for (int i = 0; i < signatures.length; i++) fingerprints[i] = hex(MessageDigest.getInstance("SHA-256").digest(signatures[i].toByteArray()));
        Arrays.sort(fingerprints);
        return fingerprints;
    }
    private void verifyPackage(File file, PackageInfo installed, int code, String version) throws Exception {
        PackageInfo candidate = getContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), signatureFlags());
        if (candidate == null || !getContext().getPackageName().equals(candidate.packageName) ||
            versionCode(candidate) != code || !version.equals(candidate.versionName) || code <= versionCode(installed) ||
            !Arrays.equals(signers(candidate), signers(installed)))
            throw new Exception("安装包与当前应用不匹配，已停止安装");
    }
    private String hex(byte[] data) {
        StringBuilder result = new StringBuilder();
        for (byte value : data) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }
    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message != null && message.matches("[\u4e00-\u9fff“一起学”，、。]+") ? message : "更新未完成，请重新下载后重试";
    }
    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        if (connection != null) connection.disconnect();
        super.handleOnDestroy();
    }
}
