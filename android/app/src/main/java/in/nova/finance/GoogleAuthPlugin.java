package in.nova.finance;

import android.app.Activity;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import java.util.ArrayList;
import java.util.List;

/**
 * Google OAuth access tokens via Google Play services' AuthorizationClient.
 * Google blocks its web sign-in inside WebViews, so the app asks Play services instead.
 * Needs an Android OAuth client (package + signing SHA-1) in the same Cloud project as the web client.
 */
@CapacitorPlugin(name = "GoogleAuth")
public class GoogleAuthPlugin extends Plugin {

    private ActivityResultLauncher<IntentSenderRequest> consentLauncher;
    private PluginCall pendingCall;

    @Override
    public void load() {
        consentLauncher = getActivity().registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), result -> {
            PluginCall call = pendingCall;
            pendingCall = null;
            if (call == null) return;
            if (result.getResultCode() != Activity.RESULT_OK) {
                call.reject("Sign-in was cancelled", "CANCELLED");
                return;
            }
            try {
                resolveToken(call, Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(result.getData()));
            } catch (ApiException e) {
                call.reject(e.getMessage(), "FAILED", e);
            }
        });
    }

    /** { scopes: string[], interactive?: boolean } → { accessToken, scopes } */
    @PluginMethod
    public void authorize(PluginCall call) {
        JSArray arr = call.getArray("scopes", new JSArray());
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", true));
        List<Scope> scopes = new ArrayList<>();
        try {
            for (Object s : arr.toList()) scopes.add(new Scope(String.valueOf(s)));
        } catch (Exception e) {
            call.reject("Invalid scopes", "FAILED");
            return;
        }
        if (scopes.isEmpty()) {
            call.reject("No scopes requested", "FAILED");
            return;
        }
        AuthorizationRequest req = AuthorizationRequest.builder().setRequestedScopes(scopes).build();
        Identity.getAuthorizationClient(getActivity())
            .authorize(req)
            .addOnSuccessListener(r -> {
                if (!r.hasResolution()) {
                    resolveToken(call, r);
                } else if (!interactive || r.getPendingIntent() == null) {
                    call.reject("Google sign-in required", "NEEDS_AUTH");
                } else if (pendingCall != null) {
                    call.reject("Sign-in already in progress", "BUSY");
                } else {
                    pendingCall = call;
                    consentLauncher.launch(new IntentSenderRequest.Builder(r.getPendingIntent().getIntentSender()).build());
                }
            })
            .addOnFailureListener(e -> call.reject(e.getMessage(), "FAILED", e));
    }

    /** Drop a cached token (expired or revoked) so the next authorize returns a fresh one */
    @PluginMethod
    public void clearToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isEmpty()) {
            call.resolve();
            return;
        }
        new Thread(() -> {
            try {
                GoogleAuthUtil.clearToken(getContext(), token);
            } catch (Exception ignored) {
                // Nothing cached for this token
            }
            call.resolve();
        }).start();
    }

    private void resolveToken(PluginCall call, AuthorizationResult r) {
        if (r.getAccessToken() == null) {
            call.reject("Google did not return an access token", "FAILED");
            return;
        }
        JSObject out = new JSObject();
        out.put("accessToken", r.getAccessToken());
        out.put("scopes", new JSArray(r.getGrantedScopes()));
        call.resolve(out);
    }
}
