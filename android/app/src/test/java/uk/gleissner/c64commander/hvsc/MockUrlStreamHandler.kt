package uk.gleissner.c64commander.hvsc

import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLConnection
import java.net.URLStreamHandler
import java.net.URLStreamHandlerFactory
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

object MockUrlStreamHandler {
  private val installed = AtomicBoolean(false)
  private val responses = ConcurrentHashMap<String, ByteArray>()

  fun register(url: String, payload: ByteArray) {
    installIfNeeded()
    responses[url] = payload
  }

  fun clear(url: String) {
    responses.remove(url)
  }

  private fun installIfNeeded() {
    if (!installed.compareAndSet(false, true)) return
    try {
      URL.setURLStreamHandlerFactory(HandlerFactory())
    } catch (_: Error) {
      // Factory already installed.
    }
  }

  private class HandlerFactory : URLStreamHandlerFactory {
    override fun createURLStreamHandler(protocol: String): URLStreamHandler? {
      return if (protocol == "mock") MockHandler() else null
    }
  }

  private class MockHandler : URLStreamHandler() {
    override fun openConnection(u: URL): URLConnection = MockHttpURLConnection(u)
  }

  private class MockHttpURLConnection(url: URL) : HttpURLConnection(url) {
    override fun connect() {
      connected = true
    }

    override fun disconnect() {
      connected = false
    }

    override fun usingProxy(): Boolean = false

    override fun getInputStream(): InputStream {
      val payload = responses[url.toString()] ?: ByteArray(0)
      return ByteArrayInputStream(payload)
    }

    override fun getContentLengthLong(): Long {
      return responses[url.toString()]?.size?.toLong() ?: -1L
    }
  }
}