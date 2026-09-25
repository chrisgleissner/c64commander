/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.view.KeyEvent

/**
 * Keypad keys the WebView cannot deliver to the page itself.
 *
 * Chromium hands the soft keys to the page as `key: "Unidentified"` with no key code, so no
 * keymap binding can tell them apart, and it does not deliver the Menu key at all. The green
 * Call key never reaches the page either: left unconsumed, Android opens the dialer and the app
 * goes to the background. They are forwarded as keydown events carrying the DOM `code` the
 * keypad keymap binds.
 */
object SoftKeyForwarder {
  private val DOM_CODES =
    mapOf(
      KeyEvent.KEYCODE_SOFT_LEFT to "SoftLeft",
      KeyEvent.KEYCODE_SOFT_RIGHT to "SoftRight",
      KeyEvent.KEYCODE_MENU to "ContextMenu",
      KeyEvent.KEYCODE_CALL to "Call",
    )

  fun domCodeFor(keyCode: Int): String? = DOM_CODES[keyCode]

  /**
   * OK while a text field is being edited. The WebView keeps D-pad Center for itself there, so the
   * page never learned that OK was pressed and a keypad user had no OK in any text field. It is
   * forwarded as Enter, which is what OK means to a field, with the D-pad code the keymap binds.
   */
  fun editingKeyFor(keyCode: Int): Pair<String, String>? =
    if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER) "Enter" to "DpadCenter" else null

  fun keydownScript(domCode: String, repeat: Boolean): String = keydownScript(domCode, domCode, repeat)

  fun keydownScript(key: String, domCode: String, repeat: Boolean): String =
    "(function(){var t=document.activeElement||document;" +
      "t.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true," +
      "key:'$key',code:'$domCode',repeat:$repeat}));})()"
}
