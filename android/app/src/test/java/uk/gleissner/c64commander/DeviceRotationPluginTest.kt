/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import android.view.OrientationEventListener
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginMethod
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner

/** Test-only subclass that captures the events the plugin publishes. */
private class TestableDeviceRotationPlugin : DeviceRotationPlugin() {
  val published = mutableListOf<Int>()

  public override fun notifyListeners(eventName: String?, data: JSObject?) {
    if (eventName == ROTATION_EVENT) published.add(data?.getInteger("rotation") ?: -1)
  }
}

@RunWith(RobolectricTestRunner::class)
class DeviceRotationPluginTest {
  private lateinit var plugin: TestableDeviceRotationPlugin

  @Before
  fun setUp() {
    val context: Context = ApplicationProvider.getApplicationContext()
    plugin = TestableDeviceRotationPlugin()
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(context)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(plugin, bridge)
  }

  @Test
  fun quantisesEachSettledAngleToItsSector() {
    assertEquals(0, DeviceRotationPlugin.quantiseRotation(0, 0))
    assertEquals(90, DeviceRotationPlugin.quantiseRotation(92, 180))
    assertEquals(180, DeviceRotationPlugin.quantiseRotation(178, 0))
    assertEquals(270, DeviceRotationPlugin.quantiseRotation(268, 90))
    assertEquals(0, DeviceRotationPlugin.quantiseRotation(358, 180))
  }

  @Test
  fun holdsThePreviousValueTenDegreesPastABoundary() {
    assertEquals(0, DeviceRotationPlugin.quantiseRotation(55, 0))
    assertEquals(90, DeviceRotationPlugin.quantiseRotation(35, 90))
    assertEquals(0, DeviceRotationPlugin.quantiseRotation(305, 0))
  }

  @Test
  fun switchesTwentyFiveDegreesPastABoundary() {
    assertEquals(90, DeviceRotationPlugin.quantiseRotation(70, 0))
    assertEquals(0, DeviceRotationPlugin.quantiseRotation(20, 90))
    assertEquals(270, DeviceRotationPlugin.quantiseRotation(290, 0))
  }

  @Test
  fun holdsThePreviousValueWhileTheHandsetIsFlat() {
    assertEquals(90, DeviceRotationPlugin.quantiseRotation(OrientationEventListener.ORIENTATION_UNKNOWN, 90))
    assertEquals(270, DeviceRotationPlugin.quantiseRotation(OrientationEventListener.ORIENTATION_UNKNOWN, 270))
  }

  @Test
  fun publishesOnlyOnAChange() {
    plugin.onOrientationDegrees(0)
    plugin.onOrientationDegrees(5)
    plugin.onOrientationDegrees(355)
    assertTrue("An unchanged orientation must not be published", plugin.published.isEmpty())

    plugin.onOrientationDegrees(90)
    plugin.onOrientationDegrees(92)
    assertEquals(listOf(90), plugin.published)

    plugin.onOrientationDegrees(180)
    assertEquals(listOf(90, 180), plugin.published)
  }

  @Test
  fun neverPublishesWhileTheHandsetIsFlat() {
    plugin.onOrientationDegrees(90)
    plugin.published.clear()
    plugin.onOrientationDegrees(OrientationEventListener.ORIENTATION_UNKNOWN)
    assertTrue(plugin.published.isEmpty())
    assertEquals(90, plugin.publishedRotation)
  }

  @Test
  fun currentReportsTheLastPublishedRotation() {
    plugin.onOrientationDegrees(270)
    val call = mock(com.getcapacitor.PluginCall::class.java)
    plugin.current(call)
    org.mockito.Mockito.verify(call).resolve(org.mockito.ArgumentMatchers.any(JSObject::class.java))
    assertEquals(270, plugin.publishedRotation)
  }

  /**
   * Capacitor discovers plugin methods by reflecting over `getMethods()` and reading the
   * [PluginMethod] annotation off each one. Java method annotations are not inherited, so an
   * override of `addListener` that forgot to re-declare it would silently stop the bridge
   * routing `addListener` to this plugin — and the rotation events would simply never arrive.
   */
  @Test
  fun listenerSubscriptionMethodsStayExportedAcrossTheOverride() {
    listOf("addListener", "removeListener", "removeAllListeners").forEach { name ->
      val method = DeviceRotationPlugin::class.java.methods.first { it.name == name && it.parameterCount == 1 }
      assertNotNull("$name must stay annotated with @PluginMethod", method.getAnnotation(PluginMethod::class.java))
    }
  }
}
