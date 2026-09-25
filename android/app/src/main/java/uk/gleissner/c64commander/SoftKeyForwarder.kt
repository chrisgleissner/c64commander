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

  fun keydownScript(domCode: String, repeat: Boolean): String =
    "(function(){var t=document.activeElement||document;" +
      "t.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,cancelable:true," +
      "key:'$domCode',code:'$domCode',repeat:$repeat}));})()"

  /**
   * Routes one key event from the activity. [dispatch] is the normal view dispatch, [runScript]
   * evaluates JavaScript in the page, and [editingText] says whether a text field in the WebView
   * has the input method.
   *
   * OK arrives as D-pad Center, which the WebView keeps for itself while a text field has focus:
   * the page never learned that OK was pressed. It goes on as a real Enter instead, so the page
   * gets a trusted keydown and a form still submits on it.
   */
  fun route(
    event: KeyEvent,
    editingText: () -> Boolean,
    dispatch: (KeyEvent) -> Boolean,
    runScript: (String) -> Unit,
  ): Boolean {
    if (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER && editingText()) {
      return dispatch(asEnter(event))
    }
    val domCode = domCodeFor(event.keyCode) ?: return dispatch(event)
    if (event.action == KeyEvent.ACTION_DOWN) runScript(keydownScript(domCode, event.repeatCount > 0))
    return true
  }

  private fun asEnter(event: KeyEvent): KeyEvent =
    KeyEvent(
      event.downTime,
      event.eventTime,
      event.action,
      KeyEvent.KEYCODE_ENTER,
      event.repeatCount,
      event.metaState,
      event.deviceId,
      event.scanCode,
      event.flags,
      event.source,
    )
}
