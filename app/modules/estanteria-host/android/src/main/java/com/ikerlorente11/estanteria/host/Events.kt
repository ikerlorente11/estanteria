package com.ikerlorente11.estanteria.host

import org.json.JSONObject
import java.io.InputStream
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** What the host tells the page as it happens (download and upload progress): server-sent events,
 * one stream per open page (`GET /host/events`).
 *
 * Each page gets a [Stream]: an InputStream NanoHTTPD sends as a chunked response. [send] only queues the
 * event (it never blocks the download that reports it); the connection's own thread takes it from the queue
 * and NanoHTTPD writes it at once as one chunk straight to the socket (nothing buffers in between: the
 * server never gzips, see [HostServer.useGzipWhenAccepted]). A page that stops reading (its queue fills) or
 * whose connection is gone (NanoHTTPD closes the stream) is dropped. */
class Events {
    private val streams = CopyOnWriteArrayList<Stream>()

    /** A new stream for a page; it starts telling the browser to come back in 3 s if it gets cut. */
    fun open(): Stream = Stream().also { it.offer(RETRY); streams.add(it) }

    fun send(type: String, payload: JSONObject) = broadcast("data: ${payload.put("type", type)}\n\n".toByteArray(Charsets.UTF_8))

    /** keeps the streams alive through the web view's own timeouts, and finds the dead ones (writing to a
     * closed connection fails, NanoHTTPD then closes the stream) */
    fun ping() = broadcast(PING)

    /** the server stops: every stream ends */
    fun closeAll() { for (stream in streams) stream.close() }

    internal fun broadcast(message: ByteArray) {
        for (stream in streams) if (!stream.offer(message)) stream.close()
    }

    internal fun count() = streams.size

    inner class Stream internal constructor() : InputStream() {
        private val queue = LinkedBlockingQueue<ByteArray>(QUEUED)
        private var current: ByteArray? = null
        private var at = 0
        @Volatile private var closed = false

        internal fun offer(message: ByteArray): Boolean = !closed && queue.offer(message)

        /** One event at most per call, as soon as there is one: NanoHTTPD writes each read as its own chunk. */
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (len == 0) return 0
            var chunk = current
            while (chunk == null || at >= chunk.size) {
                if (closed) return -1
                chunk = try { queue.poll(WAIT_MS, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { close(); return -1 }
                if (chunk === END) { close(); return -1 }
                current = chunk
                at = 0
            }
            val n = minOf(len, chunk.size - at)
            System.arraycopy(chunk, at, b, off, n)
            at += n
            return n
        }

        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
        }

        override fun available(): Int = current?.let { it.size - at } ?: 0

        override fun close() {
            if (closed) return
            closed = true
            streams.remove(this)
            queue.clear()
            queue.offer(END)                                          // wakes the reader up now
        }
    }

    companion object {
        private val RETRY = "retry: 3000\n\n".toByteArray()
        private val PING = ": ping\n\n".toByteArray()
        private val END = ByteArray(0)
        /** events a page may have pending before it counts as gone (a download sends some 4 a second) */
        private const val QUEUED = 512
        /** how long a read waits before looking again whether the stream was closed */
        private const val WAIT_MS = 30_000L
    }
}
