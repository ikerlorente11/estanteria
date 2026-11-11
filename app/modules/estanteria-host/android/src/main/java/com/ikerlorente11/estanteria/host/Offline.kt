package com.ikerlorente11.estanteria.host

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

/**
 * Reading without connection, like the desktop's offline.rs: an item made available offline is a folder
 * of the app's files (`offline/<account>/<item id>/`) with its pages as the service rendered them
 * (`p/<n>.jpg`…) or the file itself for a book (`file.epub`, `.mobi`, `.fb2`, `.fbz`, `.txt`: named by
 * the item's format, so it is served back as what it is), its cover, and `item.json` (what the service
 * said of it), written last: a folder without it is a download still going or cut short (it resumes). The page reads them at `/offline/<id>/cover|file|p/<n>` without credentials.
 */
class Offline(private val context: Context, private val settings: Settings, private val events: Events) {
    /** the downloads going on, by `<account>/<id>`: setting the flag stops one and deletes what it got */
    private val jobs = ConcurrentHashMap<String, AtomicBoolean>()

    private fun root() = File(context.filesDir, "offline")
    private fun accountDir() = File(root(), settings.accountKey())
    fun itemDir(id: Long) = File(accountDir(), id.toString())

    /** What this account has offline: the item.json of every finished download. */
    fun list(): JSONArray {
        val out = JSONArray()
        accountDir().listFiles()?.forEach { dir ->
            val meta = File(dir, "item.json")
            if (meta.isFile) try { out.put(JSONObject(meta.readText())) } catch (_: Exception) {}
        }
        return out
    }

    fun where(): String = accountDir().absolutePath

    /** Starts making an item available offline, in the background; progress comes as `offline` events. */
    fun start(job: JSONObject) {
        val id = job.getLong("id")
        val key = "${settings.accountKey()}/$id"
        if (jobs.containsKey(key)) return
        val authorization = settings.authorization() ?: throw IllegalStateException("Conecta con tu Archivador primero.")
        Wifi.check(context, settings)       // «solo con wifi»: a 409 with the reason, nothing started
        val stop = AtomicBoolean(false)
        jobs[key] = stop
        val dir = itemDir(id)
        val base = settings.url
        thread(name = "estanteria-offline-$id") {
            val outcome = try { run(dir, base, authorization, job, stop); null } catch (e: Exception) { e.message ?: e.toString() }
            jobs.remove(key)
            if (stop.get()) {
                dir.deleteRecursively()
                events.send("offline", progress(id, 0, 0, 0, null, finished = false, cancelled = true))
            } else if (outcome != null) {
                Log.w("estanteria", "descarga $id: $outcome")
                events.send("offline", progress(id, 0, 0, 0, outcome, finished = false, cancelled = false))
            }
        }
    }

    /** Stops a download going on, or deletes a finished one. */
    fun remove(id: Long) {
        val key = "${settings.accountKey()}/$id"
        jobs[key]?.let { it.set(true); return }
        itemDir(id).deleteRecursively()
    }

    /** The file of a part: `cover`, `file` or `p/<n>`. */
    fun find(id: Long, parts: List<String>): File? {
        val dir = itemDir(id)
        return when {
            parts == listOf("cover") -> stem(dir, "cover")
            parts == listOf("file") -> stem(dir, "file")
            parts.size == 2 && parts[0] == "p" && parts[1].all { it.isDigit() } -> stem(File(dir, "p"), parts[1])
            else -> null
        }
    }

    private fun run(dir: File, base: String, authorization: String, job: JSONObject, stop: AtomicBoolean) {
        val id = job.getLong("id")
        val pages = job.optInt("pages", 0)
        val wholeFile = job.optBoolean("file", false)
        val width = job.optInt("width", 1600)
        val pagesDir = File(dir, "p").also { it.mkdirs() }
        val total = if (wholeFile) 1 else pages
        val done = AtomicInteger(0)
        val bytes = AtomicLong(0)
        fun emit(finished: Boolean) = events.send("offline", progress(id, done.get(), total, bytes.get(), null, finished, cancelled = false))
        emit(false)

        if (stem(dir, "cover") == null) {
            try { save(fetch("$base/api/items/$id/cover", authorization), dir, "cover") } catch (_: Exception) {}
        }
        if (wholeFile) {
            val ext = job.optJSONObject("meta")?.optString("format", "")?.takeIf { it in FILE_FORMATS }
            if (stem(dir, "file") == null) bytes.addAndGet(save(fetch("$base/api/items/$id/file", authorization), dir, "file", ext))
            done.set(1)
        } else {
            val next = AtomicInteger(0)
            var failed: String? = null
            val workers = (1..WORKERS).map {
                thread(name = "estanteria-offline-$id-$it") {
                    while (!stop.get() && failed == null) {
                        val n = next.getAndIncrement()
                        if (n >= pages) return@thread
                        val name = n.toString()
                        if (stem(pagesDir, name) == null) {        // a download cut short resumes where it was
                            try {
                                bytes.addAndGet(save(fetch("$base/api/items/$id/pages/$n?w=$width", authorization), pagesDir, name))
                            } catch (e: Exception) {
                                failed = if (e is WifiOnlyException) Wifi.MESSAGE else "página ${n + 1}: ${e.message}"
                                return@thread
                            }
                        }
                        done.incrementAndGet()
                        emit(false)
                    }
                }
            }
            workers.forEach { it.join() }
            failed?.let { throw IllegalStateException(it) }
        }
        if (stop.get()) return
        val meta = JSONObject().put("item", job.optJSONObject("meta") ?: JSONObject()).put("width", width)
            .put("added", System.currentTimeMillis() / 1000).put("bytes", sizeOf(dir))
        val part = File(dir, "item.json.part")
        part.writeText(meta.toString())
        part.renameTo(File(dir, "item.json"))
        emit(true)
    }

    private fun fetch(url: String, authorization: String): HttpURLConnection {
        // checked for every page: a download that moves from Wi-Fi to mobile data pauses (what it got stays; it resumes)
        Wifi.check(context, settings)
        var last: Exception? = null
        for (attempt in 1..ATTEMPTS) {
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 15_000
                conn.readTimeout = 300_000
                conn.setRequestProperty("Authorization", authorization)
                val code = conn.responseCode
                if (code in 200..299) return conn
                conn.disconnect()
                if (code in 400..499) throw IllegalStateException("HTTP $code")
                last = IllegalStateException("HTTP $code")
            } catch (e: IllegalStateException) {
                throw e
            } catch (e: Exception) {
                last = e
            }
            Thread.sleep(1500L * attempt)
        }
        throw IllegalStateException(last?.message ?: "sin conexión")
    }

    /** Saves what came as `<stem>.<ext>`; the extension, if not given, from the type the service said. */
    private fun save(conn: HttpURLConnection, dir: File, stem: String, given: String? = null): Long {
        val ext = given ?: extensionOf(conn.contentType ?: "")
        val part = File(dir, "$stem.part")
        val written = conn.inputStream.use { input -> FileOutputStream(part).use { input.copyTo(it) } }
        conn.disconnect()
        part.renameTo(File(dir, "$stem.$ext"))
        return written
    }

    private fun progress(id: Long, done: Int, total: Int, bytes: Long, error: String?, finished: Boolean, cancelled: Boolean) =
        JSONObject().put("id", id).put("done", done).put("total", total).put("bytes", bytes)
            .put("error", error ?: JSONObject.NULL).put("finished", finished).put("cancelled", cancelled)

    companion object {
        private const val WORKERS = 2
        private const val ATTEMPTS = 3
        /** the formats kept as the whole file, which are also the extension it is saved with */
        private val FILE_FORMATS = setOf("epub", "mobi", "fb2", "fbz", "txt", "pdf", "djvu")

        /** The file of `dir` whose name, without its extension, is `stem` (never a `.part`). */
        fun stem(dir: File, stem: String): File? =
            dir.listFiles()?.firstOrNull { it.isFile && it.nameWithoutExtension == stem && it.extension != "part" }

        fun sizeOf(dir: File): Long = dir.walkTopDown().filter { it.isFile }.sumOf { it.length() }

        fun extensionOf(mime: String): String = when (mime.substringBefore(';').trim()) {
            "image/jpeg" -> "jpg"
            "image/png" -> "png"
            "image/webp" -> "webp"
            "image/gif" -> "gif"
            "image/avif" -> "avif"
            "application/epub+zip" -> "epub"
            "application/pdf" -> "pdf"
            "application/x-mobipocket-ebook", "application/vnd.amazon.ebook", "application/vnd.amazon.mobi8-ebook", "application/x-mobi8-ebook" -> "mobi"
            "application/x-fictionbook+xml", "application/x-fictionbook", "text/fb2+xml" -> "fb2"
            "application/x-zip-compressed-fb2", "application/x-fictionbook+zip" -> "fbz"
            "text/plain" -> "txt"
            "image/vnd.djvu", "image/x-djvu" -> "djvu"
            "application/vnd.comicbook+zip", "application/zip" -> "cbz"
            "application/x-cbt", "application/x-tar" -> "cbt"
            else -> "bin"
        }

        fun mimeOf(file: File): String = when (file.extension.lowercase()) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "avif" -> "image/avif"
            "epub" -> "application/epub+zip"
            "pdf" -> "application/pdf"
            "mobi" -> "application/x-mobipocket-ebook"
            "fb2" -> "application/x-fictionbook+xml"
            "fbz" -> "application/x-zip-compressed-fb2"
            "txt" -> "text/plain"
            "djvu" -> "image/vnd.djvu"
            "cbz" -> "application/vnd.comicbook+zip"
            "cbt" -> "application/x-cbt"
            else -> "application/octet-stream"
        }
    }
}
