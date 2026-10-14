package uk.gleissner.deviceprobe;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** Guided physical-key capture. State is committed before a system key can interrupt the app. */
public final class ProbeActivity extends Activity {
    static final String EXTRA_CAPTURE_TEXT = "captureText";
    static final int MAX_PAGE_EVENT_CHARS = 8192;
    static final long MAX_EVENT_LOG_BYTES = 4L * 1024 * 1024;
    private WebView web;
    private TextView prompt;
    private TextView result;
    private Button next;
    private final Wizard wizard = new Wizard();
    private SharedPreferences prefs;
    private long sequence;
    private long session;
    private boolean pageReady;
    private boolean captureText;
    private volatile boolean storageFailed;
    private long eventBytes;
    private boolean controlHeld;
    private boolean reviewControl;
    private int controlKey = -1;
    private AlertDialog restartDialog;
    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            event("screen", Inventory.object("state", intent.getAction()));
            if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                wizard.interrupted("screen-off"); persist(); render();
            }
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        captureText = getIntent().getBooleanExtra(EXTRA_CAPTURE_TEXT, false);
        prefs = getSharedPreferences("wizard", MODE_PRIVATE);
        wizard.step = prefs.getInt("step", 0);
        wizard.phase = prefs.getString("phase", "armed");
        wizard.outcome = prefs.getString("outcome", "");
        wizard.observed = prefs.getString("observed", "");
        wizard.activeKey = prefs.getInt("activeKey", -1);
        wizard.repeats = prefs.getInt("repeats", 0);
        sequence = prefs.getLong("sequence", 0);
        session = prefs.getLong("session", System.currentTimeMillis());
        // A killed process may never get onPause or an up event. Ask the user to confirm the attempt.
        if (prefs.getBoolean("wasRunning", false) && wizard.phase.equals("armed")) {
            wizard.interrupted("process-restarted-confirm-attempt");
        }
        eventBytes = new File(getFilesDir(), "events.jsonl").length();
        persist();
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        prompt = new TextView(this); prompt.setTextSize(18); prompt.setPadding(12, 8, 12, 4);
        layout.addView(prompt);
        result = new TextView(this); result.setTextSize(16); result.setPadding(12, 4, 12, 4);
        layout.addView(result);
        LinearLayout buttons = new LinearLayout(this);
        next = button(R.string.next_button, () -> advance());
        buttons.addView(next, new LinearLayout.LayoutParams(0, dp(48), 1));
        buttons.addView(button(R.string.retry_button, () -> retry()), new LinearLayout.LayoutParams(0, dp(48), 1));
        buttons.addView(button(R.string.no_event_button, () -> noEvent()), new LinearLayout.LayoutParams(0, dp(48), 1));
        layout.addView(buttons);
        web = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(
            (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        // Only the bundled page has a bridge. All external navigation is refused.
        web.addJavascriptInterface(new Bridge(), "Probe");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public void onPageFinished(WebView view, String url) { pageReady = true; render(); }
        });
        layout.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);
        IntentFilter screenFilter = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        screenFilter.addAction(Intent.ACTION_SCREEN_ON);
        registerReceiver(screenReceiver, screenFilter);
        event("lifecycle", Inventory.object("state", "create"));
        render();
        new Thread(() -> {
            JSONObject report = Inventory.collect(this);
            save("inventory.json", report.toString());
            runOnUiThread(() -> web.loadUrl("file:///android_asset/probe.html"));
        }, "probe-inventory").start();
        getWindow().getDecorView().setOnApplyWindowInsetsListener((view, insets) -> {
            event("insets", Inventory.object("left", insets.getSystemWindowInsetLeft(),
                "top", insets.getSystemWindowInsetTop(), "right", insets.getSystemWindowInsetRight(),
                "bottom", insets.getSystemWindowInsetBottom()));
            return view.onApplyWindowInsets(insets);
        });
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private Button button(int text, Runnable action) {
        Button button = new Button(this); button.setText(text); button.setTextSize(14);
        button.setOnClickListener(view -> action.run()); return button;
    }

    private void render() {
        prompt.setText(getString(R.string.step_prompt, Math.min(wizard.step + 1, Wizard.TOTAL), Wizard.TOTAL,
            wizard.mode().equals("raw") ? "Android" : "WebView", wizard.label()));
        if (wizard.phase.equals("complete")) result.setText(R.string.complete_status);
        else if (wizard.phase.equals("review")) {
            result.setText(getString(R.string.review_status, wizard.outcome, wizard.observed, wizard.repeats));
        } else if (wizard.disruptive()) result.setText(R.string.disruptive_status);
        else if (wizard.textStep()) result.setText(R.string.text_status);
        else result.setText(R.string.armed_status);
        next.setText(wizard.phase.equals("complete") ? R.string.again_button : R.string.next_button);
        next.setEnabled(wizard.phase.equals("review") || wizard.phase.equals("complete") || wizard.textStep());
        if (pageReady) {
            JSONObject state = Inventory.object("index", wizard.step < Wizard.KEYS.length * 2 ? wizard.step % Wizard.KEYS.length : -1,
                "phase", wizard.phase, "label", wizard.label(), "text", wizard.textStep(), "mode", wizard.mode(),
                "attempt", wizard.attempt);
            if (wizard.needsWebFocus()) web.requestFocus();
            web.evaluateJavascript("window.setStep(" + state + ")", null);
        }
        if (storageFailed) result.append("\n" + getString(R.string.storage_failed_status));
        if (wizard.phase.equals("review") || wizard.phase.equals("complete")) next.requestFocus();
    }

    private void advance() {
        if (wizard.phase.equals("complete")) {
            restartDialog = new AlertDialog.Builder(this).setMessage(R.string.restart_question)
                .setNegativeButton(android.R.string.cancel, (dialog, which) -> next.requestFocus())
                .setPositiveButton(R.string.again_button, (dialog, which) -> {
                    wizard.step = 0; wizard.retry(); session = System.currentTimeMillis();
                    persist(); render(); event("session-start", Inventory.object("reason", "user-requested"));
                }).create();
            restartDialog.show(); return;
        }
        if (wizard.textStep() && wizard.phase.equals("armed")) wizard.review("text-attempt-confirmed");
        if (!wizard.phase.equals("review")) return;
        event("step-result", Inventory.object("outcome", wizard.outcome, "observed", wizard.observed,
            "repeatCount", wizard.repeats));
        wizard.next(); persist(); render();
        event("step-start", Inventory.object("instructions", wizard.label()));
    }
    private void retry() {
        if (wizard.phase.equals("complete")) return;
        event("step-retry", Inventory.object("previousOutcome", wizard.outcome));
        wizard.retry(); persist(); render();
    }
    private void noEvent() {
        if (wizard.phase.equals("complete")) return;
        wizard.review(wizard.textStep() ? "text-attempt-confirmed" : "user-confirmed-no-event");
        if (!wizard.textStep()) { wizard.observed = ""; wizard.activeKey = -1; wizard.repeats = 0; }
        persist(); render();
        event("step-review", Inventory.object("outcome", wizard.outcome));
    }

    @Override public boolean dispatchKeyEvent(KeyEvent key) {
        if (restartDialog != null && restartDialog.isShowing()) {
            event("wizard-control", Inventory.object("dialog", "restart", "keyCode", key.getKeyCode(), "action", key.getAction()));
            return super.dispatchKeyEvent(key);
        }
        boolean reviewing = wizard.phase.equals("review") || wizard.phase.equals("complete");
        boolean down = key.getAction() == KeyEvent.ACTION_DOWN;
        boolean up = key.getAction() == KeyEvent.ACTION_UP;
        int code = key.getKeyCode();
        if (Wizard.injected(key.getDeviceId(), key.getScanCode(), key.getSource())) {
            event("injected-key-ignored", Inventory.object("keyCode", code, "action", key.getAction(),
                "deviceId", key.getDeviceId(), "scanCode", key.getScanCode(), "source", key.getSource()));
            return true;
        }
        // Keep confirmation down/up pairs out of the next attempt, even when down advances it.
        if (down && key.getRepeatCount() == 0 && reviewing) {
            reviewControl = true; controlKey = code;
        }
        if (reviewControl && controlKey == code) {
            event("wizard-control", Inventory.object("keyCode", code, "action", key.getAction()));
            if (up) {
                reviewControl = false; controlKey = -1;
                if (code == KeyEvent.KEYCODE_1) retry();
                else if (code == KeyEvent.KEYCODE_2) noEvent();
            }
            if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
                    || code == KeyEvent.KEYCODE_DPAD_LEFT || code == KeyEvent.KEYCODE_DPAD_RIGHT
                    || code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN) {
                return super.dispatchKeyEvent(key);
            }
            return true;
        }
        // Hold 0 is an escape when the expected physical key delivers no event. Its early
        // down events are preserved, but the no-event outcome never claims they match the prompt.
        if (code == KeyEvent.KEYCODE_0 && down && key.getRepeatCount() == 1 && !wizard.phase.equals("complete")) {
            controlHeld = true; noEvent(); return true;
        }
        if (controlHeld && code == KeyEvent.KEYCODE_0) {
            if (up) controlHeld = false;
            return true;
        }
        event("android-key", Inventory.object("action", key.getAction(), "keyCode", code,
            "keyName", KeyEvent.keyCodeToString(code), "scanCode", key.getScanCode(), "repeat", key.getRepeatCount(),
            "metaState", key.getMetaState(), "flags", key.getFlags(), "deviceId", key.getDeviceId(),
            "source", key.getSource(), "unicode", captureText ? key.getUnicodeChar() : null,
            "characters", captureText ? key.getCharacters() : null,
            "eventTimeMs", key.getEventTime(), "downTimeMs", key.getDownTime()));
        String before = wizard.phase;
        if (down) wizard.down(code, KeyEvent.keyCodeToString(code) + " scan=" + key.getScanCode(), key.getRepeatCount());
        if (up) wizard.up(code);
        // Capture context is on disk before Call, the special key or Hang Up can leave the activity.
        persist();
        boolean handled = wizard.mode().equals("raw") || super.dispatchKeyEvent(key);
        if (!before.equals(wizard.phase)) {
            // Let Chromium finish dispatching this press before changing its focused element.
            web.postDelayed(() -> { persist(); render(); }, 120);
        }
        return handled;
    }

    public final class Bridge {
        @JavascriptInterface public boolean captureText() { return captureText; }
        @JavascriptInterface public void record(String json) {
            if (json == null || json.length() > MAX_PAGE_EVENT_CHARS) {
                Log.w("DeviceProbe", "Dropped oversized or empty bundled-page event");
                return;
            }
            runOnUiThread(() -> {
                try {
                    JSONObject data = new JSONObject(json);
                    event("web", data);
                    String type = data.optString("type");
                    if (type.equals("keydown") || type.equals("keyup")) {
                        String before = wizard.phase;
                        wizard.webKey(data.optString("key") + " / " + data.optString("code"), type.equals("keyup"));
                        persist();
                        if (!before.equals(wizard.phase)) render();
                    }
                } catch (Exception error) {
                    Log.e("DeviceProbe", "Invalid bundled-page event: " + error.getClass().getSimpleName());
                }
            });
        }
    }

    @Override public boolean dispatchTouchEvent(MotionEvent motion) {
        if (motion.getActionMasked() != MotionEvent.ACTION_MOVE) {
            event("motion", Inventory.object("action", motion.getActionMasked(), "source", motion.getSource(),
                "deviceId", motion.getDeviceId(), "pointers", motion.getPointerCount(),
                "x", motion.getX(), "y", motion.getY(), "pressure", motion.getPressure()));
        }
        return super.dispatchTouchEvent(motion);
    }

    private synchronized void event(String type, JSONObject data) {
        JSONObject record = Inventory.object("sequence", ++sequence, "session", session,
            "wallTimeMs", System.currentTimeMillis(), "uptimeMs", SystemClock.uptimeMillis(), "type", type,
            "step", wizard.step, "expectedPhysicalKey", wizard.label(), "mode", wizard.mode(), "phase", wizard.phase, "data", data);
        byte[] line = (record + "\n").getBytes(StandardCharsets.UTF_8);
        if (eventBytes + line.length > MAX_EVENT_LOG_BYTES) {
            if (!storageFailed) Log.w("DeviceProbe", "events.jsonl reached its size limit; later events are dropped");
            storageFailed = true;
            return;
        }
        try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), "events.jsonl"), true)) {
            out.write(line);
            eventBytes += line.length;
            out.getFD().sync();
            if (prefs != null && !prefs.edit().putLong("sequence", sequence).commit()) {
                Log.e("DeviceProbe", "Cannot save sequence " + sequence,
                    new IllegalStateException("SharedPreferences sequence commit failed"));
            }
        } catch (Exception error) {
            storageFailed = true;
            Log.e("DeviceProbe", "Cannot append " + type + " to events.jsonl", error);
        }
    }
    private void persist() {
        if (prefs == null) return;
        boolean saved = prefs.edit().putInt("step", wizard.step).putString("phase", wizard.phase)
            .putString("outcome", wizard.outcome).putString("observed", wizard.observed)
            .putInt("activeKey", wizard.activeKey).putInt("repeats", wizard.repeats)
            .putLong("sequence", sequence).putLong("session", session).putBoolean("wasRunning", true).commit();
        if (!saved) storageFailed = true;
        if (!saved) Log.e("DeviceProbe", "Cannot persist wizard step " + wizard.step,
            new IllegalStateException("SharedPreferences commit failed"));
        save("wizard.json", Inventory.object("step", wizard.step, "total", Wizard.TOTAL, "phase", wizard.phase,
            "expectedPhysicalKey", wizard.label(), "mode", wizard.mode(), "outcome", wizard.outcome,
            "observed", wizard.observed, "repeats", wizard.repeats, "session", session).toString());
    }
    private void save(String name, String content) {
        android.util.AtomicFile file = new android.util.AtomicFile(new File(getFilesDir(), name));
        FileOutputStream out = null;
        try {
            out = file.startWrite(); out.write(content.getBytes(StandardCharsets.UTF_8)); file.finishWrite(out);
        } catch (Exception error) {
            file.failWrite(out); storageFailed = true; Log.e("DeviceProbe", "Cannot save " + name, error);
        }
    }
    @Override protected void onResume() {
        super.onResume(); event("lifecycle", Inventory.object("state", "resume"));
        if (prefs != null) { persist(); render(); }
    }
    @Override protected void onPause() {
        event("lifecycle", Inventory.object("state", "pause"));
        wizard.interrupted("foreground-lost-confirm-attempt"); persist(); super.onPause();
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused); event("focus", Inventory.object("focused", focused));
    }
    @Override protected void onDestroy() {
        unregisterReceiver(screenReceiver);
        if (web != null) web.destroy();
        event("lifecycle", Inventory.object("state", "destroy")); persist(); super.onDestroy();
    }
}
