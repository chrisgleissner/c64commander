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
}

/**
 * Routes key events from the activity. [dispatch] is the normal view dispatch, [runScript]
 * evaluates JavaScript in the page, and [editingText] says whether a text field in the WebView has
 * the input method.
 *
 * OK arrives as D-pad Center, which the WebView keeps for itself while a text field has focus: the
 * page never learned that OK was pressed. It goes on as a real Enter instead, so the page gets a
 * trusted keydown and a form still submits on it. The choice is made once per press, on its first
 * down event, so the press's repeats and its up event are the same key as its down event.
 */
class SoftKeyRouter(private val fromHardwareKeypad: (KeyEvent) -> Boolean = ::isFromHardwareKeypad) {
  private var okPressInProgress = false
  private var okPressGoesOnAsEnter = false

  /**
   * Forgets the press in progress, for when the window loses focus and its down events may stop
   * arriving. The next down event decides afresh; an up event that still arrives keeps its pair.
   */
  fun reset() {
    okPressInProgress = false
  }

  fun route(
    event: KeyEvent,
    editingText: () -> Boolean,
    dispatch: (KeyEvent) -> Boolean,
    runScript: (String) -> Unit,
  ): Boolean {
    if (isKeypadSoftKey(event, KeyEvent.KEYCODE_MENU, LINUX_KEY_MENU)) {
      return dispatch(withKeyCode(event, KeyEvent.KEYCODE_BACK))
    }
    if (isKeypadSoftKey(event, KeyEvent.KEYCODE_BACK, LINUX_KEY_BACK)) {
      if (event.action == KeyEvent.ACTION_DOWN) {
        runScript(SoftKeyForwarder.keydownScript(SOFT_RIGHT, event.repeatCount > 0))
      }
      return true
    }
    if (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER) {
      if (event.action == KeyEvent.ACTION_DOWN && (event.repeatCount == 0 || !okPressInProgress)) {
        okPressInProgress = true
        okPressGoesOnAsEnter = editingText()
      }
      val sendAsEnter = okPressGoesOnAsEnter
      if (event.action == KeyEvent.ACTION_UP) reset()
      return dispatch(if (sendAsEnter) withKeyCode(event, KeyEvent.KEYCODE_ENTER) else event)
    }
    val domCode = SoftKeyForwarder.domCodeFor(event.keyCode) ?: return dispatch(event)
    if (event.action == KeyEvent.ACTION_DOWN) {
      runScript(SoftKeyForwarder.keydownScript(domCode, event.repeatCount > 0))
    }
    return true
  }

  /**
   * Some keypads report their two soft keys as the Linux Menu and Back keys instead of as the
   * Android soft keys. Their left key is the keypad bar's Back and their right key its Menu, the
   * opposite of what Menu and Back mean to Android, so they are swapped back here. The scan code
   * and the device keep a navigation-bar Back gesture and a keyboard's Menu key as they are.
   */
  private fun isKeypadSoftKey(event: KeyEvent, keyCode: Int, scanCode: Int): Boolean =
    event.keyCode == keyCode && event.scanCode == scanCode && fromHardwareKeypad(event)

  private fun withKeyCode(event: KeyEvent, keyCode: Int): KeyEvent =
    KeyEvent(
      event.downTime,
      event.eventTime,
      event.action,
      keyCode,
      event.repeatCount,
      event.metaState,
      event.deviceId,
      event.scanCode,
      event.flags,
      event.source,
    )
}

private const val LINUX_KEY_MENU = 139
private const val LINUX_KEY_BACK = 158
private const val SOFT_RIGHT = "SoftRight"

/** A key from a physical input device that also has a D-pad, as a keypad handset's keys do. */
internal fun isFromHardwareKeypad(event: KeyEvent): Boolean {
  val device = event.device ?: return false
  return !device.isVirtual && device.hasKeys(KeyEvent.KEYCODE_DPAD_UP).firstOrNull() == true
}
