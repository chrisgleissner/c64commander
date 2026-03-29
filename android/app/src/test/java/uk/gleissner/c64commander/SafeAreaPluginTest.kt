/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.view.View
import android.view.Window
import androidx.appcompat.app.AppCompatActivity
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.doReturn
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify

class SafeAreaPluginTest {
  private lateinit var plugin: SafeAreaPlugin

  @Before
  fun setUp() {
    plugin = SafeAreaPlugin()
  }

  private fun setPluginBridge(target: SafeAreaPlugin, activity: AppCompatActivity?) {
    val bridge = mock(Bridge::class.java)
    doReturn(activity).`when`(bridge).activity
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }

  @Test
  fun getInsetsRejectsWhenActivityIsUnavailable() {
    setPluginBridge(plugin, null)
    val call = mock(PluginCall::class.java)

    plugin.getInsets(call)

    verify(call).reject("Activity unavailable")
  }

  @Test
  fun getInsetsRejectsWhenDecorViewIsUnavailable() {
    val activity = mock(AppCompatActivity::class.java)
    val window = mock(Window::class.java)
    doReturn(window).`when`(activity).window
    doReturn(null as View?).`when`(window).decorView
    setPluginBridge(plugin, activity)
    val call = mock(PluginCall::class.java)

    plugin.getInsets(call)

    verify(call).reject("Window decor view unavailable")
  }

  @Test
  fun getInsetsResolvesZeroInsetsWhenRootInsetsAreUnavailable() {
    val activity = mock(AppCompatActivity::class.java)
    val window = mock(Window::class.java)
    val decorView = mock(View::class.java)
    doReturn(window).`when`(activity).window
    doReturn(decorView).`when`(window).decorView
    setPluginBridge(plugin, activity)
    val call = mock(PluginCall::class.java)
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(org.mockito.Mockito.any())

    plugin.getInsets(call)

    assertNotNull(resolved)
    assertEquals(0, resolved?.getInteger("top"))
    assertEquals(0, resolved?.getInteger("right"))
    assertEquals(0, resolved?.getInteger("bottom"))
    assertEquals(0, resolved?.getInteger("left"))
  }
}
