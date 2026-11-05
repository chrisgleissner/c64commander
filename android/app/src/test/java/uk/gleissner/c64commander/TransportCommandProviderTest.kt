/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import java.time.Duration
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowSystemClock

@RunWith(RobolectricTestRunner::class)
class TransportCommandProviderTest {
  private val context = ApplicationProvider.getApplicationContext<Context>()

  @After fun reset() = ForegroundPresence.reset()

  private fun provider(signedAlike: Boolean = true): TransportCommandProvider =
    Robolectric.buildContentProvider(
        if (signedAlike) TransportCommandProviderTest.SignedAlike::class.java
        else TransportCommandProviderTest.SignedDifferently::class.java,
      )
      .create()
      .get()

  private fun sentTransportCommands() =
    shadowOf(context as android.app.Application).broadcastIntents
      .filter { it.action == BackgroundExecutionService.ACTION_TRANSPORT_COMMAND }
      .map { it.`package` to it.getStringExtra(BackgroundExecutionService.EXTRA_TRANSPORT_COMMAND) }

  @Test
  fun nextIsRelayedToThisAppAsTheMediaButtonNextCommand() {
    provider().call(TransportCommandProvider.METHOD_NEXT, null, null)

    assertEquals(listOf(context.packageName to BackgroundExecutionService.TRANSPORT_COMMAND_NEXT), sentTransportCommands())
  }

  @Test
  fun previousIsRelayedToThisAppAsTheMediaButtonPreviousCommand() {
    provider().call(TransportCommandProvider.METHOD_PREVIOUS, null, null)

    assertEquals(
      listOf(context.packageName to BackgroundExecutionService.TRANSPORT_COMMAND_PREVIOUS),
      sentTransportCommands(),
    )
  }

  @Test
  fun theReplySaysTheAppWasInFrontWhenItWasJustPausedByTheCompanion() {
    ForegroundPresence.onResumed()
    ForegroundPresence.onPaused(SystemClock.elapsedRealtime())

    val reply = provider().call(TransportCommandProvider.METHOD_NEXT, null, null)

    assertTrue(reply.getBoolean(TransportCommandProvider.RESULT_WAS_IN_FRONT))
  }

  @Test
  fun aBurstOfPressesWhileTheCompanionCoversTheAppIsAnsweredInFrontThroughout() {
    ForegroundPresence.onResumed()
    ForegroundPresence.onPaused(SystemClock.elapsedRealtime())
    val step = Duration.ofMillis(ForegroundPresence.RECENT_MS - 500)

    val replies =
      List(3) {
        ShadowSystemClock.advanceBy(step)
        provider().call(TransportCommandProvider.METHOD_PREVIOUS, null, null).getBoolean(
          TransportCommandProvider.RESULT_WAS_IN_FRONT,
        )
      }

    assertEquals(listOf(true, true, true), replies)
  }

  @Test
  fun theReplySaysTheAppWasNotInFrontWhenTheUserWasElsewhere() {
    val reply = provider().call(TransportCommandProvider.METHOD_NEXT, null, null)

    assertFalse(reply.getBoolean(TransportCommandProvider.RESULT_WAS_IN_FRONT))
  }

  @Test
  fun aCallerSignedDifferentlyIsRefusedAndNothingIsRelayed() {
    assertThrows(SecurityException::class.java) {
      provider(signedAlike = false).call(TransportCommandProvider.METHOD_NEXT, null, null)
    }
    assertEquals(emptyList<Any>(), sentTransportCommands())
  }

  @Test
  fun anUnknownCommandIsRejected() {
    assertThrows(IllegalArgumentException::class.java) { provider().call("eject", null, null) }
    assertEquals(emptyList<Any>(), sentTransportCommands())
  }

  @Test
  fun theAppItselfPassesTheSignatureCheck() {
    assertTrue(Robolectric.buildContentProvider(TransportCommandProvider::class.java).create().get().callerSharesSignature())
  }

  class SignedAlike : TransportCommandProvider() {
    override fun callerSharesSignature() = true
  }

  class SignedDifferently : TransportCommandProvider() {
    override fun callerSharesSignature() = false
  }
}
