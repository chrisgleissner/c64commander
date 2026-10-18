/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.util.Log
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.MulticastSocket
import java.net.NetworkInterface
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * Sends a fresh IGMP membership report for each joined stream group at a fixed interval.
 *
 * On the keypad phone the multicast video stopped arriving every 270 s, the group membership
 * timeout of the router's IGMP snooping (two query intervals plus the response time), and resumed
 * as soon as the app re-bound the socket and so joined the group again. The phone's answers to the
 * router's queries evidently do not keep the membership alive on that Wi-Fi path, while a join
 * report does. Leaving and joining again well inside the timeout keeps the membership from expiring.
 */
class MulticastMembershipRefresher(private val intervalMs: Long = DEFAULT_INTERVAL_MS) {
  private val scheduler =
    Executors.newSingleThreadScheduledExecutor { task -> Thread(task, "multicast-membership").apply { isDaemon = true } }
  private val tasks = ConcurrentHashMap<String, ScheduledFuture<*>>()
  private val refreshes = ConcurrentHashMap<String, AtomicLong>()

  /** Refreshes the membership of a socket that joined a multicast group; any other socket is left alone. */
  fun start(name: String, socket: DatagramSocket, group: String?, port: Int, networkInterface: NetworkInterface?) {
    stop(name)
    if (socket !is MulticastSocket || group == null) return
    val groupAddress = InetSocketAddress(InetAddress.getByName(group), port)
    refreshes[name] = AtomicLong()
    tasks[name] =
      scheduler.scheduleWithFixedDelay(
        { refresh(name, socket, groupAddress, networkInterface) },
        intervalMs,
        intervalMs,
        TimeUnit.MILLISECONDS,
      )
  }

  fun stop(name: String) {
    tasks.remove(name)?.cancel(false)
    refreshes.remove(name)
  }

  fun refreshCount(name: String): Long = refreshes[name]?.get() ?: 0L

  internal fun refresh(name: String, socket: MulticastSocket, group: InetSocketAddress, networkInterface: NetworkInterface?) {
    if (socket.isClosed) {
      stop(name)
      return
    }
    try {
      socket.leaveGroup(group, networkInterface)
    } catch (error: Exception) {
      Log.w(TAG, "stream $name: leaving $group before the membership refresh failed", error)
    }
    try {
      socket.joinGroup(group, networkInterface)
      refreshes[name]?.incrementAndGet()
    } catch (error: Exception) {
      Log.w(TAG, "stream $name: joining $group again failed; the stream will stop until it is restarted", error)
    }
  }

  companion object {
    private const val TAG = "MulticastMembership"
    const val DEFAULT_INTERVAL_MS = 60_000L
  }
}
