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

  private data class DiscoveryTarget(
    val host: String,
    val port: Int = 80,
    val source: String,
  )

  private data class DiscoveryCandidate(
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
    val connectTimeoutMs = (call.getInt("connectTimeoutMs") ?: 650).coerceIn(200, 5_000)
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

  private fun parseKnownHosts(call: PluginCall): List<String> {
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

  private fun buildTargets(knownHosts: List<String>, includeLanScan: Boolean): List<DiscoveryTarget> {
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

  private fun enumerateIpv4Subnet(address: Inet4Address, prefixLength: Int): List<String> {
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

  private fun runProbes(
    targets: List<DiscoveryTarget>,
    timeoutMs: Int,
    connectTimeoutMs: Int,
    maxConcurrency: Int,
  ): List<DiscoveryCandidate> {
    if (targets.isEmpty()) return emptyList()

    val probePool = Executors.newFixedThreadPool(maxConcurrency)
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

  private fun probeTarget(target: DiscoveryTarget, connectTimeoutMs: Int): DiscoveryCandidate? {
    return try {
      val address = InetAddress.getByName(target.host)
      val url = URL("http://${target.host}:${target.port}/v1/info")
      val connection = url.openConnection() as HttpURLConnection
      connection.connectTimeout = connectTimeoutMs
      connection.readTimeout = connectTimeoutMs
      connection.requestMethod = "GET"
      connection.instanceFollowRedirects = false
      connection.useCaches = false
      connection.connect()

      val responseCode = connection.responseCode
      if (responseCode == HttpURLConnection.HTTP_UNAUTHORIZED) {
        connection.disconnect()
        return DiscoveryCandidate(
          address = address.hostAddress ?: target.host,
          host = target.host.takeUnless { isIpv4Literal(it) },
          httpPort = target.port,
          sources = setOf(target.source),
          product = "C64 Ultimate",
          firmwareVersion = null,
          fpgaVersion = null,
          coreVersion = null,
          hostname = target.host.takeUnless { isIpv4Literal(it) },
          uniqueId = null,
          requiresPassword = true,
        )
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
        address = address.hostAddress ?: target.host,
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
      Log.w(logTag, "Device discovery probe failed for ${target.host}:${target.port}: ${error.message}", error)
      null
    }
  }

  private fun isUltimateProduct(product: String?): Boolean {
    val normalized = product?.trim()?.lowercase() ?: return false
    return normalized.contains("ultimate") || normalized == "c64u"
  }

  private fun mergeCandidate(left: DiscoveryCandidate, right: DiscoveryCandidate): DiscoveryCandidate {
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

  private fun candidatesToJson(candidates: List<DiscoveryCandidate>): JSArray {
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

  private fun targetKey(target: DiscoveryTarget): String {
    return "${target.host.trim().lowercase()}:${target.port}"
  }

  private fun isIpv4Literal(value: String): Boolean {
    return Regex("^\\d{1,3}(?:\\.\\d{1,3}){3}$").matches(value)
  }

  private fun ipv4ToInt(bytes: ByteArray): Int {
    return ((bytes[0].toInt() and 0xff) shl 24) or
      ((bytes[1].toInt() and 0xff) shl 16) or
      ((bytes[2].toInt() and 0xff) shl 8) or
      (bytes[3].toInt() and 0xff)
  }

  private fun intToIpv4(value: Int): String {
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
