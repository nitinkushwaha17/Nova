package in.nova.finance;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsInboxPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
