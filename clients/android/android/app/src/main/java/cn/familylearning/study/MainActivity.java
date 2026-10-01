package cn.familylearning.study;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SessionVaultPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        registerPlugin(AppSettingsPlugin.class);
        registerPlugin(PhotoProcessingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
