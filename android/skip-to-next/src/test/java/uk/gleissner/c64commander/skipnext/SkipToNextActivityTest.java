/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.skipnext;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.robolectric.Shadows.shadowOf;

import android.content.ComponentName;
import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import java.util.concurrent.TimeUnit;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.shadows.ShadowLooper;

@RunWith(RobolectricTestRunner.class)
public class SkipToNextActivityTest {
    private static final String MAIN = BuildConfig.MAIN_APPLICATION_ID;

    public static final class FakeTransport extends ContentProvider {
        static final List<String> calls = new ArrayList<>();
        static boolean wasInFront;

        @Override public boolean onCreate() { return true; }

        @Override
        public Bundle call(String method, String arg, Bundle extras) {
            calls.add(method);
            Bundle reply = new Bundle();
            reply.putBoolean(SkipToNextActivity.RESULT_WAS_IN_FRONT, wasInFront);
            return reply;
        }

        @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { return null; }
        @Override public String getType(Uri u) { return null; }
        @Override public Uri insert(Uri u, ContentValues v) { return null; }
        @Override public int delete(Uri u, String s, String[] a) { return 0; }
        @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
    }

    private static void installMainApp(boolean wasInFront) {
        FakeTransport.calls.clear();
        FakeTransport.wasInFront = wasInFront;
        ProviderInfo info = new ProviderInfo();
        info.authority = MAIN + ".transport";
        Robolectric.buildContentProvider(FakeTransport.class).create(info);
        String activity = MAIN + ".MainActivity";
        shadowOf(RuntimeEnvironment.getApplication().getPackageManager())
                .addActivityIfNotPresent(new ComponentName(MAIN, activity));
        shadowOf(RuntimeEnvironment.getApplication().getPackageManager())
                .addIntentFilterForActivity(new ComponentName(MAIN, activity),
                        new android.content.IntentFilter(Intent.ACTION_MAIN) {{ addCategory(Intent.CATEGORY_LAUNCHER); }});
    }

    @Test
    public void sendsNextAndHandsTheScreenBackWhenTheMainAppWasInFront() {
        installMainApp(true);
        ActivityController<SkipToNextActivity> controller = Robolectric.buildActivity(SkipToNextActivity.class).create();
        SkipToNextActivity activity = controller.get();

        assertEquals(List.of(SkipToNextActivity.METHOD_NEXT), FakeTransport.calls);
        ShadowLooper.idleMainLooper(SkipToNextActivity.HAND_BACK_DELAY_MS - 1, TimeUnit.MILLISECONDS);
        assertFalse("waits for the system switcher to pass", activity.isFinishing());
        assertNull(shadowOf(activity).peekNextStartedActivity());

        ShadowLooper.idleMainLooper(1, TimeUnit.MILLISECONDS);

        Intent started = shadowOf(activity).getNextStartedActivity();
        assertEquals(MAIN, started.getComponent().getPackageName());
        assertTrue(activity.isFinishing());
    }

    @Test
    public void sendsNextAndLeavesTheUserWhereTheyWereWhenTheMainAppWasNotInFront() {
        installMainApp(false);
        SkipToNextActivity activity = Robolectric.buildActivity(SkipToNextActivity.class).create().get();

        assertEquals(List.of(SkipToNextActivity.METHOD_NEXT), FakeTransport.calls);
        assertTrue(activity.isFinishing());
        ShadowLooper.idleMainLooper(SkipToNextActivity.HAND_BACK_DELAY_MS, TimeUnit.MILLISECONDS);
        assertNull(shadowOf(activity).getNextStartedActivity());
    }

    @Test
    public void finishesWithoutHandingBackWhenTheMainAppIsNotInstalled() {
        FakeTransport.calls.clear();
        SkipToNextActivity activity = Robolectric.buildActivity(SkipToNextActivity.class).create().get();

        assertTrue(activity.isFinishing());
        ShadowLooper.idleMainLooper(SkipToNextActivity.HAND_BACK_DELAY_MS, TimeUnit.MILLISECONDS);
        assertNull(shadowOf(activity).getNextStartedActivity());
        assertEquals(List.of(), FakeTransport.calls);
    }
}
