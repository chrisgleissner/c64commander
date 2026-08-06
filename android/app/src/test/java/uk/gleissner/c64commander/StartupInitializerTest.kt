/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Robolectric reads the manifest that the Android Gradle plugin merged for this build
 * (android_merged_manifest in the generated com.android.tools.test_config.properties),
 * so these assertions cover what the app actually ships, not just what
 * android/app/src/main/AndroidManifest.xml says. A library that re-introduces an
 * initializer through its own manifest would be caught here.
 */
@RunWith(RobolectricTestRunner::class)
class StartupInitializerTest {
  private val startupProviderClass = "androidx.startup.InitializationProvider"
  private val emojiInitializer = "androidx.emoji2.text.EmojiCompatInitializer"

  private fun startupMetaData(): android.os.Bundle {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val component = ComponentName(context, startupProviderClass)
    val providerInfo = context.packageManager.getProviderInfo(component, PackageManager.GET_META_DATA)
    val metaData = providerInfo.metaData
    assertNotNull(
      "$startupProviderClass carries no meta-data in the merged manifest; the assertions below " +
        "would pass for the wrong reason",
      metaData,
    )
    return metaData
  }

  @Test
  fun `the merged manifest does not register the emoji2 startup initializer`() {
    // androidx.emoji2's EmojiCompatInitializer resolves its font through the Google Play
    // Services downloadable-font content provider. That makes the app process a
    // content-provider client of Play Services, and ActivityManager kills a client when
    // the process hosting the provider dies. It also puts a Play Services dependency into
    // an app that must run on devices without Play Services. The app renders all of its
    // text in a WebView, so EmojiCompat changes nothing the user sees.
    assertFalse(
      "$emojiInitializer is registered under $startupProviderClass. It binds the app to the " +
        "Google Play Services fonts provider at startup. Remove it with tools:node=\"remove\" " +
        "in both AndroidManifest.xml and AndroidManifest.no-background.xml.",
      startupMetaData().containsKey(emojiInitializer),
    )
  }

  @Test
  fun `removing the emoji2 initializer leaves the other startup initializers in place`() {
    // tools:node="remove" on one meta-data entry must not take the whole provider, or the
    // process-lifecycle owner the Capacitor plugins rely on would disappear with it.
    assertTrue(
      "androidx.lifecycle.ProcessLifecycleInitializer is no longer registered under " +
        "$startupProviderClass; the emoji2 removal took more than it should have",
      startupMetaData().containsKey("androidx.lifecycle.ProcessLifecycleInitializer"),
    )
  }
}
