package com.temo.aquaflow.driver;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

// Native HTTP/JSON driver API; deliberately has NO HTML/WebView or admin routes.
final class DriverApi {
    static final class ApiException extends Exception {
        final int status;
        ApiException(int code, String message) { super(message); status = code; }
    }
    private final String origin;
    private String cookie = "";
    private String token = "";
    DriverApi(String origin) {
        if (!origin.matches("https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?")) throw new IllegalArgumentException("A trusted HTTPS server address is required.");
        this.origin = origin;
    }
    void setToken(String value) { token = value == null ? "" : value; }
    String currentToken() { return token; }
    private static String consume(InputStream in) throws Exception {
        if (in == null) return "";
        try (InputStream stream = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192]; int n;
            while ((n = stream.read(buf)) >= 0) { if (n > 0) out.write(buf, 0, n); }
            return out.toString("UTF-8");
        }
    }
    private JSONObject send(String method, String route, String json, boolean unlock) throws Exception {
        if (!route.startsWith("/") || route.startsWith("//") || route.contains("..")) throw new IllegalArgumentException("Invalid driver route");
        URL url = new URL(origin + route);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(12000); conn.setReadTimeout(18000);
        conn.setRequestMethod(method);
        conn.setInstanceFollowRedirects(false);
        conn.setRequestProperty("Accept", "application/json");
        if (!cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
        if (!token.isEmpty() && !unlock) conn.setRequestProperty("Authorization", "Bearer " + token);
        try {
            if (json != null) {
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", unlock ? "application/x-www-form-urlencoded" : "application/json");
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(json.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = conn.getResponseCode();
            String responseCookie = conn.getHeaderField("Set-Cookie");
            if (responseCookie != null && !responseCookie.isEmpty() && !responseCookie.toLowerCase().contains("max-age=0"))
                cookie = responseCookie.split(";", 2)[0];
            String text = consume(status < 400 ? conn.getInputStream() : conn.getErrorStream());
            if (unlock) {
                if (status != 303 || cookie.isEmpty()) throw new ApiException(status, "Private Test access code invalid or expired.");
                return new JSONObject().put("success", true);
            }
            JSONObject result;
            try { result = new JSONObject(text); } catch (JSONException e) {
                if (status >= 300 && status < 400) throw new ApiException(status, "Server redirected the request. Please check the server address.");
                throw new ApiException(status, "Server returned an unexpected response.");
            }
            if (status < 200 || status >= 300) throw new ApiException(status, result.optString("message", "Request failed (" + status + ")"));
            return result;
        } finally { conn.disconnect(); }
    }
    void unlock(String code) throws Exception {
        if (code == null || code.trim().isEmpty()) return;
        send("POST", "/__staging/unlock", "code=" + URLEncoder.encode(code.trim(), "UTF-8"), true);
    }
    JSONObject login(String username, String password) throws Exception {
        JSONObject input = new JSONObject().put("username", username).put("password", password);
        JSONObject response = send("POST", "/api/login", input.toString(), false);
        JSONObject user = response.optJSONObject("user");
        String role = user == null ? "" : user.optString("role");
        if (!"driver".equals(role) && !"delivery_driver".equals(role))
            throw new ApiException(403, "Only Driver accounts can open this app. Admins must use the separate ERP Admin system.");
        if (response.optString("token").isEmpty()) throw new ApiException(401, "Missing driver session.");
        token = response.optString("token");
        return user;
    }
    JSONArray deliveries(String date, boolean history) throws Exception {
        JSONObject response = getWrappedArray("/api/driver/deliveries?date=" + date + (history ? "&history=true" : ""));
        return response.getJSONArray("items");
    }
    private JSONObject getWrappedArray(String route) throws Exception {
        // Driver deliveries endpoint returns a JSON array rather than a JSON object.
        URL url = new URL(origin + route);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(12000); conn.setReadTimeout(18000);
        conn.setRequestProperty("Accept", "application/json");
        if (!cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
        if (!token.isEmpty()) conn.setRequestProperty("Authorization", "Bearer " + token);
        try {
            int status = conn.getResponseCode();
            String payload = consume(status < 400 ? conn.getInputStream() : conn.getErrorStream());
            if (status != 200) {
                try { throw new ApiException(status, new JSONObject(payload).optString("message", "Unable to load deliveries")); }
                catch (JSONException e) { throw new ApiException(status, "Unable to load deliveries (" + status + ")"); }
            }
            return new JSONObject().put("items", new JSONArray(payload));
        } finally { conn.disconnect(); }
    }
    JSONArray list(String route) throws Exception { return getWrappedArray(route).getJSONArray("items"); }
    JSONObject post(String route, JSONObject payload) throws Exception { return send("POST", route, payload.toString(), false); }
    JSONObject upload(int deliveryId, String kind, String encoded) throws Exception {
        return post("/api/driver/deliveries/" + deliveryId + "/proof-upload",
                new JSONObject().put("kind", kind).put("imageBase64", encoded)).getJSONObject("proof");
    }
}
