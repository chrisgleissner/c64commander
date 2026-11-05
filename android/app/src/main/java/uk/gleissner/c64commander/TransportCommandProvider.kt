/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

package uk.gleissner.c64commander

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Binder
import android.os.Bundle
import android.os.Process

/**
 * Accepts Next and Prev from the companion app, whose entries a phone's function keys can open from anywhere.
 * The reply says whether this app was in front, so the companion can hand the screen back to it.
 */
open class TransportCommandProvider : ContentProvider() {
  companion object {
    const val METHOD_NEXT = "next"
    const val METHOD_PREVIOUS = "previous"
    const val RESULT_WAS_IN_FRONT = "wasInFront"
    private const val TAG = "TransportCommandProvider"
  }

  override fun onCreate() = true

  override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
    val context = requireNotNull(context) { "Transport command '$method' arrived before the provider was attached" }
    if (!callerSharesSignature()) {
      throw SecurityException("Transport command '$method' refused: uid ${Binder.getCallingUid()} is signed differently")
    }
    val command =
      when (method) {
        METHOD_NEXT -> BackgroundExecutionService.TRANSPORT_COMMAND_NEXT
        METHOD_PREVIOUS -> BackgroundExecutionService.TRANSPORT_COMMAND_PREVIOUS
        else -> throw IllegalArgumentException("Unknown transport command '$method'")
      }
    val wasInFront = ForegroundPresence.answerCompanionCommand()
    context.sendBroadcast(
      Intent(BackgroundExecutionService.ACTION_TRANSPORT_COMMAND)
        .setPackage(context.packageName)
        .putExtra(BackgroundExecutionService.EXTRA_TRANSPORT_COMMAND, command),
    )
    AppLogger.info(context, TAG, "Companion transport command ($method), app in front: $wasInFront", TAG)
    return Bundle().apply { putBoolean(RESULT_WAS_IN_FRONT, wasInFront) }
  }

  internal open fun callerSharesSignature(): Boolean =
    requireNotNull(context).packageManager.checkSignatures(Binder.getCallingUid(), Process.myUid()) ==
      PackageManager.SIGNATURE_MATCH

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, args: Array<String>?, order: String?): Cursor? =
    null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?) = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?) = 0
}
