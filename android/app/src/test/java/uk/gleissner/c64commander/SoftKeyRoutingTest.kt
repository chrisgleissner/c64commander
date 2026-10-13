/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.view.InputDevice
import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SoftKeyRoutingTest {
  private val router = SoftKeyRouter()
  private val dispatched = mutableListOf<KeyEvent>()
  private val scripts = mutableListOf<String>()

  private fun route(event: KeyEvent, editingText: Boolean): Boolean =
    router.route(
      event,
      editingText = { editingText },
      dispatch = { dispatched += it; true },
      runScript = { scripts += it },
    )

  @Test
  fun sendsOkOnAsARealEnterWhileATextFieldIsBeingEdited() {
    route(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER), editingText = true)
    route(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER), editingText = true)

    assertEquals(listOf(KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_ENTER), dispatched.map { it.keyCode })
    assertEquals(listOf(KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP), dispatched.map { it.action })
    assertTrue(scripts.isEmpty())
  }

  @Test
  fun keepsOnePressTheSameKeyWhenTheFieldLosesFocusBeforeTheKeyIsReleased() {
    route(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER), editingText = true)
    route(KeyEvent(0, 0, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, 1), editingText = false)
    route(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER), editingText = false)

    assertEquals(List(3) { KeyEvent.KEYCODE_ENTER }, dispatched.map { it.keyCode })
  }

  @Test
  fun keepsOnePressTheSameKeyWhenAFieldTakesFocusBeforeTheKeyIsReleased() {
    route(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER), editingText = false)
    route(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER), editingText = true)

    assertEquals(List(2) { KeyEvent.KEYCODE_DPAD_CENTER }, dispatched.map { it.keyCode })
  }

  @Test
  fun decidesAfreshForARepeatThatArrivesAfterThePressWasForgotten() {
    route(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER), editingText = true)
    router.reset()
    route(KeyEvent(0, 0, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, 3), editingText = false)

    assertEquals(listOf(KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DPAD_CENTER), dispatched.map { it.keyCode })
  }

  @Test
  fun decidesForARepeatWhoseFirstDownEventNeverArrived() {
    route(KeyEvent(0, 0, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, 2), editingText = true)

    assertEquals(KeyEvent.KEYCODE_ENTER, dispatched.single().keyCode)
  }

  @Test
  fun leavesOkAloneOutsideTextFields() {
    val ok = KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER)

    route(ok, editingText = false)

    assertSame(ok, dispatched.single())
  }

  @Test
  fun forwardsASoftKeyToThePageOnceOnKeyDownAndConsumesBothHalves() {
    assertTrue(route(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_SOFT_RIGHT), editingText = true))
    assertTrue(route(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_SOFT_RIGHT), editingText = true))

    assertEquals(1, scripts.size)
    assertTrue(scripts.single().contains("code:'SoftRight'"))
    assertTrue(dispatched.isEmpty())
  }

  private fun keypadKey(action: Int, keyCode: Int, scanCode: Int) =
    KeyEvent(0, 0, action, keyCode, 0, 0, 1, scanCode, 0, InputDevice.SOURCE_KEYBOARD)

  private fun routeFrom(keypad: Boolean, event: KeyEvent): Boolean =
    SoftKeyRouter(fromHardwareKeypad = { keypad }).route(
      event,
      editingText = { false },
      dispatch = { dispatched += it; true },
      runScript = { scripts += it },
    )

  @Test
  fun sendsAKeypadLeftSoftKeyReportedAsMenuOnAsBack() {
    routeFrom(keypad = true, keypadKey(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MENU, 139))
    routeFrom(keypad = true, keypadKey(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MENU, 139))

    assertEquals(listOf(KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_BACK), dispatched.map { it.keyCode })
    assertEquals(listOf(KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP), dispatched.map { it.action })
    assertTrue(scripts.isEmpty())
  }

  @Test
  fun forwardsAKeypadRightSoftKeyReportedAsBackAsSoftRightAndConsumesIt() {
    assertTrue(routeFrom(keypad = true, keypadKey(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK, 158)))
    assertTrue(routeFrom(keypad = true, keypadKey(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK, 158)))

    assertTrue(scripts.single().contains("code:'SoftRight'"))
    assertTrue(dispatched.isEmpty())
  }

  @Test
  fun leavesBackAndMenuAloneWhenTheyDoNotComeFromAKeypad() {
    val gestureBack = keypadKey(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_BACK, 158)
    routeFrom(keypad = false, gestureBack)
    routeFrom(keypad = false, keypadKey(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MENU, 139))

    assertSame(gestureBack, dispatched.single())
    assertTrue(scripts.single().contains("code:'ContextMenu'"))
  }

  @Test
  fun leavesAKeypadMenuKeyWithAnotherScanCodeAsTheMenuKey() {
    routeFrom(keypad = true, keypadKey(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MENU, 127))

    assertTrue(dispatched.isEmpty())
    assertTrue(scripts.single().contains("code:'ContextMenu'"))
  }

  @Test
  fun treatsOnlyABuiltInDeviceWithADpadAsTheKeypad() {
    assertTrue(isBuiltInKeypad(isVirtual = false, isExternal = false, hasDpad = true))
    // A Bluetooth keyboard or air-mouse remote with Menu and Back keys and arrow keys.
    assertEquals(false, isBuiltInKeypad(isVirtual = false, isExternal = true, hasDpad = true))
    // The navigation-bar Back gesture.
    assertEquals(false, isBuiltInKeypad(isVirtual = true, isExternal = false, hasDpad = false))
    // Capacitive hardware Back and Menu keys, with no D-pad.
    assertEquals(false, isBuiltInKeypad(isVirtual = false, isExternal = false, hasDpad = false))
  }
}

