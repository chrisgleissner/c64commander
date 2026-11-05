/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander.nextprev;

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
public class TransportShortcutActivityTest {
    private static final String MAIN = BuildConfig.MAIN_APPLICATION_ID;

    public static final class FakeTransport extends ContentProvider {
        static final List<String> calls = new ArrayList<>();
        static boolean wasInFront;

        @Override public boolean onCreate() { return true; }

        @Override
        public Bundle call(String method, String arg, Bundle extras) {
            calls.add(method);
            Bundle reply = new Bundle();
            reply.putBoolean(TransportShortcutActivity.RESULT_WAS_IN_FRONT, wasInFront);
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
        ActivityController<NextActivity> controller = Robolectric.buildActivity(NextActivity.class).create();
        NextActivity activity = controller.get();

        assertEquals(List.of("next"), FakeTransport.calls);
        ShadowLooper.idleMainLooper(TransportShortcutActivity.HAND_BACK_DELAY_MS - 1, TimeUnit.MILLISECONDS);
        assertFalse("waits for the system switcher to pass", activity.isFinishing());
        assertNull(shadowOf(activity).peekNextStartedActivity());

        ShadowLooper.idleMainLooper(1, TimeUnit.MILLISECONDS);

        Intent started = shadowOf(activity).getNextStartedActivity();
        assertEquals(MAIN, started.getComponent().getPackageName());
        assertTrue(activity.isFinishing());
    }

    @Test
    public void aPressWhileTheHandBackIsPendingIsSentAndPostponesTheHandBack() {
        installMainApp(true);
        ActivityController<NextActivity> controller = Robolectric.buildActivity(NextActivity.class).create();
        NextActivity activity = controller.get();
        ShadowLooper.idleMainLooper(500, TimeUnit.MILLISECONDS);
        FakeTransport.wasInFront = false;

        controller.newIntent(new Intent(Intent.ACTION_MAIN));

        assertEquals(List.of("next", "next"), FakeTransport.calls);
        ShadowLooper.idleMainLooper(TransportShortcutActivity.HAND_BACK_DELAY_MS - 1, TimeUnit.MILLISECONDS);
        assertFalse(activity.isFinishing());
        ShadowLooper.idleMainLooper(1, TimeUnit.MILLISECONDS);
        assertEquals(MAIN, shadowOf(activity).getNextStartedActivity().getComponent().getPackageName());
        assertTrue(activity.isFinishing());
    }

    @Test
    public void bothEntriesAreSingleTopSoARepeatedLaunchReachesTheWaitingInstance() throws Exception {
        android.content.pm.PackageManager pm = RuntimeEnvironment.getApplication().getPackageManager();
        for (Class<?> entry : List.of(NextActivity.class, PrevActivity.class)) {
            android.content.pm.ActivityInfo info =
                    pm.getActivityInfo(new ComponentName(RuntimeEnvironment.getApplication(), entry), 0);
            assertEquals(entry.getSimpleName(), android.content.pm.ActivityInfo.LAUNCH_SINGLE_TOP, info.launchMode);
        }
    }

    @Test
    public void sendsNextAndLeavesTheUserWhereTheyWereWhenTheMainAppWasNotInFront() {
        installMainApp(false);
        NextActivity activity = Robolectric.buildActivity(NextActivity.class).create().get();

        assertEquals(List.of("next"), FakeTransport.calls);
        assertTrue(activity.isFinishing());
        ShadowLooper.idleMainLooper(TransportShortcutActivity.HAND_BACK_DELAY_MS, TimeUnit.MILLISECONDS);
        assertNull(shadowOf(activity).getNextStartedActivity());
    }

    @Test
    public void prevSendsPreviousToTheMainApp() {
        installMainApp(false);
        Robolectric.buildActivity(PrevActivity.class).create();

        assertEquals(List.of("previous"), FakeTransport.calls);
    }

    @Test
    public void finishesWithoutHandingBackWhenTheMainAppIsNotInstalled() {
        FakeTransport.calls.clear();
        NextActivity activity = Robolectric.buildActivity(NextActivity.class).create().get();

        assertTrue(activity.isFinishing());
        ShadowLooper.idleMainLooper(TransportShortcutActivity.HAND_BACK_DELAY_MS, TimeUnit.MILLISECONDS);
        assertNull(shadowOf(activity).getNextStartedActivity());
        assertEquals(List.of(), FakeTransport.calls);
    }
}
