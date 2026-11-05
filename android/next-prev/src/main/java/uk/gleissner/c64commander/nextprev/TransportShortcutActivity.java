/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.nextprev;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Sends one transport command to the main app, then gets out of the way. A phone that lets the user open an app from a
 * function key can bind an entry, so the key works from anywhere on the phone.
 */
public abstract class TransportShortcutActivity extends Activity {
    static final String RESULT_WAS_IN_FRONT = "wasInFront";

    /**
     * Opening an app from a function key can show the system's app switcher about half a second later. Handing the
     * screen back to the main app before that would be undone, so the hand-back waits until it has passed.
     */
    static final long HAND_BACK_DELAY_MS = 800;

    private static final String TAG = "NextPrev";

    /** The main app's transport command, as its provider names it. */
    abstract String command();

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable handBack = this::handBackToMainApp;
    private boolean handBackScheduled;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false);
        }
        onPress();
    }

    /** A press while this one still waits to hand back reaches this instance instead of starting another. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        onPress();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(handBack);
        super.onDestroy();
    }

    private void onPress() {
        boolean wasInFront = sendCommand();
        if (!wasInFront && !handBackScheduled) {
            finish();
            return;
        }
        handler.removeCallbacks(handBack);
        handler.postDelayed(handBack, HAND_BACK_DELAY_MS);
        handBackScheduled = true;
    }

    private boolean sendCommand() {
        Uri transport = Uri.parse("content://" + BuildConfig.MAIN_APPLICATION_ID + ".transport");
        try {
            Bundle reply = getContentResolver().call(transport, command(), null, null);
            return reply != null && reply.getBoolean(RESULT_WAS_IN_FRONT);
        } catch (RuntimeException e) {
            Log.w(TAG, BuildConfig.MAIN_APPLICATION_ID + " did not accept '" + command() + "' at " + transport, e);
            return false;
        }
    }

    private void handBackToMainApp() {
        Intent main = getPackageManager().getLaunchIntentForPackage(BuildConfig.MAIN_APPLICATION_ID);
        if (main == null) {
            Log.w(TAG, "No launch intent for " + BuildConfig.MAIN_APPLICATION_ID + " to hand the screen back to");
        } else {
            startActivity(main);
        }
        finish();
    }
}
