/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.os.Build
import androidx.core.content.ContextCompat

object BroadcastReceiverCompat {
  fun registerNotExported(
          context: Context,
          receiver: BroadcastReceiver,
          filter: IntentFilter,
          sdkInt: Int = Build.VERSION.SDK_INT,
  ) {
    if (sdkInt >= Build.VERSION_CODES.TIRAMISU) {
      ContextCompat.registerReceiver(context, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
      return
    }
    @Suppress("DEPRECATION") context.registerReceiver(receiver, filter)
  }
}
