package com.ikerlorente11.estanteria.host

import fi.iki.elonen.NanoHTTPD
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** The event stream: each event reaches the page as soon as it is sent, and dead streams go away. */
class EventsTest {
    private fun line(text: String) = "data: $text\n\n".toByteArray()

    /** Reads from [input] on another thread until [wanted] shows up (or [ms] pass); everything read so far. */
    private fun readUntil(input: InputStream, wanted: String, ms: Long): String {
        val seen = StringBuilder()
        val pool = Executors.newSingleThreadExecutor()
        try {
            pool.submit {
                val buffer = ByteArray(16 * 1024)
                while (!synchronized(seen) { seen.contains(wanted) }) {
                    val n = input.read(buffer)
                    if (n < 0) break
                    synchronized(seen) { seen.append(String(buffer, 0, n, Charsets.ISO_8859_1)) }
                }
            }.get(ms, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {
        } finally { pool.shutdownNow() }
        return synchronized(seen) { seen.toString() }
    }

    @Test
    fun aStreamGetsEachEventWholeRightAfterItIsSent() {
        val events = Events()
        val stream = events.open()
        assertTrue(readUntil(stream, "retry: 3000\n\n", 1000).contains("retry: 3000\n\n"))
        events.broadcast(line("{\"type\":\"fetch-progress\",\"done\":1}"))
        assertTrue(readUntil(stream, "\"done\":1}\n\n", 1000).startsWith("data: {\"type\":\"fetch-progress\""))
        events.ping()
        assertEquals(": ping\n\n", readUntil(stream, ": ping\n\n", 1000))
    }

    @Test
    fun closedOrStuckStreamsAreDropped() {
        val events = Events()
        val a = events.open()
        val b = events.open()
        assertEquals(2, events.count())
        a.close()                                     // what NanoHTTPD does when the connection is gone
        assertEquals(1, events.count())
        assertEquals(-1, a.read(ByteArray(8)))
        repeat(600) { events.broadcast(line("x")) }  // b never reads: its queue fills and it is let go
        assertEquals(0, events.count())
        b.close()
    }

    /** The whole way: NanoHTTPD sends the stream as a chunked response to a browser that accepts gzip. */
    private fun throughNanoHttpd(gzip: Boolean): String {
        val events = Events()
        val port = ServerSocket(0).use { it.localPort }
        val server = object : NanoHTTPD("127.0.0.1", port) {
            override fun serve(session: IHTTPSession): Response =
                newChunkedResponse(Response.Status.OK, "text/event-stream; charset=utf-8", events.open()).also {
                    it.setGzipEncoding(false)
                    it.closeConnection(true)
                }
            // what HostServer does; without it NanoHTTPD gzips every text/ answer (setGzipEncoding is overwritten)
            override fun useGzipWhenAccepted(r: Response): Boolean = gzip && super.useGzipWhenAccepted(r)
        }
        server.start(5000, true)
        try {
            Socket("127.0.0.1", port).use { socket ->
                socket.getOutputStream().write("GET /host/events HTTP/1.1\r\nHost: x\r\nAccept: text/event-stream\r\nAccept-Encoding: gzip, deflate, br\r\n\r\n".toByteArray())
                val input = socket.getInputStream()
                val head = readUntil(input, "\r\n\r\n", 2000)
                assertTrue(head, head.startsWith("HTTP/1.1 200"))
                Thread.sleep(200)
                events.broadcast(line("{\"type\":\"fetch-progress\",\"done\":42}"))
                return head + readUntil(input, "\"done\":42}\n\n", 1500)
            }
        } finally {
            events.closeAll()
            server.stop()
        }
    }

    @Test
    fun nanoHttpdDeliversTheEventAtOnceWhenNotGzipped() {
        val got = throughNanoHttpd(gzip = false)
        assertFalse(got, got.contains("Content-Encoding: gzip"))
        assertTrue(got, got.contains("data: {\"type\":\"fetch-progress\",\"done\":42}\n\n"))
    }

    /** The bug: NanoHTTPD's default gzips text/event-stream, and the GZIPOutputStream holds every event back:
     * after the headers (the EventSource opens) only the 10 bytes of the gzip header come, in one chunk. */
    @Test
    fun nanoHttpdsDefaultGzipHoldsTheEventsBack() {
        val got = throughNanoHttpd(gzip = true)
        assertTrue(got, got.contains("Content-Encoding: gzip"))
        val body = got.substringAfter("\r\n\r\n")
        assertEquals("a\r\n".length + 10 + "\r\n".length, body.length)
    }
}
