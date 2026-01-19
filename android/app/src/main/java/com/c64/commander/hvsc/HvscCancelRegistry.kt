package com.c64.commander.hvsc

import java.util.concurrent.ConcurrentHashMap

class HvscCancelRegistry {
  private val tokens = ConcurrentHashMap<String, CancellationToken>()

  fun register(token: String): CancellationToken {
    val cancel = CancellationToken()
    tokens[token] = cancel
    return cancel
  }

  fun cancel(token: String) {
    tokens[token]?.cancel()
  }

  fun remove(token: String) {
    tokens.remove(token)
  }

  class CancellationToken {
    @Volatile private var cancelled = false
    fun cancel() {
      cancelled = true
    }
    fun isCancelled(): Boolean = cancelled
  }
}
