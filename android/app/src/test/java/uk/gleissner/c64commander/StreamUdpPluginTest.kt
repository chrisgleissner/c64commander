/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import android.media.AudioManager
import android.net.wifi.WifiManager
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.verify
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class StreamUdpPluginTest {
  private lateinit var plugin: StreamUdpPlugin
  private lateinit var context: Context
  private val received = ArrayList<Triple<String, String, Double>>()
  private val frames = ArrayList<AssembledFrame>()
  private lateinit var latch: CountDownLatch

  private data class AssembledFrame(
    val name: String,
    val data: String,
    val arrivalMs: Double,
    val height: Int,
    val dropped: Int,
    val lost: Int,
    val present: Boolean,
  )

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    plugin = StreamUdpPlugin()
    injectBridge(plugin, context)
    received.clear()
    frames.clear()
    latch = CountDownLatch(1)
    plugin.clockNanos = { FIXED_CLOCK_NANOS }
    plugin.emitDatagram = { name, data, arrivalMs ->
      received.add(Triple(name, data, arrivalMs))
      latch.countDown()
    }
    plugin.emitFrame = { name, data, arrivalMs, height, dropped, lost, present ->
      frames.add(AssembledFrame(name, data, arrivalMs, height, dropped, lost, present))
      latch.countDown()
    }
  }

  /** Send one minimal 2-packet VIC frame (line 0, then last-line at line 4) for frame-count/loss tests. */
  private fun sendFrame(sender: DatagramSocket, addr: InetAddress, port: Int, seq: Int, frameNum: Int) {
    val p0 = vicPacket(seq = seq, frame = frameNum, line = 0, lastLine = false)
    val p1 = vicPacket(seq = seq + 1, frame = frameNum, line = 4, lastLine = true)
    sender.send(DatagramPacket(p0, p0.size, addr, port))
    sender.send(DatagramPacket(p1, p1.size, addr, port))
  }

  /** Bind the plugin in assemble mode on an ephemeral port and return that port. */
  private fun bindAssemble(): Int {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn("video")
    `when`(call.getInt("port")).thenReturn(0)
    `when`(call.getBoolean("assemble", false)).thenReturn(true)
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())
    plugin.bind(call)
    return resolved!!.getInteger("port")!!
  }

  /** A single VIC datagram: 12-byte little-endian header + 192-byte (all-black) payload. */
  private fun vicPacket(seq: Int, frame: Int, line: Int, lastLine: Boolean): ByteArray {
    val packet = ByteArray(12 + 192)
    fun putU16(index: Int, value: Int) {
      packet[index] = (value and 0xFF).toByte()
      packet[index + 1] = ((value shr 8) and 0xFF).toByte()
    }
    putU16(0, seq and 0xFFFF)
    putU16(2, frame and 0xFFFF)
    putU16(4, (line and 0x7FFF) or (if (lastLine) 0x8000 else 0))
    putU16(6, 384) // width
    packet[8] = 4 // linesPerPacket
    packet[9] = 4 // bpp
    putU16(10, 0) // enc
    return packet
  }

  companion object {
    // A deterministic, non-trivial clock value (≠ 0, ≠ wall time) so the timestamp assertion is exact.
    private const val FIXED_CLOCK_NANOS = 123_456_000_000L
  }

  @Test
  fun bindRejectsMissingName() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn(null)
    plugin.bind(call)
    verify(call).reject("name is required")
  }

  @Test
  fun bindRejectsMissingPort() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn("video")
    `when`(call.getInt("port")).thenReturn(null)
    plugin.bind(call)
    verify(call).reject("port is required")
  }

  @Test
  fun bindBindsAPortAndForwardsAReceivedDatagram() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn("video")
    `when`(call.getInt("port")).thenReturn(0) // ephemeral
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.bind(call)
    verify(call).resolve(any())
    assertNotNull(resolved)
    val port = resolved!!.getInteger("port")!!
    assertTrue("expected an OS-assigned port", port > 0)

    // Send a datagram to the bound port; the plugin must forward it base64-encoded.
    val payload = byteArrayOf(0x01, 0x08, 0x0c, 0x7f)
    DatagramSocket().use { sender ->
      sender.send(DatagramPacket(payload, payload.size, InetAddress.getByName("127.0.0.1"), port))
    }

    assertTrue("no datagram received", latch.await(3, TimeUnit.SECONDS))
    assertEquals(1, received.size)
    assertEquals("video", received[0].first)
    assertEquals(Base64.encodeToString(payload, Base64.NO_WRAP), received[0].second)
    // The clock read at socket receive is stamped and plumbed through unchanged (ns → ms). An
    // injected fixed clock makes this deterministic — a regression that dropped or altered the
    // stamp would fail here, not just on-device.
    assertEquals(FIXED_CLOCK_NANOS / 1_000_000.0, received[0].third, 0.0)

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("video")
    plugin.close(closeCall)
    verify(closeCall).resolve(any())
  }

  @Test
  fun assembleBindReassemblesDatagramsIntoOneVideoFrame() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn("video")
    `when`(call.getInt("port")).thenReturn(0) // ephemeral
    `when`(call.getBoolean("assemble", false)).thenReturn(true)
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.bind(call)
    verify(call).resolve(any())
    val port = resolved!!.getInteger("port")!!
    assertTrue("expected an OS-assigned port", port > 0)

    // Two per-line datagrams of frame 0: a mid line, then the last-line packet at line 268 (=> PAL 272).
    DatagramSocket().use { sender ->
      val addr = InetAddress.getByName("127.0.0.1")
      val p1 = vicPacket(seq = 1, frame = 0, line = 0, lastLine = false)
      val p2 = vicPacket(seq = 2, frame = 0, line = 268, lastLine = true)
      sender.send(DatagramPacket(p1, p1.size, addr, port))
      Thread.sleep(20) // keep ordering deterministic so the last-line packet completes the frame
      sender.send(DatagramPacket(p2, p2.size, addr, port))
    }

    assertTrue("no assembled frame received", latch.await(3, TimeUnit.SECONDS))
    // Per-packet datagrams are NOT emitted in assemble mode — only the whole frame.
    assertEquals(0, received.size)
    assertEquals(1, frames.size)
    val frame = frames[0]
    assertEquals("video", frame.name)
    assertEquals(272, frame.height) // line 268 + 4 lines/packet
    assertEquals(0, frame.dropped) // sequence 1,2 are consecutive
    // The payload decodes to a whole 52224-byte 4bpp PAL frame.
    assertEquals(52224, Base64.decode(frame.data, Base64.NO_WRAP).size)

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("video")
    plugin.close(closeCall)
    verify(closeCall).resolve(any())
  }

  @Test
  fun assembleBindDeliversEveryFrameOfASyntheticStreamWithoutLoss() {
    // Synthetic reproducible stream (the c64stream "test pattern + measure every frame arrives"
    // approach): send N consecutive frames and assert the native assembler emits exactly N frames,
    // in order, with ZERO frame loss.
    val frameCount = 30
    latch = CountDownLatch(frameCount)
    val port = bindAssemble()

    DatagramSocket().use { sender ->
      val addr = InetAddress.getByName("127.0.0.1")
      var seq = 0
      for (frameNum in 0 until frameCount) {
        sendFrame(sender, addr, port, seq, frameNum)
        seq += 2
        Thread.sleep(2) // keep the loopback socket from overflowing its receive buffer
      }
    }

    assertTrue("not all frames arrived", latch.await(5, TimeUnit.SECONDS))
    assertEquals(frameCount, frames.size)
    // Frames arrive in order 0..N-1 (the base64 payload encodes the frame number is not needed here —
    // the plugin's own frame accounting is what we verify).
    assertEquals(0, frames.last().lost) // NO frame lost
    assertEquals(0, frames.last().dropped) // NO packet dropped on loopback

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("video")
    plugin.close(closeCall)
  }

  @Test
  fun assembleBindDetectsALostFrameFromAFrameNumberGap() {
    // Send frames 0,1,2, then SKIP frame 3 entirely (simulating all its packets dropped), then 4.
    // The native assembler must detect the frame-number gap 2→4 as exactly one lost frame.
    latch = CountDownLatch(4) // frames 0,1,2,4 complete
    val port = bindAssemble()

    DatagramSocket().use { sender ->
      val addr = InetAddress.getByName("127.0.0.1")
      sendFrame(sender, addr, port, 0, 0)
      Thread.sleep(2)
      sendFrame(sender, addr, port, 2, 1)
      Thread.sleep(2)
      sendFrame(sender, addr, port, 4, 2)
      Thread.sleep(2)
      // frame 3 not sent
      sendFrame(sender, addr, port, 8, 4)
    }

    assertTrue("expected 4 completed frames", latch.await(5, TimeUnit.SECONDS))
    assertEquals(4, frames.size)
    assertEquals(1, frames.last().lost) // the missing frame 3 is counted as one lost frame

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("video")
    plugin.close(closeCall)
  }

  @Test
  fun assembleBindDoesNotOvercountLostFramesOnCrossFrameReorder() {
    // Regression: a benign UDP reorder must not inflate the user-visible frame-loss count. Send
    // frames 0,1, then frame 3 BEFORE frame 2 (a reorder — nothing was actually lost), then 2, then 4.
    // Advancing the loss baseline backward on the late frame 2 would make the next forward frame (4)
    // recompute an inflated gap and double-count. With the forward-only baseline, the count settles at
    // exactly 1 (the transient gap when 3 completed before 2) and never climbs to 2.
    latch = CountDownLatch(5) // frames 0,1,3,2,4 all complete
    val port = bindAssemble()

    DatagramSocket().use { sender ->
      val addr = InetAddress.getByName("127.0.0.1")
      sendFrame(sender, addr, port, 0, 0)
      Thread.sleep(3)
      sendFrame(sender, addr, port, 2, 1)
      Thread.sleep(3)
      sendFrame(sender, addr, port, 4, 3) // frame 3 arrives before frame 2 (reorder)
      Thread.sleep(3)
      sendFrame(sender, addr, port, 6, 2) // the late frame 2
      Thread.sleep(3)
      sendFrame(sender, addr, port, 8, 4)
    }

    assertTrue("expected 5 completed frames", latch.await(5, TimeUnit.SECONDS))
    assertEquals(5, frames.size)
    assertEquals(1, frames.last().lost) // NOT 2 — the reorder is not double-counted

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("video")
    plugin.close(closeCall)
  }

  @Test
  fun setKeepFractionDecimatesNativelyAndSkipsBase64ForUnpresentedFrames() {
    val port = bindAssemble()
    // Keep 50%: present every 2nd assembled frame; the others emit an event with NO base64 payload.
    val setCall = mock(PluginCall::class.java)
    `when`(setCall.getString("name")).thenReturn("video")
    `when`(setCall.getInt("permille")).thenReturn(500)
    plugin.setKeepFraction(setCall)
    verify(setCall).resolve(any())

    val n = 10
    latch = CountDownLatch(n) // EVERY assembled frame still emits an event (honest JS accounting)
    DatagramSocket().use { sender ->
      val addr = InetAddress.getByName("127.0.0.1")
      var seq = 0
      for (f in 0 until n) {
        sendFrame(sender, addr, port, seq, f)
        seq += 2
        Thread.sleep(3)
      }
    }

    assertTrue("not all frames emitted an event", latch.await(5, TimeUnit.SECONDS))
    assertEquals(n, frames.size)
    assertEquals(5, frames.count { it.present }) // exactly half presented at 50%
    assertEquals(5, frames.count { !it.present })
    // Presented frames carry a full 52224-byte 4bpp payload …
    assertTrue(frames.filter { it.present }.all { Base64.decode(it.data, Base64.NO_WRAP).size == 52224 })
    // … skipped frames carry NO base64 (the elided encode + bridge payload = the CPU win).
    assertTrue(frames.filter { !it.present }.all { it.data.isEmpty() })

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("video")
    plugin.close(closeCall)
  }

  @Test
  fun setKeepFractionRejectsMissingName() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn(null)
    plugin.setKeepFraction(call)
    verify(call).reject("name is required")
  }

  @Test
  fun bindJoinsAMulticastGroup() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn("video")
    `when`(call.getInt("port")).thenReturn(0)
    `when`(call.getString("group")).thenReturn("239.0.1.64")
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())

    plugin.bind(call)

    verify(call).resolve(any())
    assertNotNull(resolved)
    assertTrue(resolved!!.getInteger("port")!! > 0)

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("video")
    plugin.close(closeCall)
    verify(closeCall).resolve(any())
  }

  /**
   * HARD27-021. The JavaScript policy stops both streams when the app is hidden, but Android can
   * freeze the WebView before that stop reaches the device. The plugin must then drop the Wi-Fi
   * locks itself, and take them back on return: a MulticastLock released under a bound socket makes
   * the driver filter multicast again, so the stream would come back silent and black.
   */
  @Test
  fun pauseReleasesTheWifiLocksAndResumeReacquiresThemWhileASocketIsStillBound() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn("video")
    `when`(call.getInt("port")).thenReturn(0)
    `when`(call.getString("group")).thenReturn("239.0.1.64")
    doAnswer { null }.`when`(call).resolve(any())
    plugin.bind(call)
    assertTrue("bind should hold the multicast lock", multicastLockHeld())

    plugin.handleOnPause()
    assertFalse("a backgrounded app must not hold the multicast lock", multicastLockHeld())
    assertFalse("a backgrounded app must not hold the low-latency Wi-Fi lock", wifiLockHeld())

    plugin.handleOnResume()
    assertTrue("returning with a bound socket must re-join multicast", multicastLockHeld())

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("video")
    plugin.close(closeCall)
  }

  /** With no stream bound there is nothing to receive, so returning must not take a lock back. */
  @Test
  fun resumeDoesNotAcquireLocksWhenNoStreamIsBound() {
    plugin.handleOnPause()
    plugin.handleOnResume()

    assertFalse("no bound socket means no multicast lock", multicastLockHeld())
    assertFalse("no bound socket means no Wi-Fi lock", wifiLockHeld())
  }

  private fun lockHeld(fieldName: String): Boolean {
    val field = StreamUdpPlugin::class.java.getDeclaredField(fieldName)
    field.isAccessible = true
    return when (val lock = field.get(plugin)) {
      is WifiManager.MulticastLock -> lock.isHeld
      is WifiManager.WifiLock -> lock.isHeld
      else -> false
    }
  }

  private fun multicastLockHeld(): Boolean = lockHeld("multicastLock")

  private fun wifiLockHeld(): Boolean = lockHeld("wifiLock")

  @Test
  fun closeRejectsMissingName() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn(null)
    plugin.close(call)
    verify(call).reject("name is required")
  }

  /** Resolve a PluginCall, capturing the resolved JSObject. */
  @Test
  fun openAudioTrackTakesAudioFocusAndClosingGivesItBack() {
    // HARD27-006: neither audio source asked for focus. The A/V mirror never went near the
    // background service that did ask, so the C64's audio played on top of whatever the user had
    // started elsewhere. Focus belongs to the sink because the sink is what actually makes sound.
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val shadow = shadowOf(audio)

    plugin.openAudioTrack(resolvingCall { `when`(it.getInt("sampleRate")).thenReturn(47983) }.first)

    val request = shadow.lastAudioFocusRequest
    assertNotNull("opening the sink must request audio focus", request)
    assertEquals(AudioManager.AUDIOFOCUS_GAIN, request.durationHint)

    plugin.closeAudioTrack(resolvingCall {}.first)
    assertNotNull("closing the sink must abandon audio focus", shadow.lastAbandonedAudioFocusRequest)
  }

  @Test
  fun audioFocusChangesReachTheWebLayer() {
    // The web layer is where the two sources are told apart, so every change is forwarded there
    // rather than acted on natively. Ducking is the exception: it is an attenuation of the samples
    // this pipeline is about to play, and it is applied in the pipeline (see AudioPipelineTest).
    val changes = ArrayList<String>()
    plugin.emitAudioFocusChange = { changes.add(it) }
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val shadow = shadowOf(audio)
    plugin.openAudioTrack(resolvingCall { `when`(it.getInt("sampleRate")).thenReturn(47983) }.first)
    val listener = shadow.lastAudioFocusRequest.listener

    listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
    listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK)
    listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN)
    listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS)

    assertEquals(listOf("loss-transient", "duck", "gain", "loss"), changes)
    plugin.closeAudioTrack(resolvingCall {}.first)
  }

  @Test
  fun aResumeAfterAPermanentLossTakesAudioFocusBackForTheStillOpenTrack() {
    // HARD27-006, second cause. A pause does not close the sink, so the resume has no
    // openAudioTrack to take focus on. The plugin also kept audioFocusHeld true after the system
    // had taken focus away, which made any later request a no-op: the tune played on with no focus
    // and no callback for the next interruption.
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val shadow = shadowOf(audio)
    plugin.openAudioTrack(resolvingCall { `when`(it.getInt("sampleRate")).thenReturn(47983) }.first)
    val listener = shadow.lastAudioFocusRequest.listener
    listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS)

    // Whether the plugin really asked the system again is only visible in what the system answers,
    // so the next answer is made a refusal: a plugin that skipped the request would report the
    // focus it wrongly believed it still had.
    shadow.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_FAILED)
    val (refused, readRefused) = resolvingCall {}
    plugin.requestAudioFocus(refused)
    assertEquals(false, readRefused()?.getBool("granted"))

    shadow.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
    val (granted, readGranted) = resolvingCall {}
    plugin.requestAudioFocus(granted)
    assertEquals(true, readGranted()?.getBool("granted"))

    plugin.closeAudioTrack(resolvingCall {}.first)
  }

  private fun resolvingCall(configure: (PluginCall) -> Unit): Pair<PluginCall, () -> JSObject?> {
    val call = mock(PluginCall::class.java)
    configure(call)
    var resolved: JSObject? = null
    doAnswer { invocation ->
              resolved = invocation.getArgument(0) as JSObject
              null
            }
            .`when`(call)
            .resolve(any())
    return call to { resolved }
  }

  @Test
  fun openAudioTrackReportsSampleRateAndBufferCapacity() {
    val (call, resolved) = resolvingCall { `when`(it.getInt("sampleRate")).thenReturn(47983) }
    plugin.openAudioTrack(call)
    verify(call).resolve(any())
    assertEquals(47983, resolved()!!.getInteger("sampleRate"))
    // A real (or shadow) AudioTrack always reports a positive buffer capacity.
    assertTrue("expected a positive buffer capacity", resolved()!!.getDouble("bufferMs") > 0.0)

    plugin.closeAudioTrack(resolvingCall {}.first)
  }

  @Test
  fun writeAudioTrackReturnsBufferStatsForTheGovernor() {
    plugin.openAudioTrack(resolvingCall { `when`(it.getInt("sampleRate")).thenReturn(47983) }.first)

    // 4 stereo S16 frames of PCM (16 bytes), base64-framed as the JS sink sends it.
    val pcm = ByteArray(16) { it.toByte() }
    val (writeCall, resolvedWrite) =
        resolvingCall { `when`(it.getString("data")).thenReturn(Base64.encodeToString(pcm, Base64.NO_WRAP)) }
    plugin.writeAudioTrack(writeCall)
    verify(writeCall).resolve(any())
    // The governor reads these back each write: buffer depth (>= 0) + a non-negative underrun count.
    assertTrue(resolvedWrite()!!.getDouble("bufferedMs") >= 0.0)
    assertTrue(resolvedWrite()!!.getInteger("underruns")!! >= 0)

    plugin.closeAudioTrack(resolvingCall {}.first)
  }

  @Test
  fun writeAudioTrackRejectsMissingData() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("data")).thenReturn(null)
    plugin.writeAudioTrack(call)
    verify(call).reject("data is required")
  }

  @Test
  fun writeAudioTrackIsANoOpWhenNoTrackIsOpen() {
    // No openAudioTrack first: the write must resolve with zeroed stats, never crash.
    val (call, resolved) =
        resolvingCall { `when`(it.getString("data")).thenReturn(Base64.encodeToString(ByteArray(8), Base64.NO_WRAP)) }
    plugin.writeAudioTrack(call)
    verify(call).resolve(any())
    assertEquals(0.0, resolved()!!.getDouble("bufferedMs"), 0.0)
    assertEquals(0, resolved()!!.getInteger("underruns"))
  }

  @Test
  fun closeAudioTrackIsSafeWhenNoneOpen() {
    val (call, _) = resolvingCall {}
    plugin.closeAudioTrack(call)
    verify(call).resolve(any())
  }

  @Test
  fun readAudioStatsReturnsZeroWhenNoTrackOpen() {
    val (call, resolved) = resolvingCall {}
    plugin.readAudioStats(call)
    verify(call).resolve(any())
    assertEquals(0.0, resolved()!!.getDouble("bufferedMs"), 0.0)
    assertEquals(0, resolved()!!.getInteger("underruns"))
  }

  @Test
  fun audioReceiveLoopFeedsTheOpenAudioTrackNatively() {
    // With the native sink playing, the AUDIO receive thread feeds the AudioTrack directly and the
    // per-packet bridge hop is SKIPPED — ~250 base64 encodes + JSObject boxes + WebView crossings a
    // second that nobody was reading. So the packet must NOT surface as a datagram, while the feed
    // path still runs and stats stay readable.
    // (The buffered DEPTH can't be asserted under Robolectric: its ShadowAudioTrack.write does not
    // model buffering and returns 0 — that is exercised on real hardware by the HIL.)
    plugin.openAudioTrack(resolvingCall { `when`(it.getInt("sampleRate")).thenReturn(47983) }.first)

    val port = bindAudio()
    sendAudioPacket(port)

    assertFalse(
        "audio packet crossed the bridge even though the native sink owns playback",
        latch.await(1, TimeUnit.SECONDS))
    assertTrue("expected no datagram events", received.isEmpty())

    // Stats read is safe (>= 0, no crash) while the sink is fed natively.
    val (statsCall, statsResolved) = resolvingCall {}
    plugin.readAudioStats(statsCall)
    assertTrue(statsResolved()!!.getDouble("bufferedMs") >= 0.0)

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("audio")
    plugin.close(closeCall)
    plugin.closeAudioTrack(resolvingCall {}.first)
  }

  @Test
  fun audioPacketsReachJsAgainWhileAnalysisIsEnabled() {
    // The in-app diagnostics (A/V sync, the tone & colour ladder) measure the received stream in JS,
    // so they need the packets back. Without this the app would grade silence on Android and report
    // a fault that is really a missing feed. AvMirrorSession enables it while an audio subscriber
    // exists and disables it when the last one leaves, so the cost is paid only during a measurement.
    plugin.openAudioTrack(resolvingCall { `when`(it.getInt("sampleRate")).thenReturn(47983) }.first)
    plugin.setAudioAnalysis(resolvingCall { `when`(it.getBoolean("enabled", false)).thenReturn(true) }.first)

    val port = bindAudio()
    sendAudioPacket(port)

    assertTrue("audio packet was not forwarded while analysis was on", latch.await(3, TimeUnit.SECONDS))
    assertEquals(1, received.size)
    assertEquals("audio", received[0].first)

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("audio")
    plugin.close(closeCall)
    plugin.closeAudioTrack(resolvingCall {}.first)
  }

  /**
   * HARD27-005: a filter aimed at the wrong address receives at full rate and drops everything.
   *
   * That is silent in exactly the same way as a stream that stopped, so the only thing that can tell
   * the two apart is the plugin reporting what it refused and whose packets those were. Before this,
   * `rejectedPackets` was counted and written to logcat, and nothing reached JS at all.
   */
  @Test
  fun readStreamDiagnosticsNamesTheAddressWhosePacketsTheFilterRefused() {
    val (bindCall, bindResolved) =
        resolvingCall {
          `when`(it.getString("name")).thenReturn("video")
          `when`(it.getInt("port")).thenReturn(0)
          // 127.0.0.2 is a loopback address that resolves without DNS and is NOT the address the
          // test's sender socket will use, so every packet below is foreign.
          `when`(it.getString("source")).thenReturn("127.0.0.2")
        }
    plugin.bind(bindCall)
    val port = bindResolved()!!.getInteger("port")!!

    // The filter resolves off the caller's thread, so wait for it to be armed before sending.
    val armed = waitFor { diagnostics("video").getString("expectedSource") != null }
    assertTrue("the sender filter was never armed", armed)

    val payload = byteArrayOf(0x01, 0x02, 0x03, 0x04)
    DatagramSocket().use { sender ->
      repeat(3) { sender.send(DatagramPacket(payload, payload.size, InetAddress.getByName("127.0.0.1"), port)) }
    }

    val counted = waitFor { diagnostics("video").getInteger("rejectedPackets")!! >= 3 }
    val stats = diagnostics("video")
    assertTrue("expected the refused packets to be counted, got $stats", counted)
    assertEquals("127.0.0.1", stats.getString("lastRejectedSource"))
    assertEquals("127.0.0.2", stats.getString("expectedSource"))
    // Nothing was forwarded: the packets were dropped before any accounting, which is why the app
    // sees silence.
    assertEquals(0, received.size)

    // Adopting the sender that is actually streaming clears the diagnosis and reopens the filter.
    val adoptCall = mock(PluginCall::class.java)
    `when`(adoptCall.getString("name")).thenReturn("video")
    `when`(adoptCall.getString("host")).thenReturn("127.0.0.1")
    plugin.setExpectedSource(adoptCall)
    assertTrue(
        "adopting the sender must reset the rejection count",
        waitFor { diagnostics("video").getInteger("rejectedPackets") == 0 },
    )

    val closeCall = mock(PluginCall::class.java)
    `when`(closeCall.getString("name")).thenReturn("video")
    plugin.close(closeCall)
  }

  @Test
  fun readStreamDiagnosticsRejectsMissingName() {
    val call = mock(PluginCall::class.java)
    `when`(call.getString("name")).thenReturn(null)
    plugin.readStreamDiagnostics(call)
    verify(call).reject("name is required")
  }

  /** Read the plugin's sender-filter counters for one stream. */
  private fun diagnostics(name: String): JSObject {
    val (call, resolved) = resolvingCall { `when`(it.getString("name")).thenReturn(name) }
    plugin.readStreamDiagnostics(call)
    return resolved()!!
  }

  /** Poll a condition the plugin's own executor threads satisfy asynchronously. */
  private fun waitFor(timeoutMs: Long = 3000, condition: () -> Boolean): Boolean {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (System.currentTimeMillis() < deadline) {
      if (condition()) return true
      Thread.sleep(10)
    }
    return false
  }

  private fun bindAudio(): Int {
    val (bindCall, bindResolved) =
        resolvingCall {
          `when`(it.getString("name")).thenReturn("audio")
          `when`(it.getInt("port")).thenReturn(0)
        }
    plugin.bind(bindCall)
    val port = bindResolved()!!.getInteger("port")!!
    assertTrue("expected an OS-assigned audio port", port > 0)
    return port
  }

  /** One audio packet: u16 LE seq + a whole stereo S16 frame (4 bytes of PCM). */
  private fun sendAudioPacket(port: Int) {
    val packet = byteArrayOf(0, 0, 0x11, 0x22, 0x33, 0x44)
    DatagramSocket().use { sender ->
      sender.send(DatagramPacket(packet, packet.size, InetAddress.getByName("127.0.0.1"), port))
    }
  }

  private fun injectBridge(target: Plugin, ctx: Context) {
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(ctx)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }
}
