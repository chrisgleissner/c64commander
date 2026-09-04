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
import java.io.IOException
import java.io.InputStreamReader
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import org.json.JSONException
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
import org.mockito.Mockito.verify
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
  fun probeTargetDisconnectsWhenBodyReadFails() {
    // Regression (HARD9-076): only the explicit success/4xx paths called
    // disconnect() - an exception thrown while reading the response body
    // (e.g. the device dropping mid-transfer under load) skipped all of
    // them, leaking the connection's socket/FD. A `finally` must cover this
    // path too.
    val connection = mock(HttpURLConnection::class.java)
    plugin.httpConnectionFactory = { connection }
    `when`(connection.responseCode).thenReturn(200)
    `when`(connection.inputStream).thenThrow(IOException("mid-body read failure"))

    val candidate = plugin.probeTarget(target("127.0.0.1", 8080), 1_000)

    assertNull(candidate)
    verify(connection).disconnect()
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
  fun probeTargetTreats403WithUltimateErrorBodyAsNeedingPassword() {
    // Password-protected Ultimate firmware answers an unauthenticated /v1/info with
    // 403 Forbidden and a JSON error envelope (see 1541ultimate/software/api/routes.h).
    val port = startInfoServer(403, """{"errors":["Forbidden."]}""")
    val candidate = plugin.probeTarget(target("127.0.0.1", port), 1_000)

    assertNotNull(candidate)
    assertTrue(candidate!!.requiresPassword)
    assertEquals("C64 Ultimate", candidate.product)
    assertEquals("127.0.0.1", candidate.address)
  }

  @Test
  fun probeTarget403KeepsNamedHost() {
    val port = startInfoServer(403, """{"errors":["Forbidden."]}""")
    val candidate = plugin.probeTarget(target("localhost", port), 1_000)
    assertNotNull(candidate)
    assertTrue(candidate!!.requiresPassword)
    assertEquals("localhost", candidate.host)
    assertEquals("localhost", candidate.hostname)
  }

  @Test
  fun probeTargetRejects403WithoutUltimateErrorBody() {
    // A generic 403 (e.g. a router admin page or proxy) must not appear as a device.
    val port = startInfoServer(403, "<html><body>Forbidden</body></html>")
    assertNull(plugin.probeTarget(target("127.0.0.1", port), 1_000))
  }

  @Test
  fun looksLikeUltimateErrorBodyRecognisesJsonEnvelope() {
    assertTrue(plugin.looksLikeUltimateErrorBody("""{"errors":["Forbidden."]}"""))
    assertFalse(plugin.looksLikeUltimateErrorBody("<html>Forbidden</html>"))
    assertFalse(plugin.looksLikeUltimateErrorBody(""))
    assertFalse(plugin.looksLikeUltimateErrorBody("   "))
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

  @Test
  fun isExpectedProbeMissTreatsNetworkFailuresAsExpected() {
    // The common LAN-scan misses are demoted to debug so they do not flood logcat.
    assertTrue(plugin.isExpectedProbeMiss(ConnectException("refused")))
    assertTrue(plugin.isExpectedProbeMiss(SocketTimeoutException("timeout")))
    assertTrue(plugin.isExpectedProbeMiss(UnknownHostException("no dns")))
    assertTrue(plugin.isExpectedProbeMiss(IOException("reset")))
  }

  @Test
  fun isExpectedProbeMissTreatsUnexpectedFailuresAsActionable() {
    // Malformed JSON from a reachable host (or any non-IO error) must stay surfaced.
    assertFalse(plugin.isExpectedProbeMiss(JSONException("bad json")))
    assertFalse(plugin.isExpectedProbeMiss(IllegalStateException("boom")))
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
  fun buildTargetsCarriesTheSavedHttpPortOfAKnownHost() {
    // HARD27-020: a saved device on a custom port arrives as "host:port" and must be
    // probed on that port, not on 80.
    val targets = plugin.buildTargets(listOf("c64u:8080", "u64"), includeLanScan = false)
    assertEquals(8080, targets.single { it.host == "c64u" }.port)
    assertEquals(80, targets.single { it.host == "u64" }.port)
  }

  @Test
  fun buildTargetsTreatsAnInvalidOrAbsentPortSuffixAsPartOfTheHost() {
    val targets = plugin.buildTargets(
      listOf("c64u:not-a-port", "c64u:0", "c64u:70000", "fe80::1", "[fe80::2]:8080"),
      includeLanScan = false,
    )
    // An unparseable suffix and a bare IPv6 literal stay verbatim on the default port.
    assertTrue(targets.any { it.host == "c64u:not-a-port" && it.port == 80 })
    assertTrue(targets.any { it.host == "c64u:0" && it.port == 80 })
    assertTrue(targets.any { it.host == "c64u:70000" && it.port == 80 })
    assertTrue(targets.any { it.host == "fe80::1" && it.port == 80 })
    // A bracketed IPv6 literal keeps its brackets and yields its port.
    assertTrue(targets.any { it.host == "[fe80::2]" && it.port == 8080 })
  }

  @Test
  fun buildTargetsSweepsTheLanOnPort80BeforeAnySavedCustomPort() {
    plugin.lanHostEnumerator = { listOf("192.168.1.2", "192.168.1.3") }
    val targets = plugin.buildTargets(listOf("c64u:8080"), includeLanScan = true)
    val lanTargets = targets.filter { it.source == "lan-scan" }
    // runProbes drains the pool in submission order under one deadline, so the default
    // sweep must be submitted in full before the saved custom port widens it.
    assertEquals(
      listOf("192.168.1.2:80", "192.168.1.3:80", "192.168.1.2:8080", "192.168.1.3:8080"),
      lanTargets.map { "${it.host}:${it.port}" },
    )
  }

  @Test
  fun buildTargetsSweepsTheLanOnlyOnPort80WithoutASavedCustomPort() {
    plugin.lanHostEnumerator = { listOf("192.168.1.2", "192.168.1.3") }
    val targets = plugin.buildTargets(listOf("c64u"), includeLanScan = true)
    val lanTargets = targets.filter { it.source == "lan-scan" }
    assertEquals(listOf("192.168.1.2:80", "192.168.1.3:80"), lanTargets.map { "${it.host}:${it.port}" })
  }

  @Test
  fun effectiveConcurrencyLeavesASinglePortSweepAtTheRequestedSize() {
    // 254 LAN hosts plus the known hosts, 650ms per probe, a 10s deadline: 24 workers
    // already drain that inside 80% of the budget, so nothing is raised.
    assertEquals(24, plugin.effectiveConcurrency(targetCount = 264, timeoutMs = 10_000, connectTimeoutMs = 650, requested = 24))
  }

  @Test
  fun effectiveConcurrencyGrowsSoAWidenedSweepStillFitsTheDeadline() {
    // The same scan with one saved device on a custom port doubles the target count.
    val concurrency = plugin.effectiveConcurrency(targetCount = 518, timeoutMs = 10_000, connectTimeoutMs = 650, requested = 24)
    assertTrue("Expected more than the requested 24 workers, got $concurrency", concurrency > 24)
    // Every target must be reachable inside 80% of the deadline.
    assertTrue(518L * 650 / concurrency <= 8_000)
  }

  @Test
  fun effectiveConcurrencyIsCappedAndNeverDropsBelowTheRequestedSize() {
    assertEquals(64, plugin.effectiveConcurrency(targetCount = 100_000, timeoutMs = 10_000, connectTimeoutMs = 650, requested = 24))
    // A caller that asks for more than the cap keeps what it asked for.
    assertEquals(64, plugin.effectiveConcurrency(targetCount = 10, timeoutMs = 10_000, connectTimeoutMs = 650, requested = 64))
    assertEquals(8, plugin.effectiveConcurrency(targetCount = 0, timeoutMs = 10_000, connectTimeoutMs = 650, requested = 8))
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

  @Test
  fun `reports offline when every interface holds only loopback or link-local addresses`() {
    val interfaces = listOf(
      DeviceDiscoveryPlugin.NetworkInterfaceSnapshot(
        isUp = true,
        isLoopback = true,
        addresses = listOf(InetAddress.getByName("127.0.0.1")),
      ),
      DeviceDiscoveryPlugin.NetworkInterfaceSnapshot(
        isUp = true,
        isLoopback = false,
        addresses = listOf(InetAddress.getByName("fe80::744f:f0ff:fef4:ec7b")),
      ),
    )

    assertFalse(plugin.hasRoutableAddress(interfaces))
  }

  @Test
  fun `reports online when an interface holds a routable address`() {
    val interfaces = listOf(
      DeviceDiscoveryPlugin.NetworkInterfaceSnapshot(
        isUp = true,
        isLoopback = true,
        addresses = listOf(InetAddress.getByName("127.0.0.1")),
      ),
      DeviceDiscoveryPlugin.NetworkInterfaceSnapshot(
        isUp = true,
        isLoopback = false,
        addresses = listOf(InetAddress.getByName("192.168.1.208")),
      ),
    )

    assertTrue(plugin.hasRoutableAddress(interfaces))
  }

  @Test
  fun `reports offline when the only routable address sits on a downed interface`() {
    val interfaces = listOf(
      DeviceDiscoveryPlugin.NetworkInterfaceSnapshot(
        isUp = false,
        isLoopback = false,
        addresses = listOf(InetAddress.getByName("192.168.1.208")),
      ),
    )

    assertFalse(plugin.hasRoutableAddress(interfaces))
  }

  @Test
  fun `getNetworkStatus answers on the calling thread so a running LAN scan cannot delay it`() {
    val call = mock(PluginCall::class.java)
    var payload: JSObject? = null
    doAnswer { invocation ->
      payload = invocation.getArgument(0) as JSObject
      null
    }.`when`(call).resolve(any())

    plugin.getNetworkStatus(call)

    val resolved = payload
    assertNotNull(resolved)
    assertTrue(resolved!!.getBoolean("supported"))
    assertTrue(resolved.has("online"))
  }
}
