package com.ikerlorente11.estanteria.host

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.Log
import org.apache.commons.compress.archivers.sevenz.SevenZFile
import org.apache.commons.compress.archivers.zip.ZipFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.ByteArrayOutputStream
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
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
 *
 * A comic archive or a PDF of the service's own comes whole (nothing for the service to render: much faster) as
 * `file.<format>`: a cbz, cbr, cb7 or cbt is unpacked into `p/` there and then (and the archive goes); a PDF stays,
 * and its pages are rendered here as they are read (`p/<n>.jpg`, the next two ahead). If that does not work out
 * (its pages are not as many as the service counts…), page by page as before.
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

    /** The file of a part: `cover`, `file` or `p/<n>` (a kept PDF's page rendered now, if it was not yet). */
    fun find(id: Long, parts: List<String>): File? {
        val dir = itemDir(id)
        return when {
            parts == listOf("cover") -> stem(dir, "cover")
            parts == listOf("file") -> stem(dir, "file")
            parts.size == 2 && parts[0] == "p" && parts[1].all { it.isDigit() } -> stem(File(dir, "p"), parts[1]) ?: pdfPage(dir, parts[1].toInt())
            else -> null
        }
    }

    // ---- a kept PDF: its pages rendered as they are read ----
    private val rendering = Any()

    private fun pdfPage(dir: File, n: Int, ahead: Boolean = true): File? {
        val pdf = File(dir, "file.pdf").takeIf { it.isFile && File(dir, "item.json").isFile } ?: return null
        val pages = File(dir, "p").also { it.mkdirs() }
        val out = File(pages, "$n.jpg")
        synchronized(rendering) {          // PdfRenderer renders one page at a time
            if (!out.isFile) {
                val width = try { JSONObject(File(dir, "item.json").readText()).optInt("width", 1600) } catch (_: Exception) { 1600 }
                val jpeg = try { renderPdf(pdf, n, width.coerceIn(300, 3200)) } catch (e: Exception) { Log.w("estanteria", "página $n del PDF: ${e.message}"); return null }
                val part = File(pages, "$n.jpg.part")
                part.writeBytes(jpeg)
                part.renameTo(out)
            }
        }
        // the next ones too, so turning the page does not wait
        if (ahead) thread(name = "estanteria-pdf-ahead") { for (k in n + 1..n + 2) if (!File(pages, "$k.jpg").isFile && pdfPage(dir, k, ahead = false) == null) break }
        return out
    }

    private fun renderPdf(file: File, n: Int, width: Int): ByteArray =
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
            PdfRenderer(pfd).use { pdf ->
                if (n < 0 || n >= pdf.pageCount) throw IllegalArgumentException("esa página no existe")
                pdf.openPage(n).use { page ->
                    val height = (width.toLong() * page.height / page.width).toInt().coerceAtLeast(1)
                    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                    Canvas(bitmap).drawColor(Color.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    val bytes = ByteArrayOutputStream()
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 88, bytes)
                    bitmap.recycle()
                    bytes.toByteArray()
                }
            }
        }

    private fun pdfPageCount(file: File): Int =
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd -> PdfRenderer(pfd).use { it.pageCount } }

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
        val meta = job.optJSONObject("meta") ?: JSONObject()
        val archive = meta.optString("format", "").takeIf { it in ARCHIVES && meta.isNull("source_id") }
        var whole = false
        if (!wholeFile && archive != null && stem(pagesDir, "0") == null) {
            // the file whole, its pages here; if it does not work out, page by page
            try {
                whole = fromFile(dir, pagesDir, "$base/api/items/$id/file", authorization, archive, pages, stop) { got, length ->
                    bytes.set(got)
                    if (length > 0) done.set(((got.toDouble() / length) * pages).toInt().coerceAtMost((pages - 1).coerceAtLeast(0)))
                    emit(false)
                }
            } catch (e: Exception) {
                if (stop.get()) return
                if (e is WifiOnlyException) throw IllegalStateException(Wifi.MESSAGE)
                Log.w("estanteria", "descarga $id: el archivo entero no sirvió (${e.message}); página a página")
                pagesDir.deleteRecursively(); pagesDir.mkdirs()
                File(dir, "file.$archive").delete()
                done.set(0); bytes.set(0)
            }
        }
        if (whole) {
            done.set(pages)
        } else if (wholeFile) {
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
        val kept = JSONObject().put("item", job.optJSONObject("meta") ?: JSONObject()).put("width", width)
            .put("added", System.currentTimeMillis() / 1000).put("bytes", sizeOf(dir))
        val part = File(dir, "item.json.part")
        part.writeText(kept.toString())
        part.renameTo(File(dir, "item.json"))
        emit(true)
    }

    /**
     * Downloads the whole archive or PDF as `file.<format>` (telling how much came, of how much) and gets its pages
     * ready: a comic archive unpacked into `pages` (the archive then goes), a PDF only counted (rendered as read).
     * They must be as many as the service counts, so the reader's page numbers are the same. True when done.
     */
    private fun fromFile(dir: File, pages: File, url: String, authorization: String, format: String, expected: Int, stop: AtomicBoolean,
                         progress: (Long, Long) -> Unit): Boolean {
        val target = File(dir, "file.$format")
        if (!target.isFile) {
            val conn = fetch(url, authorization)
            val length = conn.contentLengthLong
            val part = File(dir, "file.$format.part")
            var got = 0L
            conn.inputStream.use { input ->
                FileOutputStream(part).use { output ->
                    val buffer = ByteArray(1 shl 16)
                    var told = 0L
                    while (true) {
                        if (stop.get()) throw IllegalStateException("cancelada")
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        got += n
                        if (got - told >= 1 shl 20) { told = got; progress(got, length) }
                    }
                }
            }
            conn.disconnect()
            if (length > 0 && got != length) { part.delete(); throw IllegalStateException("el archivo llegó a medias") }
            part.renameTo(target)
            progress(got, length)
        }
        if (stop.get()) return false
        val real = containerOf(target, format)
        val count = if (real == "pdf") pdfPageCount(target) else unpack(target, real, pages)
        if (count != expected) {
            pages.deleteRecursively(); pages.mkdirs()
            throw IllegalStateException("tiene $count páginas y el servicio cuenta $expected")
        }
        if (real != "pdf") target.delete()            // its pages are here now
        return true
    }

    /** What an archive really is by its first bytes (many a .cbr is a zip inside). */
    private fun containerOf(file: File, format: String): String {
        if (format == "pdf") return format
        val head = ByteArray(512)
        val n = FileInputStream(file).use { it.read(head) }.coerceAtLeast(0)
        val h = head.copyOf(n)
        return when {
            h.size >= 6 && h.copyOf(6).contentEquals(byteArrayOf(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07)) -> "cbr"
            h.size >= 4 && h.copyOf(4).contentEquals(byteArrayOf(0x50, 0x4b, 0x03, 0x04)) -> "cbz"
            h.size >= 6 && h.copyOf(6).contentEquals(byteArrayOf(0x37, 0x7a, 0xbc.toByte(), 0xaf.toByte(), 0x27, 0x1c)) -> "cb7"
            Tar.isTar(h) -> "cbt"
            else -> format
        }
    }

    /** The pages of a cbz, cbr, cb7 or cbt into `pages/<n>.<ext>`, in the order the reader shows them (a JPEG XL
     * one made JPEG: the web view cannot show it); how many. */
    private fun unpack(file: File, format: String, pages: File): Int {
        pages.deleteRecursively(); pages.mkdirs()
        val names = mutableListOf<Pair<String, File>>()
        fun keep(name: String, stream: InputStream) {
            if (!Shelf.isPage(name)) return
            val tmp = File(pages, "x${names.size}.part")
            FileOutputStream(tmp).use { stream.copyTo(it) }
            names.add(name to tmp)
        }
        when (format) {
            "cbz" -> ZipFile.builder().setFile(file).get().use { zip ->
                for (entry in zip.entries.toList()) if (!entry.isDirectory) zip.getInputStream(entry).use { keep(entry.name, it) }
            }
            "cbt" -> FileInputStream(file).use { stream ->
                val ch = stream.channel
                for (e in Tar.index(ch, { name: String -> Shelf.isPage(name) }, Shelf.NATURAL)) keep(e.name, Tar.read(ch, e).inputStream())
            }
            "cb7" -> SevenZFile.builder().setFile(file).get().use { sz ->
                while (true) {
                    val entry = sz.nextEntry ?: break
                    if (!entry.isDirectory) keep(entry.name, sz.getInputStream(entry))
                }
            }
            else -> Rar.forEach(file, { name: String -> Shelf.isPage(name) }, ::keep)
        }
        if (names.isEmpty()) throw IllegalStateException("no tiene imágenes")
        names.sortWith { a, b -> Shelf.NATURAL.compare(a.first, b.first) }
        names.forEachIndexed { n, (name, tmp) ->
            if (Images.needsJpeg(name)) {
                File(pages, "$n.jpg").writeBytes(Images.toJpeg(tmp.readBytes()))
                tmp.delete()
            } else {
                tmp.renameTo(File(pages, "$n.${name.substringAfterLast('.').lowercase()}"))
            }
        }
        return names.size
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
        /** what of the service's own comes whole and gets its pages here */
        private val ARCHIVES = setOf("cbz", "cbr", "cb7", "cbt", "pdf")
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
