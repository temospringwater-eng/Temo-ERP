package com.temo.aquaflow.driver;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;

// Kept entirely in app-private storage; each driver/server has a separate queue.
final class DriverCache {
    private final SharedPreferences prefs;
    DriverCache(Context context, String origin, long driverId) {
        prefs = context.getSharedPreferences("driver_cache_" + Integer.toHexString((origin + ":" + driverId).hashCode()), Context.MODE_PRIVATE);
    }
    synchronized JSONArray cached(boolean history) {
        try { return new JSONArray(prefs.getString(history ? "history" : "today", "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }
    synchronized void cache(boolean history, JSONArray deliveries) {
        prefs.edit().putString(history ? "history" : "today", deliveries.toString()).apply();
    }
    synchronized JSONArray queue() {
        try { return new JSONArray(prefs.getString("pending", "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }
    synchronized int queuedCount() { return queue().length(); }
    synchronized void enqueue(long deliveryId, String action, String updatedAt, JSONObject payload) throws Exception {
        JSONObject item = new JSONObject()
            .put("idempotencyKey", UUID.randomUUID().toString())
            .put("operationType", action)
            .put("deliveryId", deliveryId)
            .put("baseUpdatedAt", updatedAt)
            .put("payload", payload)
            .put("clientTimestamp", new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", java.util.Locale.US).format(new java.util.Date()))
            .put("_state", "pending");
        JSONArray old = queue();
        old.put(item);
        if (!prefs.edit().putString("pending", old.toString()).commit()) {
            throw new IllegalStateException("Could not save offline update to this device.");
        }
    }
    synchronized JSONArray sendable() throws Exception {
        JSONArray answer = new JSONArray();
        JSONArray all = queue();
        for (int i = 0; i < all.length() && answer.length() < 100; i++) {
            JSONObject op = all.optJSONObject(i);
            if (op != null && "pending".equals(op.optString("_state"))) {
                JSONObject copy = new JSONObject(op.toString());
                copy.remove("_state");
                copy.remove("_message");
                answer.put(copy);
            }
        }
        return answer;
    }
    synchronized int applyResults(JSONArray results) throws Exception {
        JSONArray old = queue();
        JSONArray keep = new JSONArray();
        int done = 0;
        for (int i = 0; i < old.length(); i++) {
            JSONObject operation = old.getJSONObject(i);
            JSONObject match = null;
            for (int j = 0; j < results.length(); j++) {
                JSONObject item = results.optJSONObject(j);
                if (item != null && item.optString("idempotencyKey").equals(operation.optString("idempotencyKey"))) { match = item; break; }
            }
            if (match == null) { keep.put(operation); continue; }
            String state = match.optString("status");
            if ("applied".equals(state)) { done++; continue; }
            if ("failed".equals(state) || "conflict".equals(state)) {
                operation.put("_state", state);
                operation.put("_message", match.optString("message", "Review required"));
            }
            keep.put(operation);
        }
        // Confirm durable queue removal before telling the driver that any
        // operations have synced. A failed local write must not masquerade as
        // a completed sync or erase unresolved conflicts.
        if (!prefs.edit().putString("pending", keep.toString()).commit()) {
            throw new IllegalStateException("Synced updates could not be confirmed on this device.");
        }
        return done;
    }
    synchronized void clear() { prefs.edit().clear().apply(); }
}
