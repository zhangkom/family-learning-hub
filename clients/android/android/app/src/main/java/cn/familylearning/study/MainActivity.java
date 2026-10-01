package cn.familylearning.study;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SessionVaultPlugin.class);
        registerPlugin(AppUpdaterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
