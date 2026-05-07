/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.net.Inet4Address
import java.net.InetAddress
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Resolves bare hostnames (e.g. "u64") via Android's NsdManager so saved-device
 * entries that point at an mDNS-only host can connect on Android, where the
 * stock InetAddress.getByName does not perform mDNS lookup.
 *
 * Tries the bare name first, then "<name>.local". A failure surfaces an
 * actionable error to the JS layer instead of producing a silent OFFLINE
 * banner.
 */
@CapacitorPlugin(name = "MdnsResolver")
class MdnsResolverPlugin : Plugin() {
  companion object {
    private const val TAG = "MdnsResolverPlugin"
    private const val DEFAULT_TIMEOUT_MS = 1500L
    private const val DEFAULT_TTL_MS = 30_000L
  }

  @PluginMethod
  fun resolve(call: PluginCall) {
    val host = call.getString("host")?.trim()
    if (host.isNullOrEmpty()) {
      call.reject("host is required")
      return
    }
    val timeoutMs = call.getLong("timeoutMs") ?: DEFAULT_TIMEOUT_MS

    val candidates = buildCandidateNames(host)
    for (candidate in candidates) {
      val ip = tryResolve(candidate, timeoutMs)
      if (ip != null) {
        val payload = JSObject().apply {
          put("host", host)
          put("resolvedHost", candidate)
          put("ip", ip)
          put("ttlMs", DEFAULT_TTL_MS)
        }
        call.resolve(payload)
        return
      }
    }
    call.reject("Cannot resolve host '$host' via mDNS")
  }

  private fun buildCandidateNames(host: String): List<String> {
    val cleaned = host.removeSuffix(".")
    if (cleaned.contains(".")) {
      return listOf(cleaned)
    }
    return listOf(cleaned, "$cleaned.local")
  }

  private fun tryResolve(host: String, timeoutMs: Long): String? {
    // Step 1: standard DNS / hosts lookup. On most home networks the .local
    // suffix is resolved via the system mDNS responder if one is installed.
    try {
      val addresses = InetAddress.getAllByName(host)
      val v4 = addresses.firstOrNull { it is Inet4Address }
      if (v4 != null) {
        AppLogger.info(context, TAG, "Resolved $host via system DNS to ${v4.hostAddress}", TAG)
        return v4.hostAddress
      }
    } catch (error: Exception) {
      AppLogger.info(context, TAG, "System DNS lookup failed for $host: ${error.message}", TAG)
    }

    // Step 2: NsdManager-based mDNS service discovery. Only useful when the
    // device advertises a known service type. The C64 Ultimate firmware
    // does not advertise a Bonjour service, so this is best-effort and
    // primarily exists for future expansion.
    val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager ?: return null
    val candidate = AtomicReference<String?>(null)
    val latch = CountDownLatch(1)
    val listener = object : NsdManager.DiscoveryListener {
      override fun onStartDiscoveryFailed(serviceType: String?, errorCode: Int) {
        latch.countDown()
      }

      override fun onStopDiscoveryFailed(serviceType: String?, errorCode: Int) {
        latch.countDown()
      }

      override fun onDiscoveryStarted(serviceType: String?) {}

      override fun onDiscoveryStopped(serviceType: String?) {
        latch.countDown()
      }

      override fun onServiceFound(serviceInfo: NsdServiceInfo) {
        val candidateName = serviceInfo.serviceName ?: return
        if (!candidateName.equals(host.substringBefore(".local"), ignoreCase = true)) return
        @Suppress("DEPRECATION")
        nsd.resolveService(
                serviceInfo,
                object : NsdManager.ResolveListener {
                  override fun onResolveFailed(serviceInfo: NsdServiceInfo?, errorCode: Int) {
                    latch.countDown()
                  }

                  override fun onServiceResolved(serviceInfo: NsdServiceInfo?) {
                    val ip = serviceInfo?.host?.hostAddress
                    candidate.set(ip)
                    latch.countDown()
                  }
                },
        )
      }

      override fun onServiceLost(serviceInfo: NsdServiceInfo?) {}
    }

    return try {
      nsd.discoverServices("_http._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
      latch.await(timeoutMs, TimeUnit.MILLISECONDS)
      candidate.get()
    } catch (error: Exception) {
      AppLogger.warn(context, TAG, "NsdManager discovery failed for $host: ${error.message}", TAG, error)
      null
    } finally {
      try {
        nsd.stopServiceDiscovery(listener)
      } catch (error: Exception) {
        AppLogger.warn(context, TAG, "NsdManager stop failed: ${error.message}", TAG, error)
      }
    }
  }
}
