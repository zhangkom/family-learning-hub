package cn.familylearning.study;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Keeps the revocable family session encrypted with a device-bound Keystore key. */
@CapacitorPlugin(name = "SessionVault")
public class SessionVaultPlugin extends Plugin {
    private static final String ALIAS = "family-learning-session-v1";
    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("family-session", Context.MODE_PRIVATE);
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }
    @PluginMethod
    public void set(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.length() > 8192) { call.reject("登录状态无效"); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            String iv = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP);
            String ciphertext = Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
            if (!preferences().edit().putString("encrypted", iv + "." + ciphertext).commit()) throw new Exception();
            call.resolve();
        } catch (Exception ignored) { call.reject("无法安全保存登录状态，请重试"); }
    }
    @PluginMethod
    public void get(PluginCall call) {
        String encoded = preferences().getString("encrypted", "");
        JSObject result = new JSObject();
        if (encoded.isEmpty()) { result.put("value", ""); call.resolve(result); return; }
        try {
            String[] pieces = encoded.split("\\.", 2);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(pieces[0], Base64.NO_WRAP)));
            String value = new String(cipher.doFinal(Base64.decode(pieces[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
            result.put("value", value);
            call.resolve(result);
        } catch (Exception ignored) {
            preferences().edit().clear().apply();
            call.reject("登录状态已失效，请重新登录");
        }
    }
    @PluginMethod
    public void clear(PluginCall call) {
        if (preferences().edit().clear().commit()) call.resolve();
        else call.reject("无法清除登录状态，请重试");
    }
}
