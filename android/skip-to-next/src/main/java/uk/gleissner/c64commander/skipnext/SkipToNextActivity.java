/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.skipnext;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Skips to the next playlist item in the main app, then gets out of the way. A phone that lets the user open an app from a
 * function key can bind this one, so the key works from anywhere on the phone.
 */
public final class SkipToNextActivity extends Activity {
    static final String METHOD_NEXT = "next";
    static final String RESULT_WAS_IN_FRONT = "wasInFront";

    /**
     * Opening an app from a function key can show the system's app switcher about half a second later. Handing the
     * screen back to the main app before that would be undone, so the hand-back waits until it has passed.
     */
    static final long HAND_BACK_DELAY_MS = 800;

    private static final String TAG = "SkipToNext";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false);
        }
        if (sendNext()) {
            new Handler(Looper.getMainLooper()).postDelayed(this::handBackToMainApp, HAND_BACK_DELAY_MS);
        } else {
            finish();
        }
    }

    private boolean sendNext() {
        Uri transport = Uri.parse("content://" + BuildConfig.MAIN_APPLICATION_ID + ".transport");
        try {
            Bundle reply = getContentResolver().call(transport, METHOD_NEXT, null, null);
            return reply != null && reply.getBoolean(RESULT_WAS_IN_FRONT);
        } catch (RuntimeException e) {
            Log.w(TAG, "Skip to next: " + BuildConfig.MAIN_APPLICATION_ID + " did not accept the command at " + transport, e);
            return false;
        }
    }

    private void handBackToMainApp() {
        Intent main = getPackageManager().getLaunchIntentForPackage(BuildConfig.MAIN_APPLICATION_ID);
        if (main == null) {
            Log.w(TAG, "Skip to next: no launch intent for " + BuildConfig.MAIN_APPLICATION_ID + " to hand the screen back to");
        } else {
            startActivity(main);
        }
        finish();
    }
}
