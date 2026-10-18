/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject

/** What the sender filter and the socket packet counter know about one stream, as the bridge reports it. */
internal fun streamDiagnostics(
  name: String,
  senderFilter: StreamSenderFilter,
  packetCounters: StreamPacketCounters,
  membershipRefresher: MulticastMembershipRefresher,
  senders: Collection<String>?,
): JSObject {
  val result = JSObject()
  result.put("rejectedPackets", senderFilter.rejectedPackets(name))
  result.put("lastRejectedSource", senderFilter.lastRejectedSource(name)?.hostAddress)
  result.put("expectedSource", senderFilter.expectedSource(name)?.hostAddress)
  result.put("receivedPackets", packetCounters.receivedPackets(name))
  packetCounters.millisSinceLastPacket(name)?.let { result.put("msSinceLastPacket", it) }
  result.put("membershipRefreshes", membershipRefresher.refreshCount(name))
  val sendersArray = JSArray()
  senders?.forEach { sendersArray.put(it) }
  result.put("senders", sendersArray)
  return result
}
