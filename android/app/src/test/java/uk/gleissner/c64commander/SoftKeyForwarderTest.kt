/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.view.KeyEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SoftKeyForwarderTest {
  @Test
  fun forwardsTheSoftKeysAndMenuWithTheCodesTheKeypadKeymapBinds() {
    assertEquals("SoftLeft", SoftKeyForwarder.domCodeFor(KeyEvent.KEYCODE_SOFT_LEFT))
    assertEquals("SoftRight", SoftKeyForwarder.domCodeFor(KeyEvent.KEYCODE_SOFT_RIGHT))
    assertEquals("ContextMenu", SoftKeyForwarder.domCodeFor(KeyEvent.KEYCODE_MENU))
  }

  @Test
  fun keepsTheCallKeyInTheAppInsteadOfLettingAndroidOpenTheDialer() {
    assertEquals("Call", SoftKeyForwarder.domCodeFor(KeyEvent.KEYCODE_CALL))
  }

  @Test
  fun leavesKeysTheWebViewDeliversItselfAlone() {
    assertNull(SoftKeyForwarder.domCodeFor(KeyEvent.KEYCODE_DPAD_CENTER))
    assertNull(SoftKeyForwarder.domCodeFor(KeyEvent.KEYCODE_BACK))
    assertNull(SoftKeyForwarder.domCodeFor(KeyEvent.KEYCODE_5))
  }

  @Test
  fun dispatchesAKeydownAtTheFocusedElementWithTheCodeAndRepeatFlag() {
    val script = SoftKeyForwarder.keydownScript("SoftLeft", true)

    assertTrue(script.contains("document.activeElement||document"))
    assertTrue(script.contains("code:'SoftLeft'"))
    assertTrue(script.contains("repeat:true"))
  }
}
