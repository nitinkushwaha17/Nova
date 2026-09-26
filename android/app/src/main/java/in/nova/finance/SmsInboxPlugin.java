package in.nova.finance;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Telephony;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Reads bank alert SMS from the inbox, on device only. Nothing is sent anywhere by this plugin;
 * the web layer parses the messages locally.
 */
@CapacitorPlugin(
    name = "SmsInbox",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS }) }
)
public class SmsInboxPlugin extends Plugin {

    private BroadcastReceiver receiver;

    @PluginMethod
    public void read(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "readAfterPermission");
            return;
        }
        doRead(call);
    }

    @PermissionCallback
    private void readAfterPermission(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) doRead(call);
        else call.reject("SMS permission denied", "DENIED");
    }

    private void doRead(PluginCall call) {
        long since = call.getLong("since", 0L);
        int limit = call.getInt("limit", 2000);
        JSArray out = new JSArray();
        Uri uri = Telephony.Sms.Inbox.CONTENT_URI;
        String[] projection = { Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE };
        try (
            Cursor c = getContext()
                .getContentResolver()
                .query(uri, projection, Telephony.Sms.DATE + " > ?", new String[] { String.valueOf(since) }, Telephony.Sms.DATE + " DESC")
        ) {
            if (c != null) {
                while (c.moveToNext() && out.length() < limit) {
                    String address = c.getString(1);
                    // Bank alerts come from alphanumeric sender IDs (e.g. VM-SBIUPI); skip personal numbers early
                    if (address == null || address.replaceAll("[\\s+-]", "").matches("\\d{8,}")) continue;
                    JSObject m = new JSObject();
                    m.put("id", c.getString(0));
                    m.put("address", address);
                    m.put("body", c.getString(2));
                    m.put("date", c.getLong(3));
                    out.put(m);
                }
            }
        } catch (Exception e) {
            call.reject("Could not read SMS: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("messages", out);
        call.resolve(ret);
    }

    /** While the app is open, tell the web layer when a new SMS arrives so it can rescan */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (receiver != null || getPermissionState("sms") != PermissionState.GRANTED) return;
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                getBridge().executeOnMainThread(() -> notifyListeners("smsReceived", new JSObject()));
            }
        };
        IntentFilter filter = new IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION);
        if (Build.VERSION.SDK_INT >= 33) getContext().registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED);
        else getContext().registerReceiver(receiver, filter);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (Exception ignored) {}
            receiver = null;
        }
    }
}
