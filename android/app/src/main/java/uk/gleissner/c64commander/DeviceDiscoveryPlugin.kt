/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.Collections
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorCompletionService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

@CapacitorPlugin(name = "DeviceDiscovery")
class DeviceDiscoveryPlugin : Plugin() {
  private val executor = Executors.newSingleThreadExecutor()
  private val logTag = "DeviceDiscoveryPlugin"

  internal data class DiscoveryTarget(
    val host: String,
    val port: Int = 80,
    val source: String,
  )

  internal data class DiscoveryCandidate(
    val address: String,
    val host: String?,
    val httpPort: Int,
    val sources: Set<String>,
    val product: String?,
    val firmwareVersion: String?,
    val fpgaVersion: String?,
    val coreVersion: String?,
    val hostname: String?,
    val uniqueId: String?,
    val requiresPassword: Boolean,
  )

  private data class ProbeOutcome(
    val target: DiscoveryTarget,
    val candidate: DiscoveryCandidate?,
  )

  @PluginMethod
  fun discover(call: PluginCall) {
    val knownHosts = parseKnownHosts(call)
    val includeLanScan = call.getBoolean("includeLanScan") ?: true
    val timeoutMs = (call.getInt("timeoutMs") ?: 8_000).coerceIn(1_000, 30_000)
    // A single probe must never be allowed to outlive the whole scan budget, otherwise
    // one slow host can blow the entire deadline and starve every other candidate. Cap
    // the per-probe connect/read timeout to the overall deadline after both are read.
    val connectTimeoutMs = (call.getInt("connectTimeoutMs") ?: 650).coerceIn(200, 5_000).coerceAtMost(timeoutMs)
    val maxConcurrency = (call.getInt("maxConcurrency") ?: 24).coerceIn(1, 64)

    executor.execute {
      val startedAt = System.nanoTime()
      try {
        val targets = buildTargets(knownHosts, includeLanScan)
        val candidates = runProbes(targets, timeoutMs, connectTimeoutMs, maxConcurrency)
        val payload = JSObject()
        payload.put("candidates", candidatesToJson(candidates))
        payload.put("scannedHosts", targets.size)
        payload.put("elapsedMs", elapsedMillis(startedAt))
        call.resolve(payload)
      } catch (error: Exception) {
        AppLogger.error(context, logTag, "Device discovery failed", "DeviceDiscoveryPlugin", error)
        call.reject("Device discovery failed: ${error.message}", error)
      }
    }
  }

  internal fun parseKnownHosts(call: PluginCall): List<String> {
    val array = call.getArray("knownHosts") ?: return emptyList()
    val hosts = mutableListOf<String>()
    for (index in 0 until array.length()) {
      try {
        val host = array.optString(index).trim()
        if (host.isNotBlank()) hosts.add(host)
      } catch (error: Exception) {
        AppLogger.warn(
          context,
          logTag,
          "Failed to parse known host at index $index",
          "DeviceDiscoveryPlugin",
          error,
        )
      }
    }
    return hosts
  }

  internal fun buildTargets(knownHosts: List<String>, includeLanScan: Boolean): List<DiscoveryTarget> {
    val targets = linkedMapOf<String, DiscoveryTarget>()
    knownHosts.forEach { host ->
      val target = DiscoveryTarget(host = host, source = "hostname")
      targets[targetKey(target)] = target
    }
    if (includeLanScan) {
      enumerateLanHosts().forEach { host ->
        val target = DiscoveryTarget(host = host, source = "lan-scan")
        targets.putIfAbsent(targetKey(target), target)
      }
    }
    return targets.values.toList()
  }

  private fun enumerateLanHosts(): List<String> {
    val hosts = linkedSetOf<String>()
    try {
      Collections.list(NetworkInterface.getNetworkInterfaces()).forEach networkInterfaceLoop@{ networkInterface ->
        if (!networkInterface.isUp || networkInterface.isLoopback || networkInterface.isVirtual) {
          return@networkInterfaceLoop
        }
        networkInterface.interfaceAddresses.forEach interfaceAddressLoop@{ interfaceAddress ->
          val address = interfaceAddress.address
          if (address !is Inet4Address || address.isLoopbackAddress || !address.isSiteLocalAddress) {
            return@interfaceAddressLoop
          }
          hosts.addAll(enumerateIpv4Subnet(address, interfaceAddress.networkPrefixLength.toInt()))
        }
      }
    } catch (error: Exception) {
      AppLogger.warn(
        context,
        logTag,
        "Failed to enumerate local network interfaces for device discovery",
        "DeviceDiscoveryPlugin",
        error,
      )
    }
    return hosts.toList()
  }

  internal fun enumerateIpv4Subnet(address: Inet4Address, prefixLength: Int): List<String> {
    val effectivePrefix = prefixLength.coerceIn(24, 30)
    val local = ipv4ToInt(address.address)
    val mask = (-1 shl (32 - effectivePrefix))
    val network = local and mask
    val broadcast = network or mask.inv()
    val hosts = mutableListOf<String>()
    for (candidate in (network + 1) until broadcast) {
      if (candidate == local) continue
      hosts.add(intToIpv4(candidate))
    }
    return hosts
  }

  internal fun runProbes(
    targets: List<DiscoveryTarget>,
    timeoutMs: Int,
    connectTimeoutMs: Int,
    maxConcurrency: Int,
  ): List<DiscoveryCandidate> {
    if (targets.isEmpty()) return emptyList()

    // Daemon workers: `HttpURLConnection.connect()` does not respond to the interrupt
    // that `shutdownNow()` sends, so a worker probing a dead host keeps running until its
    // own connect/read timeout elapses. Daemon threads can't keep the process alive or
    // accumulate as non-daemon stragglers across repeated scans (startup + rediscovery).
    val probePool =
      Executors.newFixedThreadPool(maxConcurrency) { runnable ->
        Thread(runnable, "device-discovery-probe").apply { isDaemon = true }
      }
    val completionService = ExecutorCompletionService<ProbeOutcome>(probePool)
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs.toLong())
    var pending = 0
    targets.forEach { target ->
      completionService.submit(Callable { ProbeOutcome(target, probeTarget(target, connectTimeoutMs)) })
      pending += 1
    }

    val candidatesByKey = linkedMapOf<String, DiscoveryCandidate>()
    try {
      while (pending > 0) {
        val remainingNanos = deadline - System.nanoTime()
        if (remainingNanos <= 0L) break
        val future = completionService.poll(remainingNanos, TimeUnit.NANOSECONDS) ?: break
        pending -= 1
        val outcome = future.get()
        val candidate = outcome.candidate ?: continue
        val key = candidate.uniqueId?.takeIf { it.isNotBlank() } ?: candidate.address
        val existing = candidatesByKey[key]
        candidatesByKey[key] =
          if (existing == null) {
            candidate
          } else {
            mergeCandidate(existing, candidate)
          }
      }
    } catch (error: Exception) {
      AppLogger.warn(context, logTag, "Device discovery probe loop failed", "DeviceDiscoveryPlugin", error)
    } finally {
      probePool.shutdownNow()
    }

    return candidatesByKey.values.toList()
  }

  internal fun probeTarget(target: DiscoveryTarget, connectTimeoutMs: Int): DiscoveryCandidate? {
    return try {
      val url = URL("http://${target.host}:${target.port}/v1/info")
      val connection = url.openConnection() as HttpURLConnection
      connection.connectTimeout = connectTimeoutMs
      connection.readTimeout = connectTimeoutMs
      connection.requestMethod = "GET"
      connection.instanceFollowRedirects = false
      connection.useCaches = false
      connection.connect()

      // Resolve the IP only after a successful connect. The host is reachable at
      // this point and the platform resolver cache is warm, so we avoid the extra
      // pre-connect InetAddress.getByName() lookup — a non-interruptible call that
      // could otherwise block a probe worker thread on a slow/failing DNS resolver
      // for a named host (e.g. u64/c64u) that never answers.
      val resolvedAddress = resolveHostAddress(target.host)

      val responseCode = connection.responseCode
      // A password-protected Ultimate gates every /v1/* route behind the `X-Password`
      // header, so an unauthenticated discovery probe is answered with 401 Unauthorized
      // OR 403 Forbidden — current firmware returns 403 with a `{"errors":["Forbidden."]}`
      // body (see 1541ultimate/software/api/routes.h). Either way the device is present
      // and reachable; surface it as a candidate that needs a password so the app can
      // prompt for one instead of silently dropping the device from discovery.
      if (responseCode == HttpURLConnection.HTTP_UNAUTHORIZED ||
        responseCode == HttpURLConnection.HTTP_FORBIDDEN
      ) {
        val errorBody = readErrorBody(connection)
        connection.disconnect()
        // 401 on /v1/info is Ultimate-specific enough to accept on its own. 403 is far
        // more common from generic web servers/proxies, so only accept it when the body
        // carries the Ultimate's JSON error envelope — otherwise discovery would pollute
        // the list with unrelated devices.
        if (responseCode == HttpURLConnection.HTTP_FORBIDDEN && !looksLikeUltimateErrorBody(errorBody)) {
          return null
        }
        return passwordProtectedCandidate(target, resolvedAddress)
      }
      if (responseCode !in 200..299) {
        connection.disconnect()
        return null
      }

      val payload =
        BufferedReader(InputStreamReader(connection.inputStream, StandardCharsets.UTF_8)).use { reader ->
          reader.readText()
        }
      connection.disconnect()

      val info = JSONObject(payload)
      val product = info.optString("product").takeIf { it.isNotBlank() }
      if (!isUltimateProduct(product)) return null

      DiscoveryCandidate(
        address = resolvedAddress,
        host = target.host.takeUnless { isIpv4Literal(it) },
        httpPort = target.port,
        sources = setOf(target.source),
        product = product,
        firmwareVersion = info.optString("firmware_version").takeIf { it.isNotBlank() },
        fpgaVersion = info.optString("fpga_version").takeIf { it.isNotBlank() },
        coreVersion = info.optString("core_version").takeIf { it.isNotBlank() },
        hostname = info.optString("hostname").takeIf { it.isNotBlank() },
        uniqueId = info.optString("unique_id").takeIf { it.isNotBlank() },
        requiresPassword = false,
      )
    } catch (error: Exception) {
      if (isExpectedProbeMiss(error)) {
        // An ordinary LAN scan probes hundreds of IPs/hostnames that never answer —
        // refused connections, timeouts, and DNS failures are EXPECTED misses, not
        // actionable warnings. Logging each one with a full stack trace floods package
        // logcat (and hides real issues). Demote the common cases to a one-line debug note.
        Log.d(
          logTag,
          "Device discovery probe miss for ${target.host}:${target.port}: ${error::class.java.simpleName}",
        )
      } else {
        // A non-network failure (e.g. malformed JSON from a host that DID answer
        // /v1/info with a 2xx) is unexpected and could mask a real discovery bug,
        // so keep the message and stack trace at warning level.
        Log.w(
          logTag,
          "Unexpected device discovery probe failure for ${target.host}:${target.port}",
          error,
        )
      }
      null
    }
  }

  /**
   * Network-level failures (refused/timeout/DNS/reset) are the expected outcome of
   * probing the many LAN addresses that never host an Ultimate, so they are demoted to
   * debug. Anything else — most notably [org.json.JSONException] from a reachable host —
   * is unexpected and stays at warning level. [IOException] covers the socket and
   * connection failures thrown by [HttpURLConnection]; JSONException does not extend it,
   * so malformed payloads correctly fall through to the unexpected branch.
   */
  internal fun isExpectedProbeMiss(error: Throwable): Boolean = error is IOException

  private fun passwordProtectedCandidate(target: DiscoveryTarget, resolvedAddress: String): DiscoveryCandidate {
    val namedHost = target.host.takeUnless { isIpv4Literal(it) }
    return DiscoveryCandidate(
      address = resolvedAddress,
      host = namedHost,
      httpPort = target.port,
      sources = setOf(target.source),
      product = "C64 Ultimate",
      firmwareVersion = null,
      fpgaVersion = null,
      coreVersion = null,
      hostname = namedHost,
      uniqueId = null,
      requiresPassword = true,
    )
  }

  internal fun readErrorBody(connection: HttpURLConnection): String =
    runCatching {
      val stream = connection.errorStream ?: return ""
      BufferedReader(InputStreamReader(stream, StandardCharsets.UTF_8)).use { reader ->
        // Auth errors are tiny JSON envelopes; cap the read so a misbehaving host cannot
        // stream an unbounded body into a discovery probe worker.
        val builder = StringBuilder()
        val buffer = CharArray(512)
        while (builder.length < 2048) {
          val read = reader.read(buffer)
          if (read < 0) break
          builder.append(buffer, 0, read)
        }
        builder.toString()
      }
    }.getOrDefault("")

  internal fun looksLikeUltimateErrorBody(body: String): Boolean {
    val trimmed = body.trim()
    if (trimmed.isEmpty()) return false
    // The Ultimate REST API replies with a JSON envelope `{"errors":[...]}` even for auth
    // failures; a generic 403 page (HTML, proxy text) will not parse to that shape.
    return runCatching { JSONObject(trimmed).has("errors") }.getOrDefault(false)
  }

  internal fun resolveHostAddress(host: String): String =
    runCatching { InetAddress.getByName(host).hostAddress }.getOrNull()?.takeIf { it.isNotBlank() } ?: host

  internal fun isUltimateProduct(product: String?): Boolean {
    val normalized = product?.trim()?.lowercase() ?: return false
    return normalized.contains("ultimate") || normalized == "c64u"
  }

  internal fun mergeCandidate(left: DiscoveryCandidate, right: DiscoveryCandidate): DiscoveryCandidate {
    return left.copy(
      address = left.address.ifBlank { right.address },
      host = left.host ?: right.host,
      httpPort = left.httpPort,
      sources = left.sources + right.sources,
      product = left.product ?: right.product,
      firmwareVersion = left.firmwareVersion ?: right.firmwareVersion,
      fpgaVersion = left.fpgaVersion ?: right.fpgaVersion,
      coreVersion = left.coreVersion ?: right.coreVersion,
      hostname = left.hostname ?: right.hostname,
      uniqueId = left.uniqueId ?: right.uniqueId,
      requiresPassword = left.requiresPassword || right.requiresPassword,
    )
  }

  internal fun candidatesToJson(candidates: List<DiscoveryCandidate>): JSArray {
    val array = JSArray()
    candidates.forEach { candidate ->
      val sources = JSArray()
      candidate.sources.forEach { source -> sources.put(source) }
      val item = JSObject()
      item.put("address", candidate.address)
      item.put("host", candidate.host)
      item.put("httpPort", candidate.httpPort)
      item.put("source", sources)
      item.put("product", candidate.product)
      item.put("firmwareVersion", candidate.firmwareVersion)
      item.put("fpgaVersion", candidate.fpgaVersion)
      item.put("coreVersion", candidate.coreVersion)
      item.put("hostname", candidate.hostname)
      item.put("uniqueId", candidate.uniqueId)
      item.put("requiresPassword", candidate.requiresPassword)
      array.put(item)
    }
    return array
  }

  internal fun targetKey(target: DiscoveryTarget): String {
    return "${target.host.trim().lowercase()}:${target.port}"
  }

  internal fun isIpv4Literal(value: String): Boolean {
    return Regex("^\\d{1,3}(?:\\.\\d{1,3}){3}$").matches(value)
  }

  internal fun ipv4ToInt(bytes: ByteArray): Int {
    return ((bytes[0].toInt() and 0xff) shl 24) or
      ((bytes[1].toInt() and 0xff) shl 16) or
      ((bytes[2].toInt() and 0xff) shl 8) or
      (bytes[3].toInt() and 0xff)
  }

  internal fun intToIpv4(value: Int): String {
    return listOf(
      (value ushr 24) and 0xff,
      (value ushr 16) and 0xff,
      (value ushr 8) and 0xff,
      value and 0xff,
    ).joinToString(".")
  }

  private fun elapsedMillis(startedAt: Long): Long {
    return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt)
  }
}
