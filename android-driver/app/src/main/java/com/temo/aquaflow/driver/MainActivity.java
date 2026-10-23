package com.temo.aquaflow.driver;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.net.Uri;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.Toast;
import android.graphics.BitmapFactory;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

// This is a fully native Activity: no WebView, no /index.html, no admin navigation.
public final class MainActivity extends Activity {
    private static final int BLUE = Color.rgb(12, 65, 95);
    private static final int LIGHT = Color.rgb(238, 246, 249);
    private static final int MUTED = Color.rgb(90, 109, 118);
    private static final int PICK_PHOTO = 208;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private DriverApi api;
    private DriverCache cache;
    private JSONObject driver;
    private JSONObject selected;
    private JSONArray bottleTypes = new JSONArray();
    private String serverUrl = "";
    private String userName = "";
    private boolean history = false;
    private int challengeId = 0;
    private String qaOtp = "";
    private Bitmap proofPhoto;
    private EditText otpBox;
    private EditText cashBox;
    private EditText returnedBox;
    private EditText emptyBox;
    private EditText notesBox;
    private Spinner bottlePicker;
    private Spinner paymentPicker;
    private SignaturePad pad;
    private TextView photoStatus;
    private ConnectivityManager connectivityManager;
    private boolean networkCallbackRegistered = false;
    private boolean automaticSyncRunning = false;
    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) {
            runOnUiThread(() -> syncWhenConnected());
        }
    };

    interface Work { void run() throws Exception; }
    private void background(Work job, Runnable success, Runnable failure) {
        io.execute(() -> {
            try { job.run(); runOnUiThread(success); }
            catch (Exception ex) {
                String message = ex.getMessage() == null ? "Network unavailable" : ex.getMessage();
                runOnUiThread(() -> { toast(message); if (failure != null) failure.run(); });
            }
        });
    }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    private int dp(int value) { return (int) (getResources().getDisplayMetrics().density * value + 0.5f); }
    private String today() { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()); }

    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(BLUE);
        getWindow().setNavigationBarColor(Color.BLACK);
        serverUrl = getPreferences(MODE_PRIVATE).getString("server", "");
        welcome();
        connectivityManager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (connectivityManager != null) {
            try {
                connectivityManager.registerDefaultNetworkCallback(networkCallback);
                networkCallbackRegistered = true;
            } catch (RuntimeException ignored) { /* Manual Sync remains available. */ }
        }
    }
    private LinearLayout page(String title, String description) {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(18), dp(20), dp(18), dp(38));
        content.setBackgroundColor(LIGHT);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(content);
        setContentView(scroll);
        TextView head = label(title, 28, BLUE, true);
        head.setPadding(0, dp(3), 0, dp(7));
        content.addView(head);
        if (!description.isEmpty()) {
            TextView desc = label(description, 15, MUTED, false);
            desc.setPadding(0, 0, 0, dp(17));
            content.addView(desc);
        }
        return content;
    }
    private TextView label(String s, int size, int color, boolean bold) {
        TextView v = new TextView(this);
        v.setText(s);
        v.setTextSize(size); v.setTextColor(color);
        if (bold) v.setTypeface(null, 1);
        return v;
    }
    private TextView line(LinearLayout box, String text, int size) {
        TextView item = label(text, size, BLUE, false);
        item.setPadding(dp(6), dp(9), dp(6), dp(8));
        box.addView(item);
        return item;
    }
    private EditText field(LinearLayout box, String hint, String initial, int inputType) {
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setTextSize(17);
        input.setHint(hint);
        input.setText(initial);
        input.setInputType(inputType);
        input.setPadding(dp(12), dp(12), dp(12), dp(12));
        input.setBackgroundTintList(android.content.res.ColorStateList.valueOf(BLUE));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(58));
        lp.bottomMargin = dp(8);
        box.addView(input, lp);
        return input;
    }
    private Button action(LinearLayout box, String text, Runnable onClick) {
        Button button = new Button(this);
        button.setText(text); button.setTextSize(17);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setBackgroundTintList(android.content.res.ColorStateList.valueOf(BLUE));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(55));
        lp.bottomMargin = dp(10);
        box.addView(button, lp);
        button.setOnClickListener(v -> onClick.run());
        return button;
    }
    private LinearLayout card(LinearLayout box) {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setPadding(dp(12), dp(13), dp(12), dp(13));
        panel.setBackgroundColor(Color.WHITE);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.bottomMargin = dp(13);
        box.addView(panel, lp);
        return panel;
    }
    private void working(String message) { LinearLayout box = page("TEMO DRIVER", "Please wait"); line(box, message, 18); }

    private void welcome() {
        LinearLayout box = page("TEMO DRIVER", "Only driver accounts. Your company Admin uses the separate ERP system.");
        LinearLayout form = card(box);
        EditText url = field(form, "Company HTTPS ERP address", serverUrl, InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        EditText access = field(form, "Private Test access code (testing only)", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        EditText username = field(form, "Driver username", userName, InputType.TYPE_CLASS_TEXT);
        EditText password = field(form, "Password", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        action(form, "Driver Login", () -> {
            final String origin = url.getText().toString().trim().replaceAll("/+$", "");
            final String code = access.getText().toString();
            final String id = username.getText().toString().trim();
            final String pw = password.getText().toString();
            if (id.isEmpty() || pw.isEmpty()) { toast("Enter Driver username and password"); return; }
            try { api = new DriverApi(origin); }
            catch (Exception e) { toast(e.getMessage()); return; }
            serverUrl = origin; userName = id;
            working("Connecting securely...");
            background(() -> {
                if (!code.isEmpty()) api.unlock(code);
                driver = api.login(id, pw);
                cache = new DriverCache(this, serverUrl, driver.optLong("id"));
            }, () -> {
                getPreferences(MODE_PRIVATE).edit().putString("server", origin).apply();
                loadDeliveries(false);
            }, this::welcome);
        });
        line(box, "Your login never opens the ERP Admin panel.", 14);
    }

    private void home(JSONArray data, boolean fromCache) {
        LinearLayout box = page("MY DELIVERIES", driver.optString("name", "Driver") + "  ·  " + today());
        if (fromCache) line(box, "Offline: showing last saved assignments", 15);
        if (cache.queuedCount() > 0) {
            line(box, "Updates requiring attention: " + cache.queuedCount(), 16);
            action(box, "Review Saved Updates", this::offlineStatus);
        }
        action(box, "Refresh Deliveries", () -> loadDeliveries(history));
        action(box, history ? "Today's Deliveries" : "Delivery History", () -> loadDeliveries(!history));
        action(box, "Sync Offline Updates", this::sync);
        if (data.length() == 0) line(box, "No assigned deliveries to show.", 18);
        for (int i = 0; i < data.length(); i++) {
            JSONObject d = data.optJSONObject(i);
            if (d == null) continue;
            LinearLayout item = card(box);
            line(item, "#" + d.optInt("id") + "  " + d.optString("customer_name", "Customer"), 20);
            line(item, d.optString("status", "assigned").replace('_', ' ') + "  ·  " + d.optString("delivery_address", d.optString("customer_address", "")), 14);
            action(item, "Open Delivery", () -> { selected = d; deliveryDetail(); });
        }
        action(box, "Log Out", () -> { api.setToken(""); driver = null; cache = null; selected = null; welcome(); });
    }
    private void loadDeliveries(boolean showHistory) {
        if (api == null || driver == null || cache == null) { welcome(); return; }
        history = showHistory;
        working("Loading assigned deliveries...");
        final JSONArray[] result = new JSONArray[1];
        final boolean[] cached = { false };
        background(() -> {
            try {
                result[0] = api.deliveries(today(), showHistory);
                cache.cache(showHistory, result[0]);
            } catch (Exception error) {
                result[0] = cache.cached(showHistory);
                cached[0] = true;
            }
        }, () -> {
            home(result[0], cached[0]);
            if (!cached[0]) syncWhenConnected();
        }, () -> home(cache.cached(showHistory), true));
    }

    private void deliveryDetail() {
        if (selected == null) { loadDeliveries(false); return; }
        LinearLayout box = page("DELIVERY #" + selected.optInt("id"), "Assigned to you only");
        LinearLayout details = card(box);
        line(details, selected.optString("customer_name", "Customer"), 23);
        line(details, "Status: " + selected.optString("status", "assigned"), 17);
        line(details, "Address: " + selected.optString("delivery_address", selected.optString("customer_address", "")), 16);
        line(details, "Amount: " + selected.optString("total_amount", "0"), 17);
        if (!selected.optString("customer_phone").isEmpty()) action(box, "Call Customer", () -> {
            String phone = selected.optString("customer_phone");
            startActivity(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(phone))));
        });
        String addr = selected.optString("delivery_address", selected.optString("customer_address", ""));
        if (!addr.isEmpty()) action(box, "Open Map", () -> {
            Uri location = Uri.parse("geo:0,0?q=" + Uri.encode(addr));
            try { startActivity(new Intent(Intent.ACTION_VIEW, location)); } catch (Exception e) { toast("Map app unavailable"); }
        });
        String status = selected.optString("status");
        if (!status.equals("delivered") && !status.equals("failed")) {
            if (!status.equals("out_for_delivery")) action(box, "START DELIVERY", () -> queueOperation("start", new JSONObject()));
            action(box, "COMPLETE DELIVERY", this::completeForm);
            action(box, "FAILED DELIVERY", this::failedForm);
        }
        action(box, "Back to Deliveries", () -> loadDeliveries(history));
    }
    private void queueOperation(String actionName, JSONObject body) {
        try {
            cache.enqueue(selected.optLong("id"), actionName, selected.optString("updated_at"), body);
            toast("Saved locally. Syncing when possible.");
            sync();
        } catch (Exception e) { toast("Could not safely save this update: " + e.getMessage()); }
    }
    private void failedForm() {
        LinearLayout box = page("FAILED DELIVERY", "Reason is required");
        EditText why = field(box, "Reason for failed delivery", "", InputType.TYPE_CLASS_TEXT);
        action(box, "Save Failed Status", () -> {
            if (why.getText().toString().trim().isEmpty()) { toast("Please add a reason"); return; }
            try { queueOperation("fail", new JSONObject().put("notes", why.getText().toString().trim())); }
            catch (Exception e) { toast(e.getMessage()); }
        });
        action(box, "Back", this::deliveryDetail);
    }
    // Sync only while the app is active; never silently discard failed operations.
    // A network callback retries the driver-scoped queue when internet returns.
    private void syncWhenConnected() {
        if (api == null || driver == null || cache == null || automaticSyncRunning || cache.queuedCount() == 0) return;
        automaticSyncRunning = true;
        final DriverApi currentApi = api;
        final DriverCache currentCache = cache;
        io.execute(() -> {
            int applied = 0;
            try {
                JSONArray batch = currentCache.sendable();
                if (batch.length() > 0) {
                    JSONObject response = currentApi.post("/api/driver/offline-sync", new JSONObject().put("operations", batch));
                    JSONArray results = response.optJSONArray("results");
                    applied = currentCache.applyResults(results == null ? new JSONArray() : results);
                }
            } catch (Exception ignored) {
                // Retain pending entries; the next network event or manual Sync retries them.
            }
            final int completed = applied;
            runOnUiThread(() -> {
                automaticSyncRunning = false;
                if (currentCache == cache && completed > 0) toast(completed + " saved updates synced automatically.");
            });
        });
    }

    // This screen includes pending and rejected records; a failed/conflicted
    // operation is not represented as a successful delivery.
    private void offlineStatus() {
        if (cache == null || driver == null) { welcome(); return; }
        JSONArray records = cache.queue();
        LinearLayout box = page("SAVED UPDATES", "Pending changes are not confirmed in ERP until they sync.");
        if (records.length() == 0) line(box, "All saved updates have synced.", 18);
        int pending = 0;
        int rejected = 0;
        for (int i = 0; i < records.length(); i++) {
            JSONObject record = records.optJSONObject(i);
            if (record == null) continue;
            String state = record.optString("_state", "pending");
            if ("pending".equals(state)) pending++;
            else rejected++;
            LinearLayout item = card(box);
            String actionName = record.optString("operationType", "update").replace('_', ' ');
            line(item, actionName + " • Delivery #" + record.optLong("deliveryId"), 18);
            line(item, "pending".equals(state) ? "Waiting for internet / sync" : "Needs review: " + state, 15);
            String explanation = record.optString("_message", "");
            if (!explanation.isEmpty()) line(item, explanation, 14);
        }
        line(box, pending + " pending • " + rejected + " need review", 16);
        if (pending > 0) action(box, "Sync Pending Updates", this::sync);
        if (rejected > 0) line(box, "Rejected updates are kept for manager review; they cannot be silently marked delivered.", 14);
        action(box, "Back to Deliveries", () -> loadDeliveries(history));
    }

    private void sync() {
        if (api == null || cache == null) return;
        working("Syncing saved updates...");
        final int[] synced = {0};
        background(() -> {
            JSONArray batch = cache.sendable();
            if (batch.length() == 0) return;
            JSONObject response = api.post("/api/driver/offline-sync", new JSONObject().put("operations", batch));
            synced[0] = cache.applyResults(response.optJSONArray("results") == null ? new JSONArray() : response.optJSONArray("results"));
        }, () -> { toast(synced[0] + " updates synced. Other pending/conflicted updates are kept."); loadDeliveries(false); },
        () -> { toast("Offline updates kept safely for retry."); loadDeliveries(false); });
    }

    private void completeForm() {
        challengeId = 0; qaOtp = ""; proofPhoto = null;
        LinearLayout box = page("COMPLETE DELIVERY", "Customer OTP + signature required. Payment and bottles optional.");
        LinearLayout section = card(box);
        line(section, "Customer Verification", 20);
        action(section, "Request Customer OTP", () -> {
            working("Requesting customer verification...");
            background(() -> {
                JSONObject obj = api.post("/api/driver/deliveries/" + selected.optInt("id") + "/otp", new JSONObject());
                challengeId = obj.optInt("challengeId");
                qaOtp = obj.optString("otpCode", "");
            }, () -> {
                completeFormKeepOtp();
            }, this::deliveryDetail);
        });
        appendCompletionFields(box);
    }
    private void completeFormKeepOtp() {
        LinearLayout box = page("COMPLETE DELIVERY", "Customer OTP request created.");
        line(box, qaOtp.isEmpty() ? "Ask the customer for their 6-digit OTP." : "TEST ONLY customer OTP: " + qaOtp, 16);
        appendCompletionFields(box);
    }
    private void appendCompletionFields(LinearLayout box) {
        LinearLayout form = card(box);
        otpBox = field(form, "6-digit customer OTP", qaOtp, InputType.TYPE_CLASS_NUMBER);
        line(form, "Sign below (finger signature)", 17);
        pad = new SignaturePad();
        form.addView(pad, new LinearLayout.LayoutParams(-1, dp(180)));
        action(form, "Clear Signature", pad::clear);
        cashBox = field(form, "Cash collected (0 if none)", "0", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        paymentPicker = picker(form, new String[]{"Cash", "Bank Transfer", "Other"});
        returnedBox = field(form, "Bottles returned", "0", InputType.TYPE_CLASS_NUMBER);
        emptyBox = field(form, "Empty bottles", "0", InputType.TYPE_CLASS_NUMBER);
        line(form, "Bottle type (select if returning bottles)", 15);
        bottlePicker = picker(form, new String[]{"No bottle type selected"});
        notesBox = field(form, "Delivery notes (optional)", "", InputType.TYPE_CLASS_TEXT);
        photoStatus = line(form, "Photo: optional", 15);
        action(form, "Add Proof Photo", () -> {
            Intent picker = new Intent(Intent.ACTION_GET_CONTENT);
            picker.setType("image/*");
            picker.addCategory(Intent.CATEGORY_OPENABLE);
            startActivityForResult(Intent.createChooser(picker, "Select delivery photo"), PICK_PHOTO);
        });
        action(form, "CONFIRM COMPLETE", this::submitCompletion);
        action(box, "Back", this::deliveryDetail);
        workingBottleTypes();
    }
    private void workingBottleTypes() {
        final JSONArray[] types = {new JSONArray()};
        // Bottle types must come from the scoped driver endpoint, not an admin API.
        background(() -> types[0] = api.list("/api/driver/bottle-types"),
            () -> { bottleTypes = types[0]; if (bottlePicker != null) populateBottles(bottlePicker); },
            () -> {});
    }
    private Spinner picker(LinearLayout box, String[] values) {
        Spinner spinner = new Spinner(this);
        spinner.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, values));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(48)); lp.bottomMargin = dp(10);
        box.addView(spinner, lp); return spinner;
    }
    private void populateBottles(Spinner target) {
        String[] values = new String[bottleTypes.length() + 1];
        values[0] = "No bottle type selected";
        for (int i = 0; i < bottleTypes.length(); i++) values[i+1] = bottleTypes.optJSONObject(i).optString("name");
        target.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, values));
    }

    private void submitCompletion() {
        if (challengeId == 0 || !otpBox.getText().toString().matches("[0-9]{6}")) { toast("Request OTP and enter the customer's six-digit code"); return; }
        if (!pad.hasInk()) { toast("Customer signature required"); return; }
        double amount; int returned, empty;
        try {
            amount = Double.parseDouble(cashBox.getText().toString());
            returned = Integer.parseInt(returnedBox.getText().toString());
            empty = Integer.parseInt(emptyBox.getText().toString());
        } catch (Exception e) { toast("Enter valid payment and bottle quantities"); return; }
        if (!Double.isFinite(amount) || amount < 0 || returned < 0 || empty < 0) { toast("Invalid payment or bottle count"); return; }
        int bottleIndex = bottlePicker == null ? 0 : bottlePicker.getSelectedItemPosition();
        if (returned > 0 && bottleIndex == 0) { toast("Select returned bottle type"); return; }
        final JSONObject[] body = {new JSONObject()};
        final Bitmap signature = pad.asBitmap();
        final Bitmap selectedPhoto = proofPhoto;
        try {
            body[0].put("action", "deliver");
            body[0].put("otpChallengeId", challengeId);
            body[0].put("otpCode", otpBox.getText().toString());
            body[0].put("bottleReturnCount", returned);
            body[0].put("emptyCount", empty);
            body[0].put("notes", notesBox.getText().toString());
            if (returned > 0) body[0].put("bottleId", bottleTypes.getJSONObject(bottleIndex - 1).optInt("id"));
            if (amount > 0) body[0].put("payment", new JSONObject().put("amount", amount).put("method", paymentPicker.getSelectedItem().toString()));
        } catch (Exception e) { toast(e.getMessage()); return; }
        working("Uploading proof and completing delivery...");
        background(() -> {
            JSONObject sign = api.upload(selected.optInt("id"), "signature", encode(signature, Bitmap.CompressFormat.PNG));
            body[0].put("signature", sign);
            if (selectedPhoto != null) body[0].put("photo", api.upload(selected.optInt("id"), "photo", encode(selectedPhoto, Bitmap.CompressFormat.JPEG)));
            api.post("/api/driver/deliveries/" + selected.optInt("id") + "/action", body[0]);
        }, () -> { toast("Delivery completed. ERP ledger updated."); selected = null; loadDeliveries(false); },
        () -> { toast("Not completed. Reopen and verify customer OTP before retrying."); deliveryDetail(); });
    }
    private static String encode(Bitmap bitmap, Bitmap.CompressFormat format) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (!bitmap.compress(format, 75, out)) throw new Exception("Cannot encode proof image");
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_PHOTO && resultCode == RESULT_OK && data != null && data.getData() != null) {
            try (InputStream in = getContentResolver().openInputStream(data.getData())) {
                Bitmap bmp = BitmapFactory.decodeStream(in);
                if (bmp == null) throw new Exception("Could not decode image");
                int w = bmp.getWidth(), h = bmp.getHeight();
                float scale = Math.min(1f, 1024f / Math.max(w, h));
                proofPhoto = scale < 1 ? Bitmap.createScaledBitmap(bmp, (int)(w * scale), (int)(h * scale), true) : bmp;
                if (photoStatus != null) photoStatus.setText("Photo selected");
            } catch (Exception e) { toast("Photo could not be loaded"); }
        }
    }
    @Override public void onBackPressed() {
        if (selected != null && driver != null) { selected = null; loadDeliveries(false); }
        else if (driver != null) new AlertDialog.Builder(this).setMessage("Log out of driver app?")
            .setPositiveButton("Log Out", (d,w) -> { api.setToken(""); driver = null; welcome(); })
            .setNegativeButton("Cancel", null).show();
        else super.onBackPressed();
    }
    @Override protected void onResume() { super.onResume(); syncWhenConnected(); }
    @Override protected void onDestroy() {
        if (networkCallbackRegistered && connectivityManager != null) {
            try { connectivityManager.unregisterNetworkCallback(networkCallback); }
            catch (RuntimeException ignored) { /* Activity is already stopping. */ }
        }
        io.shutdownNow();
        super.onDestroy();
    }

    private final class SignaturePad extends View {
        private final Paint ink = new Paint(3);
        private final Path strokes = new Path();
        private boolean signed;
        SignaturePad() {
            super(MainActivity.this);
            setBackgroundColor(Color.WHITE);
            ink.setColor(BLUE); ink.setStrokeWidth(dp(3));
            ink.setStyle(Paint.Style.STROKE); ink.setStrokeJoin(Paint.Join.ROUND); ink.setStrokeCap(Paint.Cap.ROUND);
        }
        @Override public boolean onTouchEvent(MotionEvent e) {
            if (e.getAction() == MotionEvent.ACTION_DOWN) { getParent().requestDisallowInterceptTouchEvent(true); strokes.moveTo(e.getX(), e.getY()); signed = true; invalidate(); return true; }
            if (e.getAction() == MotionEvent.ACTION_MOVE) { strokes.lineTo(e.getX(), e.getY()); invalidate(); return true; }
            if (e.getAction() == MotionEvent.ACTION_UP) { strokes.lineTo(e.getX(), e.getY()); invalidate(); return true; }
            return true;
        }
        @Override protected void onDraw(Canvas canvas) { super.onDraw(canvas); canvas.drawPath(strokes, ink); }
        boolean hasInk() { return signed; }
        void clear() { strokes.reset(); signed = false; invalidate(); }
        Bitmap asBitmap() {
            Bitmap bmp = Bitmap.createBitmap(Math.max(1, getWidth()), Math.max(1, getHeight()), Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp); canvas.drawColor(Color.WHITE); canvas.drawPath(strokes, ink);
            return bmp;
        }
    }
}
