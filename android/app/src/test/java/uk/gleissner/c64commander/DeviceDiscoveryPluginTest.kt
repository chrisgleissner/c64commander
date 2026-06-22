/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.getcapacitor.Bridge
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.Inet4Address
import java.net.InetAddress
import java.net.ServerSocket
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.any
import org.mockito.Mockito.doAnswer
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class DeviceDiscoveryPluginTest {
  private lateinit var plugin: DeviceDiscoveryPlugin
  private val servers = mutableListOf<ServerSocket>()

  @Before
  fun setUp() {
    plugin = DeviceDiscoveryPlugin()
    setPluginBridge(plugin, ApplicationProvider.getApplicationContext())
  }

  @After
  fun tearDown() {
    servers.forEach { runCatching { it.close() } }
    servers.clear()
  }

  // ---- Helpers -------------------------------------------------------------

  private fun setPluginBridge(target: DeviceDiscoveryPlugin, context: Context) {
    val bridge = mock(Bridge::class.java)
    `when`(bridge.context).thenReturn(context)
    val field = Plugin::class.java.getDeclaredField("bridge")
    field.isAccessible = true
    field.set(target, bridge)
  }

  /**
   * Start an ephemeral loopback HTTP responder that answers every request with
   * [code]/[body]. A raw `ServerSocket` is used because Robolectric runs against
   * `android.jar`, which omits `com.sun.net.httpserver`.
   */
  private fun startInfoServer(code: Int, body: String): Int {
    val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    servers.add(server)
    val bytes = body.toByteArray(StandardCharsets.UTF_8)
    val thread = Thread {
      while (!server.isClosed) {
        val socket =
          try {
            server.accept()
          } catch (_: Exception) {
            break
          }
        // Each connection is served on its own daemon thread so concurrent probes
        // (e.g. the merge-by-unique-id case) never block on one another.
        Thread {
          socket.use { client ->
            runCatching {
              val reader = BufferedReader(InputStreamReader(client.getInputStream(), StandardCharsets.UTF_8))
              var line = reader.readLine()
              while (line != null && line.isNotEmpty()) line = reader.readLine()
              val out = client.getOutputStream()
              val header =
                "HTTP/1.1 $code OK\r\n" +
                  "Content-Type: application/json\r\n" +
                  "Content-Length: ${bytes.size}\r\n" +
                  "Connection: close\r\n\r\n"
              out.write(header.toByteArray(StandardCharsets.UTF_8))
              if (bytes.isNotEmpty()) out.write(bytes)
              out.flush()
            }
          }
        }.apply { isDaemon = true }.start()
      }
    }
    thread.isDaemon = true
    thread.start()
    return server.localPort
  }

  /** A guaranteed-closed loopback port (bound then released). */
  private fun closedPort(): Int {
    val socket = ServerSocket(0)
    val port = socket.localPort
    socket.close()
    return port
  }

  private fun target(host: String, port: Int) =
    DeviceDiscoveryPlugin.DiscoveryTarget(host = host, port = port, source = "test")

  private fun ultimateInfoJson(
    product: String = "Ultimate 64",
    uniqueId: String = "abc123",
    hostname: String = "u64",
  ): String =
    """
    {"product":"$product","firmware_version":"3.12","fpga_version":"1.2",
     "core_version":"1.4B","hostname":"$hostname","unique_id":"$uniqueId"}
    """.trimIndent()

  // ---- probeTarget ---------------------------------------------------------

  @Test
  fun probeTargetParsesFullUltimateInfo() {
    val port = startInfoServer(200, ultimateInfoJson())
    val candidate = plugin.probeTarget(target("127.0.0.1", port), 1_000)

    assertNotNull(candidate)
    assertEquals("127.0.0.1", candidate!!.address)
    assertEquals("Ultimate 64", candidate.product)
    assertEquals("3.12", candidate.firmwareVersion)
    assertEquals("1.2", candidate.fpgaVersion)
    assertEquals("1.4B", candidate.coreVersion)
    assertEquals("u64", candidate.hostname)
    assertEquals("abc123", candidate.uniqueId)
    assertFalse(candidate.requiresPassword)
    assertEquals(setOf("test"), candidate.sources)
    // An IPv4-literal host is never echoed back as a hostname.
    assertNull(candidate.host)
  }

  @Test
  fun probeTargetKeepsHostnameForNamedHost() {
    val port = startInfoServer(200, """{"product":"C64 Ultimate"}""")
    val candidate = plugin.probeTarget(target("localhost", port), 1_000)

    assertNotNull(candidate)
    assertEquals("localhost", candidate!!.host)
    assertEquals("C64 Ultimate", candidate.product)
    assertNull(candidate.coreVersion)
  }

  @Test
  fun probeTargetAcceptsC64uProduct() {
    val port = startInfoServer(200, """{"product":"c64u"}""")
    assertNotNull(plugin.probeTarget(target("127.0.0.1", port), 1_000))
  }

  @Test
  fun probeTargetRejectsNonUltimateProduct() {
    val port = startInfoServer(200, """{"product":"Some NAS"}""")
    assertNull(plugin.probeTarget(target("127.0.0.1", port), 1_000))
  }

  @Test
  fun probeTargetRejectsMissingProduct() {
    val port = startInfoServer(200, """{"hostname":"x"}""")
    assertNull(plugin.probeTarget(target("127.0.0.1", port), 1_000))
  }

  @Test
  fun probeTargetTreats401AsReachableNeedingPassword() {
    val port = startInfoServer(401, "")
    val candidate = plugin.probeTarget(target("127.0.0.1", port), 1_000)

    assertNotNull(candidate)
    assertTrue(candidate!!.requiresPassword)
    assertEquals("C64 Ultimate", candidate.product)
    assertEquals("127.0.0.1", candidate.address)
  }

  @Test
  fun probeTarget401KeepsNamedHost() {
    // `localhost` resolves to the loopback server and is not an IPv4 literal, so the
    // probe echoes it back as the named host/hostname for a password-gated device.
    val port = startInfoServer(401, "")
    val candidate = plugin.probeTarget(target("localhost", port), 1_000)
    assertEquals("localhost", candidate!!.host)
    assertEquals("localhost", candidate.hostname)
  }

  @Test
  fun probeTargetRejectsServerError() {
    val port = startInfoServer(500, "boom")
    assertNull(plugin.probeTarget(target("127.0.0.1", port), 1_000))
  }

  @Test
  fun probeTargetRejectsMalformedJson() {
    val port = startInfoServer(200, "definitely not json")
    assertNull(plugin.probeTarget(target("127.0.0.1", port), 1_000))
  }

  @Test
  fun probeTargetReturnsNullOnConnectionRefused() {
    assertNull(plugin.probeTarget(target("127.0.0.1", closedPort()), 300))
  }

  // ---- runProbes -----------------------------------------------------------

  @Test
  fun runProbesReturnsEmptyForNoTargets() {
    assertTrue(plugin.runProbes(emptyList(), 1_000, 500, 4).isEmpty())
  }

  @Test
  fun runProbesCollectsCandidate() {
    val port = startInfoServer(200, ultimateInfoJson(uniqueId = "solo"))
    val candidates = plugin.runProbes(listOf(target("127.0.0.1", port)), 2_000, 1_000, 4)
    assertEquals(1, candidates.size)
    assertEquals("solo", candidates[0].uniqueId)
  }

  @Test
  fun runProbesMergesCandidatesSharingUniqueId() {
    val port = startInfoServer(200, ultimateInfoJson(uniqueId = "dup"))
    val candidates =
      plugin.runProbes(
        listOf(
          DeviceDiscoveryPlugin.DiscoveryTarget(host = "127.0.0.1", port = port, source = "hostname"),
          DeviceDiscoveryPlugin.DiscoveryTarget(host = "127.0.0.1", port = port, source = "lan-scan"),
        ),
        2_000,
        1_000,
        4,
      )
    assertEquals(1, candidates.size)
    assertEquals(setOf("hostname", "lan-scan"), candidates[0].sources)
  }

  @Test
  fun runProbesHonoursDeadline() {
    // 1 ms budget against a closed port: the poll loop must return promptly with nothing.
    val candidates = plugin.runProbes(listOf(target("127.0.0.1", closedPort())), 1, 200, 2)
    assertTrue(candidates.isEmpty())
  }

  // ---- buildTargets / parseKnownHosts -------------------------------------

  @Test
  fun buildTargetsDedupesKnownHostsCaseInsensitively() {
    val targets = plugin.buildTargets(listOf("U64", "u64", "192.168.1.5"), includeLanScan = false)
    assertEquals(2, targets.size)
    // Same host:port key keeps the last entry, so the lowercase "u64" survives.
    assertTrue(targets.any { it.host == "u64" })
    assertTrue(targets.any { it.host == "192.168.1.5" })
  }

  @Test
  fun buildTargetsIncludesLanScanWithoutThrowing() {
    // LAN enumeration walks real interfaces under Robolectric; it must not throw and
    // every known host stays present.
    val targets = plugin.buildTargets(listOf("u64"), includeLanScan = true)
    assertTrue(targets.any { it.host == "u64" })
  }

  @Test
  fun parseKnownHostsTrimsAndDropsBlanks() {
    val call = mock(PluginCall::class.java)
    val array = JSArray().apply {
      put(" u64 ")
      put("")
      put("   ")
      put("192.168.1.9")
    }
    `when`(call.getArray("knownHosts")).thenReturn(array)
    assertEquals(listOf("u64", "192.168.1.9"), plugin.parseKnownHosts(call))
  }

  @Test
  fun parseKnownHostsReturnsEmptyWhenArrayMissing() {
    val call = mock(PluginCall::class.java)
    `when`(call.getArray("knownHosts")).thenReturn(null)
    assertTrue(plugin.parseKnownHosts(call).isEmpty())
  }

  // ---- candidatesToJson ----------------------------------------------------

  @Test
  fun candidatesToJsonSerialisesFields() {
    val candidate =
      DeviceDiscoveryPlugin.DiscoveryCandidate(
        address = "192.168.1.20",
        host = "u64",
        httpPort = 80,
        sources = setOf("hostname", "lan-scan"),
        product = "Ultimate 64",
        firmwareVersion = "3.12",
        fpgaVersion = "1.2",
        coreVersion = "1.4B",
        hostname = "u64",
        uniqueId = "abc",
        requiresPassword = false,
      )
    val json = plugin.candidatesToJson(listOf(candidate))
    assertEquals(1, json.length())
    val item = json.getJSONObject(0)
    assertEquals("192.168.1.20", item.getString("address"))
    assertEquals("Ultimate 64", item.getString("product"))
    assertEquals(80, item.getInt("httpPort"))
    assertEquals(2, item.getJSONArray("source").length())
    assertFalse(item.getBoolean("requiresPassword"))
  }

  // ---- mergeCandidate ------------------------------------------------------

  @Test
  fun mergeCandidatePrefersLeftAndUnionsSources() {
    val left =
      DeviceDiscoveryPlugin.DiscoveryCandidate(
        address = "192.168.1.20",
        host = null,
        httpPort = 80,
        sources = setOf("lan-scan"),
        product = "Ultimate 64",
        firmwareVersion = null,
        fpgaVersion = null,
        coreVersion = null,
        hostname = null,
        uniqueId = "abc",
        requiresPassword = false,
      )
    val right =
      left.copy(
        host = "u64",
        sources = setOf("hostname"),
        firmwareVersion = "3.12",
        coreVersion = "1.4B",
        hostname = "u64",
        requiresPassword = true,
      )
    val merged = plugin.mergeCandidate(left, right)
    assertEquals("u64", merged.host)
    assertEquals("3.12", merged.firmwareVersion)
    assertEquals("1.4B", merged.coreVersion)
    assertEquals(setOf("lan-scan", "hostname"), merged.sources)
    assertTrue(merged.requiresPassword)
  }

  // ---- pure helpers --------------------------------------------------------

  @Test
  fun isUltimateProductRecognisesKnownProducts() {
    assertTrue(plugin.isUltimateProduct("Ultimate 64"))
    assertTrue(plugin.isUltimateProduct("C64 Ultimate"))
    assertTrue(plugin.isUltimateProduct("c64u"))
    assertTrue(plugin.isUltimateProduct("Ultimate-II+"))
    assertFalse(plugin.isUltimateProduct("Generic NAS"))
    assertFalse(plugin.isUltimateProduct(""))
    assertFalse(plugin.isUltimateProduct(null))
  }

  @Test
  fun isIpv4LiteralDistinguishesAddressesFromNames() {
    assertTrue(plugin.isIpv4Literal("192.168.1.1"))
    assertTrue(plugin.isIpv4Literal("10.0.0.255"))
    assertFalse(plugin.isIpv4Literal("u64"))
    assertFalse(plugin.isIpv4Literal("1.2.3"))
    assertFalse(plugin.isIpv4Literal("1.2.3.4.5"))
  }

  @Test
  fun ipv4ConversionRoundTrips() {
    val bytes = (InetAddress.getByName("10.20.30.40") as Inet4Address).address
    val asInt = plugin.ipv4ToInt(bytes)
    assertEquals("10.20.30.40", plugin.intToIpv4(asInt))
  }

  @Test
  fun enumerateIpv4SubnetExcludesNetworkBroadcastAndSelf() {
    val address = InetAddress.getByName("192.168.1.10") as Inet4Address
    val hosts = plugin.enumerateIpv4Subnet(address, 24)
    assertEquals(253, hosts.size)
    assertTrue(hosts.contains("192.168.1.1"))
    assertTrue(hosts.contains("192.168.1.254"))
    assertFalse(hosts.contains("192.168.1.0"))
    assertFalse(hosts.contains("192.168.1.255"))
    assertFalse(hosts.contains("192.168.1.10"))
  }

  @Test
  fun enumerateIpv4SubnetClampsWideMaskToSlash24() {
    val address = InetAddress.getByName("192.168.5.10") as Inet4Address
    // A /16 prefix is clamped to /24 so discovery never floods 65k hosts.
    assertEquals(253, plugin.enumerateIpv4Subnet(address, 16).size)
  }

  @Test
  fun enumerateIpv4SubnetHandlesSmallSlash30() {
    val address = InetAddress.getByName("192.168.1.1") as Inet4Address
    val hosts = plugin.enumerateIpv4Subnet(address, 30)
    // /30 → network .0, broadcast .3, usable .1/.2, minus self .1 → only .2.
    assertEquals(listOf("192.168.1.2"), hosts)
  }

  @Test
  fun targetKeyNormalisesHost() {
    assertEquals("u64:80", plugin.targetKey(target("U64", 80)))
  }

  @Test
  fun resolveHostAddressResolvesLoopback() {
    assertEquals("127.0.0.1", plugin.resolveHostAddress("127.0.0.1"))
  }

  @Test
  fun resolveHostAddressFallsBackToHostOnFailure() {
    val unresolvable = "nonexistent.invalid.host.example"
    assertEquals(unresolvable, plugin.resolveHostAddress(unresolvable))
  }

  // ---- discover (end-to-end via PluginCall) --------------------------------

  @Test
  fun discoverResolvesPayloadForKnownHosts() {
    val call = mock(PluginCall::class.java)
    val knownHosts = JSArray().apply { put("127.0.0.1") }
    `when`(call.getArray("knownHosts")).thenReturn(knownHosts)
    `when`(call.getBoolean("includeLanScan")).thenReturn(false)
    `when`(call.getInt("timeoutMs")).thenReturn(1_000)
    `when`(call.getInt("connectTimeoutMs")).thenReturn(200)
    `when`(call.getInt("maxConcurrency")).thenReturn(4)

    val latch = CountDownLatch(1)
    var payload: JSObject? = null
    doAnswer { invocation ->
      payload = invocation.getArgument(0) as JSObject
      latch.countDown()
      null
    }.`when`(call).resolve(any())

    plugin.discover(call)

    assertTrue(latch.await(5, TimeUnit.SECONDS))
    assertNotNull(payload)
    assertEquals(1, payload!!.getInt("scannedHosts"))
    assertEquals(0, payload!!.getJSONArray("candidates").length())
    assertTrue(payload!!.has("elapsedMs"))
  }

  @Test
  fun discoverUsesDefaultsWhenParamsOmitted() {
    val call = mock(PluginCall::class.java)
    `when`(call.getArray("knownHosts")).thenReturn(null)
    `when`(call.getBoolean("includeLanScan")).thenReturn(false)
    `when`(call.getInt("timeoutMs")).thenReturn(null)
    `when`(call.getInt("connectTimeoutMs")).thenReturn(null)
    `when`(call.getInt("maxConcurrency")).thenReturn(null)

    val latch = CountDownLatch(1)
    var payload: JSObject? = null
    doAnswer { invocation ->
      payload = invocation.getArgument(0) as JSObject
      latch.countDown()
      null
    }.`when`(call).resolve(any())

    plugin.discover(call)

    assertTrue(latch.await(5, TimeUnit.SECONDS))
    assertEquals(0, payload!!.getInt("scannedHosts"))
  }
}
