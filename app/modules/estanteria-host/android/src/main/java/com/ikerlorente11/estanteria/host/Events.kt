package com.ikerlorente11.estanteria.host

import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.CopyOnWriteArrayList

/** What the host tells the page as it happens (download and upload progress): server-sent events,
 * one stream per open page (`GET /host/events`). A dead stream is dropped on the first write that fails. */
class Events {
    private val streams = CopyOnWriteArrayList<OutputStream>()

    fun attach(stream: OutputStream) { streams.add(stream) }
    fun detach(stream: OutputStream) { streams.remove(stream) }

    fun send(type: String, payload: JSONObject) {
        val line = "data: ${payload.put("type", type)}\n\n".toByteArray(Charsets.UTF_8)
        for (stream in streams) {
            try {
                synchronized(stream) { stream.write(line); stream.flush() }
            } catch (_: IOException) {
                streams.remove(stream)
                try { stream.close() } catch (_: IOException) {}
            }
        }
    }

    /** keeps the streams alive through proxies and the web view's own timeouts */
    fun ping() {
        for (stream in streams) {
            try { synchronized(stream) { stream.write(": ping\n\n".toByteArray()); stream.flush() } } catch (_: IOException) { streams.remove(stream) }
        }
    }
}
