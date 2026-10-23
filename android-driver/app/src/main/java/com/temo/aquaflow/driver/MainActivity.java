package com.temo.aquaflow.driver;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String PREFS = "temo_driver_settings";
    private static final String ERP_URL = "erp_url";
    private static final int LOCATION_REQUEST = 210;
    private static final int FILE_REQUEST = 211;
    private String siteOrigin;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;

    private int dp(int value) { return (int) (getResources().getDisplayMetrics().density * value + 0.5f); }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String saved = getPreferences(MODE_PRIVATE).getString(ERP_URL, "");
        if (saved.isEmpty()) showSetup(""); else openPortal(saved);
    }

    private void showSetup(String suggested) {
        if (web != null) { web.destroy(); web = null; }
        siteOrigin = null;
        LinearLayout page = new LinearLayout(this);
        page.setOrientation(LinearLayout.VERTICAL);
        page.setPadding(dp(20), dp(36), dp(20), dp(24));

        TextView header = new TextView(this);
        header.setText("TEMO DRIVER");
        header.setTextSize(26);
        header.setTextColor(0xff0a3a5c);
        page.addView(header);

        TextView info = new TextView(this);
        info.setText("Enter your company's private HTTPS ERP address. Sign in using your driver account. This app needs the ERP server to be online for new delivery assignments.");
        info.setTextSize(16);
        info.setPadding(0, dp(18), 0, dp(18));
        page.addView(info);

        EditText entry = new EditText(this);
        entry.setSingleLine(true);
        entry.setHint("https://erp.your-company.com");
        entry.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        entry.setText(suggested);
        page.addView(entry);

        Button connect = new Button(this);
        connect.setText("Connect");
        connect.setOnClickListener(view -> {
            String value = entry.getText().toString().trim();
            Uri uri;
            try { uri = Uri.parse(value); } catch (Exception e) { error("Enter a valid HTTPS address"); return; }
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null ||
                uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null ||
                (uri.getPath() != null && !uri.getPath().isEmpty() && !"/".equals(uri.getPath()))) {
                error("Use only an HTTPS server address, for example https://erp.example.com");
                return;
            }
            String normalized = uri.buildUpon().path("").build().toString().replaceAll("/+$", "");
            getPreferences(MODE_PRIVATE).edit().putString(ERP_URL, normalized).apply();
            openPortal(normalized);
        });
        page.addView(connect);
        setContentView(page);
    }

    private void error(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }

    private boolean sameOrigin(Uri uri) {
        if (uri == null || siteOrigin == null) return false;
        Uri allowed = Uri.parse(siteOrigin);
        return "https".equalsIgnoreCase(uri.getScheme()) &&
            allowed.getHost().equalsIgnoreCase(uri.getHost()) &&
            (uri.getPort() == allowed.getPort());
    }

    // Protected Cloudflare test tunnels authenticate through this one trusted
    // broker. Keep that redirect inside this WebView so login cookies stay here.
    private boolean trustedCloudflareLogin(Uri uri) {
        if (uri == null || siteOrigin == null ||
            !"https".equalsIgnoreCase(uri.getScheme())) return false;
        String configuredHost = Uri.parse(siteOrigin).getHost();
        return configuredHost != null &&
            configuredHost.toLowerCase(java.util.Locale.ROOT).endsWith(".trycloudflare.com") &&
            "login.trycloudflare.com".equalsIgnoreCase(uri.getHost());
    }

    private void openPortal(String url) {
        siteOrigin = url;
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true);
        String qaHost = Uri.parse(url).getHost();
        if (qaHost != null && qaHost.toLowerCase(java.util.Locale.ROOT).endsWith(".trycloudflare.com")) {
            // Required for email PIN login redirects during temporary QA.
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        }
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (sameOrigin(uri) || trustedCloudflareLogin(uri)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception e) { error("No app available for this link"); }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                // The mobile shell does not grant camera/microphone streaming permissions.
                request.deny();
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent chooser = new Intent(Intent.ACTION_GET_CONTENT);
                chooser.setType("image/*");
                chooser.addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(Intent.createChooser(chooser, "Select delivery proof photo"), FILE_REQUEST); return true; }
                catch (Exception e) { fileCallback = null; callback.onReceiveValue(null); return false; }
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!sameOrigin(Uri.parse(origin))) { callback.invoke(origin, false, false); return; }
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    locationOrigin = origin;
                    locationCallback = callback;
                    requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION }, LOCATION_REQUEST);
                }
            }
        });
        setContentView(web, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.loadUrl(url + "/index.html");
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == LOCATION_REQUEST && locationCallback != null) {
            boolean approved = grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED;
            locationCallback.invoke(locationOrigin, approved, false);
            locationCallback = null;
            locationOrigin = null;
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_REQUEST && fileCallback != null) {
            Uri chosen = resultCode == RESULT_OK && data != null ? data.getData() : null;
            fileCallback.onReceiveValue(chosen != null ? new Uri[] { chosen } : null);
            fileCallback = null;
        }
    }

    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else showSetup(getPreferences(MODE_PRIVATE).getString(ERP_URL, ""));
    }

    @Override protected void onDestroy() {
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
