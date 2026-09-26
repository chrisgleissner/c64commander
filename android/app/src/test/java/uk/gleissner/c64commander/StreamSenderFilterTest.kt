/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StreamSenderFilterTest {
  private val wifiAddress = InetAddress.getByAddress(byteArrayOf(192.toByte(), 0, 2, 46))
  private val ethernetAddress = InetAddress.getByAddress(byteArrayOf(192.toByte(), 0, 2, 47))

  @Test
  fun aSlowLookupForAnEarlierTargetDoesNotReplaceTheSenderAdoptedSince() {
    val slowLookupMayFinish = CountDownLatch(1)
    val finished = CountDownLatch(2)
    val filter =
      StreamSenderFilter(
        resolve = { host ->
          if (host == "ultimate.example") {
            slowLookupMayFinish.await(5, TimeUnit.SECONDS)
            wifiAddress
          } else {
            InetAddress.getByName(host)
          }
        },
        runInBackground = { task -> Thread { task.run(); finished.countDown() }.start() },
        logEvery = 1000,
      )

    filter.retarget("audio", "ultimate.example")
    filter.retarget("audio", "192.0.2.47")
    Thread.sleep(100)
    slowLookupMayFinish.countDown()
    assertTrue(finished.await(5, TimeUnit.SECONDS))

    assertEquals(ethernetAddress, filter.expectedSource("audio"))
    assertFalse(filter.isForeign("audio", ethernetAddress))
    assertTrue(filter.isForeign("audio", wifiAddress))
  }

  @Test
  fun clearingTheTargetAcceptsEverySenderAndIgnoresALookupStillRunning() {
    val lookupMayFinish = CountDownLatch(1)
    val finished = CountDownLatch(1)
    val filter =
      StreamSenderFilter(
        resolve = { lookupMayFinish.await(5, TimeUnit.SECONDS); wifiAddress },
        runInBackground = { task -> Thread { task.run(); finished.countDown() }.start() },
        logEvery = 1000,
      )

    filter.retarget("video", "ultimate.example")
    filter.retarget("video", null)
    lookupMayFinish.countDown()
    assertTrue(finished.await(5, TimeUnit.SECONDS))

    assertNull(filter.expectedSource("video"))
    assertFalse(filter.isForeign("video", ethernetAddress))
  }

  @Test
  fun countsAndNamesTheRefusedSenderUntilRetargeted() {
    val filter = StreamSenderFilter(resolve = { wifiAddress }, runInBackground = { it.run() }, logEvery = 1000)
    filter.retarget("audio", "192.0.2.46")

    filter.isForeign("audio", ethernetAddress)
    filter.isForeign("audio", ethernetAddress)

    assertEquals(2L, filter.rejectedPackets("audio"))
    assertEquals(ethernetAddress, filter.lastRejectedSource("audio"))
    filter.retarget("audio", "192.0.2.47")
    assertEquals(0L, filter.rejectedPackets("audio"))
    assertNull(filter.lastRejectedSource("audio"))
  }
}
