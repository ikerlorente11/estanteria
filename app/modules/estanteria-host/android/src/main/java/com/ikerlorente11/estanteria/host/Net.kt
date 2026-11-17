package com.ikerlorente11.estanteria.host

import android.content.Context
import android.net.Uri
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.URLDecoder
import java.util.concurrent.TimeUnit

/**
 * The network as the app sees it, for the page (the viewer's `NetBackend`, see net.ts): requests to any server
 * (OPDS catalogs, MangaDex, Internet Archive, Komga, Kavita, Calibre-Web, WebDAV…) made here, without the web
 * view's CORS, and files downloaded from them into this device's shelf (`files/catalogo/`, served back by Shelf
 * as file:// URIs). Nothing of the host's own goes there: not its token, not the credential of the user's
 * server (Settings); only the headers the page asks for and a User-Agent of the app.
 *
 * OkHttp (already in the app: React Native's) rather than HttpURLConnection: it follows redirects from http to
 * https and takes any method (PROPFIND, MKCOL… for WebDAV).
 */
class Net(private val context: Context, private val settings: Settings, private val events: Events) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    private val userAgent: String by lazy {
        val version = try { context.packageManager.getPackageInfo(context.packageName, 0).versionName } catch (_: Exception) { null }
        "LaEstanteria/${version ?: HostServer.version} (Android)"
    }

    /** The address asked for, if it is an absolute http or https one. */
    fun target(url: String?): HttpUrl {
        val given = url?.trim().orEmpty()
        if (given.isEmpty()) throw IllegalArgumentException("Falta la dirección que pedir (url).")
        val scheme = given.substringBefore(':', "").lowercase()
        if (scheme != "http" && scheme != "https") throw IllegalArgumentException("Solo se pueden pedir direcciones http o https.")
        return given.toHttpUrlOrNull() ?: throw IllegalArgumentException("La dirección no es válida: $given")
    }

    /** Makes a request with the headers the page gave (a JSON object; those of the connection itself and the
     * host's own are left out). The caller closes the response. Throws IOException when there is no answer. */
    fun call(url: HttpUrl, method: String, headers: JSONObject?, body: ByteArray?, contentType: String?): okhttp3.Response {
        val builder = Request.Builder().url(url)
        var type = contentType
        var agent = false
        headers?.keys()?.forEach { name ->
            val value = headers.optString(name, "")
            val lower = name.lowercase()
            when {
                lower in DROPPED || lower.startsWith("proxy-") -> {}
                lower == "authorization" && value.startsWith("Host ") -> {}
                lower == "content-type" -> type = value
                else -> {
                    try { builder.header(name, value) } catch (e: IllegalArgumentException) {
                        throw IllegalArgumentException("La cabecera «$name» no es válida.")
                    }
                    if (lower == "user-agent") agent = true
                }
            }
        }
        if (!agent) builder.header("User-Agent", userAgent)
        val m = method.uppercase()
        val media = type?.toMediaTypeOrNull()
        val requestBody = when {
            m == "GET" || m == "HEAD" -> null
            body != null && body.isNotEmpty() -> body.toRequestBody(media)
            m in NEEDS_BODY -> ByteArray(0).toRequestBody(media)
            else -> null
        }
        if (requestBody != null && media == null && !type.isNullOrBlank()) builder.header("Content-Type", type!!)
        builder.method(m, requestBody)
        return client.newCall(builder.build()).execute()
    }

    /** The downloads asked to stop (by their address), until they see it. */
    private val cancelled = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    /** Stops the download of that address going on: what it got is deleted. */
    fun cancel(url: String) { cancelled.add(url.trim()) }

    /**
     * Downloads `url` into the catalog folder as `name` (cleaned: no folders, the extension kept, « (2)» added
     * rather than overwrite) and answers its file:// URI, which Shelf.addFile takes. The progress goes to the
     * page as `fetch-progress` events `{url, done, total}` (total 0 while unknown). What failed leaves nothing.
     */
    fun download(url: String?, name: String?, headers: JSONObject?, folder: String? = null): String {
        val target = target(url)
        Wifi.check(context, settings)       // «solo con wifi»: a 409 with the reason, nothing started
        val response = try { call(target, "GET", headers, null, null) } catch (e: IOException) {
            throw IllegalStateException("Sin conexión con ${target.host}: ${e.message ?: e.javaClass.simpleName}")
        }
        response.use {
            if (!response.isSuccessful) throw IllegalStateException("${response.request.url.host} respondió ${response.code}: no se pudo descargar.")
            val body = response.body ?: throw IllegalStateException("${target.host} no mandó nada.")
            val total = body.contentLength().coerceAtLeast(0)
            val file = reserve(fileName(name, response.header("Content-Disposition"), response.header("Content-Type")), folder)
            val key = url!!.trim()
            cancelled.remove(key)
            try {
                var done = 0L
                var last = 0L
                events.send("fetch-progress", progress(key, 0, total))
                body.byteStream().use { input ->
                    FileOutputStream(file).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            if (key in cancelled) throw IOException("cancelada")
                            val n = input.read(buffer)
                            if (n < 0) break
                            output.write(buffer, 0, n)
                            done += n
                            val now = System.currentTimeMillis()
                            if (now - last >= 250) { last = now; events.send("fetch-progress", progress(key, done, total)) }
                        }
                    }
                }
                if (total > 0 && done < total) throw IOException("la descarga se cortó ($done de $total bytes)")
                events.send("fetch-progress", progress(key, done, if (total > 0) total else done))
            } catch (e: Exception) {
                file.delete()
                throw IllegalStateException("No se pudo descargar «${file.name}»: ${e.message ?: e.javaClass.simpleName}")
            } finally {
                cancelled.remove(key)
            }
            return Uri.fromFile(file).toString()
        }
    }

    /**
     * Saves a file the page made (a manga chapter packed as CBZ…) into the catalog folder, like `download`: the
     * `length` bytes of `input` (the request's body, streamed to disk, never whole in memory), named as `name`
     * cleaned (« (2)» rather than overwrite). Answers its file:// URI; what failed leaves nothing.
     */
    fun save(name: String?, folder: String?, input: InputStream, length: Long): String {
        if (length <= 0) throw IllegalArgumentException("No llegó ningún archivo que guardar.")
        val file = reserve(fileName(name, null, null), folder)
        try {
            FileOutputStream(file).use { output ->
                val buffer = ByteArray(64 * 1024)
                var left = length
                while (left > 0) {
                    val n = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
                    if (n < 0) break
                    output.write(buffer, 0, n)
                    left -= n
                }
                if (left > 0) throw IOException("llegaron ${length - left} de $length bytes")
            }
        } catch (e: Exception) {
            file.delete()
            throw IllegalStateException("No se pudo guardar «${file.name}»: ${e.message ?: e.javaClass.simpleName}")
        }
        return Uri.fromFile(file).toString()
    }

    // ---- a file the page writes a piece at a time, as it comes (a Telegram file of hundreds of MB): saveStream ----
    /** One being written: the pieces go to `part`, a hidden `.part` in the folder it will end in (so a file half
     * written never looks like a comic); `close` gives it its name. */
    private class Stream(val name: String, val folder: String?, val part: File) {
        var size = 0L
        @Volatile var touched = System.currentTimeMillis()
    }
    private val streams = java.util.concurrent.ConcurrentHashMap<String, Stream>()

    /** Starts a file to be written by pieces; answers its id. Forgotten ones (an hour without a piece) and the
     * `.part` files no stream owns (the app closed halfway) are deleted first. */
    fun openStream(name: String?, folder: String?): String = synchronized(streams) {
        // under the lock: the sweep never sees a `.part` made before its stream is known
        sweepStreams()
        val dir = dirOf(folder)
        val id = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val part = File(dir, ".$id$PART")
        if (!part.createNewFile()) throw IllegalStateException("No se pudo empezar a guardar el archivo.")
        streams[id] = Stream(fileName(name, null, null), folder, part)
        id
    }

    /** The next piece of stream `id`: the `length` bytes of `input` (the request's body, never whole in memory),
     * after the others. A piece cut halfway is taken back, so the file stays as it was. Answers the size so far. */
    fun writeStream(id: String, input: InputStream, length: Long): Long {
        val stream = streams[id] ?: throw IllegalArgumentException(GONE)
        synchronized(stream) {
            if (streams[id] !== stream) throw IllegalArgumentException(GONE)
            stream.touched = System.currentTimeMillis()
            if (length <= 0) return stream.size
            try {
                FileOutputStream(stream.part, true).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var left = length
                    while (left > 0) {
                        val n = input.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        left -= n
                    }
                    if (left > 0) throw IOException("llegaron ${length - left} de $length bytes")
                }
            } catch (e: Exception) {
                try { java.io.RandomAccessFile(stream.part, "rw").use { it.setLength(stream.size) } } catch (_: Exception) {}
                throw IllegalStateException("No se pudo guardar «${stream.name}»: ${e.message ?: e.javaClass.simpleName}")
            }
            stream.size += length
            stream.touched = System.currentTimeMillis()
            return stream.size
        }
    }

    /** Stream `id` is whole: it gets the first free name (`x.cbz`, `x (2).cbz`…) and its file:// URI is answered,
     * what Shelf.addFile takes. Done or failed, the stream is over. */
    fun closeStream(id: String): String {
        val stream = streams[id] ?: throw IllegalArgumentException(GONE)
        synchronized(stream) {
            if (streams.remove(id) !== stream) throw IllegalArgumentException(GONE)
            if (stream.size <= 0) {
                drop(stream)
                throw IllegalArgumentException("No llegó ningún archivo que guardar.")
            }
            val file = try { reserve(stream.name, stream.folder) } catch (e: Exception) { drop(stream); throw e }
            // the empty file reserve made is replaced (a rename in the same folder: nothing copied)
            if (!stream.part.renameTo(file)) {
                file.delete()
                drop(stream)
                throw IllegalStateException("No se pudo guardar «${file.name}».")
            }
            return Uri.fromFile(file).toString()
        }
    }

    /** Stream `id` is given up: what it wrote is deleted. One already over is fine. */
    fun abortStream(id: String) {
        val stream = streams.remove(id) ?: return
        synchronized(stream) { drop(stream) }
    }

    private fun drop(stream: Stream) {
        stream.part.delete()
        // the series' folder, when it was made for this one only
        stream.part.parentFile?.takeIf { it.canonicalFile != folder(context).canonicalFile && it.list()?.isEmpty() == true }?.delete()
    }

    private fun sweepStreams() {
        val old = System.currentTimeMillis() - STREAM_IDLE
        for ((id, stream) in streams) if (stream.touched < old) abortStream(id)
        val owned = streams.values.map { it.part.name }.toSet()
        val root = folder(context)
        val dirs = listOf(root) + (root.listFiles { f -> f.isDirectory }?.toList() ?: emptyList())
        for (dir in dirs) {
            dir.listFiles { f -> f.isFile && f.name.endsWith(PART) && f.name !in owned }?.forEach { it.delete() }
        }
    }

    /** The folder a file goes in: the catalog folder, or the folder of its series in it (one level, cleaned). */
    private fun dirOf(series: String?): File {
        val sub = clean(series.orEmpty()).trim('.', ' ')
        return (if (sub.isEmpty()) folder(context) else File(folder(context), sub)).also { it.mkdirs() }
    }

    private fun progress(url: String, done: Long, total: Long) = JSONObject().put("url", url).put("done", done).put("total", total)

    /** The name to save with: the one given, cleaned; with an extension the shelf knows when it had none, taken
     * from what the server said (Content-Disposition, Content-Type). */
    private fun fileName(given: String?, disposition: String?, contentType: String?): String {
        var name = clean(given.orEmpty())
        if (Shelf.formatOf(name) == null) {
            val ext = dispositionName(disposition)?.let { clean(it) }?.takeIf { Shelf.formatOf(it) != null }?.let { extensionOf(it) }
                ?: Offline.extensionOf(contentType ?: "").takeIf { Shelf.formatOf("x.$it") != null }
            if (ext != null) name = if (name.isEmpty()) "descarga.$ext" else "$name.$ext"
        }
        return name.ifEmpty { "descarga" }
    }

    /** Makes the file, empty, with the first free name (`x.epub`, `x (2).epub`…), so two downloads never share it;
     * in the folder of its series (`series`, one level, cleaned) when there is one. */
    private fun reserve(name: String, series: String? = null): File {
        val dir = dirOf(series)
        val ext = extensionOf(name).let { if (it.isEmpty()) "" else ".$it" }
        val stem = name.removeSuffix(ext).ifEmpty { "descarga" }
        synchronized(LOCK) {
            var n = 1
            while (true) {
                val file = File(dir, if (n == 1) "$stem$ext" else "$stem ($n)$ext")
                if (file.createNewFile()) return file
                n++
                if (n > 10_000) throw IllegalStateException("No hay nombre libre para «$name».")
            }
        }
    }

    companion object {
        private val LOCK = Any()
        /** never passed on: the connection's own, those OkHttp sets itself, and the host's */
        private val DROPPED = setOf("host", "connection", "keep-alive", "upgrade", "te", "trailer", "transfer-encoding",
            "content-length", "accept-encoding", "x-host-token", "x-fetch-headers", "cookie2")
        private val NEEDS_BODY = setOf("POST", "PUT", "PATCH", "PROPPATCH", "REPORT")
        /** the end of a file being written by pieces (see openStream) */
        private const val PART = ".part"
        /** a stream without a piece for this long was forgotten by the page: it is deleted */
        private const val STREAM_IDLE = 60 * 60 * 1000L
        private const val GONE = "Ese archivo ya no se está guardando (se canceló o tardó demasiado)."

        /** where the files downloaded from catalogs go (the app's own; Shelf serves them as file:// URIs) */
        fun folder(context: Context) = File(context.filesDir, "catalogo")

        /** A file name without folders nor what file systems refuse, not hidden, and not too long (extension kept). */
        fun clean(given: String): String {
            var name = given.replace(Regex("[\\\\/:*?\"<>|\\x00-\\x1f\\x7f]"), "_").trim().trimStart('.').trim()
            if (name.length > 150) {
                val ext = extensionOf(name).let { if (it.isEmpty()) "" else ".$it" }
                name = name.removeSuffix(ext).take(150 - ext.length).trim() + ext
            }
            return name
        }

        /** `fb2.zip` for an FBZ, else what follows the last dot (short enough to be one), or "". */
        fun extensionOf(name: String): String {
            if (name.lowercase().endsWith(".fb2.zip")) return name.takeLast(7)
            val dot = name.lastIndexOf('.')
            if (dot <= 0) return ""
            val ext = name.substring(dot + 1)
            return if (ext.isNotEmpty() && ext.length <= 10 && !ext.contains(' ')) ext else ""
        }

        /** The file name of a Content-Disposition (`filename*=UTF-8''…` before `filename="…"`). */
        fun dispositionName(header: String?): String? {
            if (header == null) return null
            Regex("filename\\*\\s*=\\s*([^']*)'[^']*'([^;]+)", RegexOption.IGNORE_CASE).find(header)?.let {
                val charset = it.groupValues[1].ifBlank { "UTF-8" }
                return try { URLDecoder.decode(it.groupValues[2].trim().replace("+", "%2B"), charset) } catch (_: Exception) { null }
            }
            return Regex("filename\\s*=\\s*(\"([^\"]*)\"|[^;]+)", RegexOption.IGNORE_CASE).find(header)?.let {
                it.groupValues[2].ifEmpty { it.groupValues[1] }.trim()
            }
        }
    }
}
