package com.ikerlorente11.estanteria.host

import android.app.Activity
import android.content.Context
import android.util.Log
import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.Timer
import java.util.TimerTask

/**
 * The local server the web view talks to, on 127.0.0.1 only. It serves the viewer's page (built into
 * the module's assets, `viewer/`), proxies the service of the user's Archivador adding their credential
 * (so the page never holds the app password and there is no CORS to configure), and is the «host» the
 * viewer's backends talk to: the settings, the files of this device (`shelf`) and the downloads for
 * reading offline (`offline`). Everything but the page's own files needs the token given at start
 * (`?t=` or the `X-Host-Token` header): other apps on the device can reach this port too.
 *
 * The port is fixed (the page's localStorage, where the reader's settings and the pending progress
 * live, belongs to the origin, port included); the next ones are tried only if it is taken.
 */
class HostServer(private val context: Context, port: Int, picker: Picker, activity: () -> Activity?) : NanoHTTPD("127.0.0.1", port) {
    val token: String = ByteArray(24).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    val settings = Settings(context)
    val events = Events()
    private val shelf = Shelf(context, settings, events, picker)
    private val offline = Offline(context, settings, events)
    private val net = Net(context, settings, events)
    private val lock = Lock(context, activity)
    private val files = Files(context, picker, activity, { listeningPort }, { token },
        original = { path -> Regex("""^/shelf/f/(\d+)""").find(path)?.let { shelf.original(it.groupValues[1].toLong()) } },
        keptPages = { id -> offline.itemDir(id).takeIf { d -> java.io.File(d, "item.json").isFile && java.io.File(d, "p").listFiles()?.isNotEmpty() == true } })
    private val pinger = Timer("estanteria-events", true)

    override fun start() {
        super.start(SOCKET_READ_TIMEOUT, false)
        pinger.schedule(object : TimerTask() { override fun run() = events.ping() }, 20_000L, 20_000L)
    }

    override fun stop() {
        pinger.cancel()
        events.closeAll()
        super.stop()
    }

    /** Never gzip. NanoHTTPD decides it per response after [serve] (whatever `setGzipEncoding(false)` said):
     * any `text/` or JSON type when the browser accepts gzip. On the loopback it only costs time, and it broke
     * the event stream: a GZIPOutputStream keeps what it is given until the response ends, so the page got the
     * headers (the EventSource opened) but no event ever came through. */
    override fun useGzipWhenAccepted(r: Response): Boolean = false

    /** One connection per request: NanoHTTPD's keep-alive loses the odd request when the browser reuses a
     * connection it is closing (a «Failed to fetch» now and then); on the loopback a new one costs nothing. */
    override fun serve(session: IHTTPSession): Response = answer(session).also { cors(it); it.closeConnection(true) }

    /** The page may come from another origin while developing (Vite on the PC): the token still guards everything. */
    private fun cors(response: Response) {
        response.addHeader("Access-Control-Allow-Origin", "*")
        response.addHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Host-Token, Range, X-Fetch-Headers")
        response.addHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY")
        response.addHeader("Access-Control-Expose-Headers", EXPOSED)
    }

    private fun answer(session: IHTTPSession): Response {
        val path = session.uri
        return try {
            when {
                session.method == Method.OPTIONS -> newFixedLengthResponse(Response.Status.NO_CONTENT, "text/plain", "")
                path == "/" || path.startsWith("/assets/") || path.startsWith("/icons/") || path == "/favicon.ico" -> page(path)
                !authorized(session) -> json(Response.Status.UNAUTHORIZED, JSONObject().put("detail", "falta el token del host"))
                path.startsWith("/api/") || path.startsWith("/opds/") -> proxy(session)
                path == "/host/info" -> json(Response.Status.OK, info())
                path == "/host/settings" -> settingsRoute(session)
                path == "/host/prefs" -> prefsRoute(session)
                path == "/host/lock" -> lockRoute(session)
                path == "/host/file" -> fileRoute(session)
                path == "/host/events" -> eventStream()
                path == "/host/fetch" -> fetchRoute(session)
                path.startsWith("/host/shelf") -> shelfRoute(session, path.removePrefix("/host/shelf").trimStart('/'))
                path.startsWith("/shelf/") -> shelfFile(session, path.removePrefix("/shelf/"))
                path.startsWith("/host/offline") -> offlineRoute(session, path.removePrefix("/host/offline").trimStart('/'))
                path.startsWith("/offline/") -> offlineFile(path.removePrefix("/offline/"))
                else -> json(Response.Status.NOT_FOUND, JSONObject().put("detail", "no existe $path"))
            }
        } catch (e: WifiOnlyException) {
            json(Response.Status.CONFLICT, JSONObject().put("detail", e.message))
        } catch (e: IllegalArgumentException) {
            json(Response.Status.BAD_REQUEST, JSONObject().put("detail", e.message ?: e.toString()))
        } catch (e: Exception) {
            Log.w("estanteria", "error sirviendo $path", e)
            json(Response.Status.INTERNAL_ERROR, JSONObject().put("detail", e.message ?: e.toString()))
        }
    }

    /** The token in the header the host calls use, in `Authorization: Host <token>` (what the viewer's
     * API sends, since the real credential is added here) or in `?t=` (images and files). */
    private fun authorized(session: IHTTPSession): Boolean {
        val given = session.headers["x-host-token"]
            ?: session.headers["authorization"]?.takeIf { it.startsWith("Host ") }?.removePrefix("Host ")
            ?: session.parameters["t"]?.firstOrNull()
        return given == token
    }

    // ---- the page: the viewer built into the assets ----
    private fun page(path: String): Response {
        val name = if (path == "/") "index.html" else path.trimStart('/')
        // the viewer an update brought (see Viewer), else the APK's own
        val stream = Viewer.file(name)?.inputStream() ?: try { context.assets.open("viewer/$name") } catch (_: Exception) {
            return json(Response.Status.NOT_FOUND, JSONObject().put("detail", "no existe $path"))
        }
        val response = newChunkedResponse(Response.Status.OK, mimeOf(name), stream)
        response.setGzipEncoding(false)
        if (name != "index.html") response.addHeader("Cache-Control", "max-age=31536000, immutable")
        return response
    }

    private fun info(): JSONObject = JSONObject()
        .put("version", version)
        .put("shelf", true)
        .put("offline", true)
        .put("volumeKeys", true)
        .put("wifiOnly", true)
        .put("lock", true)
        .put("saveAs", true)
        .put("share", true)

    // ---- the files and folders of this device (see Shelf) ----
    private fun shelfRoute(session: IHTTPSession, rest: String): Response {
        val parts = rest.split('/').filter { it.isNotEmpty() }
        val m = session.method
        val body by lazy { JSONObject(readBody(session)) }
        return when {
            parts.isEmpty() && m == Method.GET -> json(Response.Status.OK, shelf.config())
            parts == listOf("scan") -> jsonArray(shelf.scan())
            parts == listOf("pick") && m == Method.POST ->
                jsonArray(if (session.parameters["kind"]?.firstOrNull() == "folders") shelf.pickFolders() else shelf.pickFiles())
            parts == listOf("roots") && m == Method.POST -> json(Response.Status.OK, shelf.addRoot(body.getString("path")))
            parts.size == 2 && parts[0] == "roots" && m == Method.DELETE -> { shelf.removeRoot(parts[1].toInt()); empty() }
            parts.size == 2 && parts[0] == "roots" && m == Method.PATCH -> { shelf.renameRoot(parts[1].toInt(), body.getString("name")); empty() }
            parts == listOf("fetch") && m == Method.POST ->
                json(Response.Status.OK, JSONObject().put("uri", net.download(body.optString("url"), body.optString("name"), body.optJSONObject("headers"), body.optString("folder"))))
            parts == listOf("save") && m == Method.POST ->
                json(Response.Status.OK, JSONObject().put("uri", net.save(session.parameters["name"]?.firstOrNull(), session.parameters["folder"]?.firstOrNull(), session.inputStream,
                    session.headers["content-length"]?.toLongOrNull() ?: -1L)))
            parts == listOf("files") && m == Method.POST -> json(Response.Status.OK, shelf.addFile(body.getString("path")))
            parts.size == 2 && parts[0] == "files" && m == Method.DELETE -> { shelf.removeFile(parts[1].toLong()); empty() }
            parts.size == 2 && parts[0] == "prepare" && m == Method.POST -> json(Response.Status.OK, shelf.prepare(parts[1].toLong()))
            parts == listOf("cache") && m == Method.PUT -> { shelf.setCacheLimit(body.getLong("bytes")); empty() }
            parts == listOf("cache") && m == Method.DELETE -> { shelf.clearCache(); empty() }
            parts.size == 2 && parts[0] == "reveal" -> json(Response.Status.NOT_IMPLEMENTED, JSONObject().put("detail", "En Android no hay explorador que abrir."))
            parts.size == 2 && parts[0] == "upload" && m == Method.POST -> json(Response.Status.OK, shelf.upload(parts[1].toLong(), body.getString("dest")))
            else -> json(Response.Status.NOT_FOUND, JSONObject().put("detail", "no existe /host/shelf/$rest"))
        }
    }

    /** `/shelf/c/<id>`, `/shelf/p/<id>/<n>?w=`, `/shelf/f/<id>` */
    private fun shelfFile(session: IHTTPSession, rest: String): Response {
        val parts = rest.split('/').filter { it.isNotEmpty() }
        val id = parts.getOrNull(1)?.toLongOrNull() ?: throw IllegalArgumentException("qué archivo")
        return when (parts[0]) {
            "c" -> shelf.cover(id).let { (stream, mime) -> binary(stream, mime, -1, cache = true) }
            "p" -> {
                val n = parts.getOrNull(2)?.toIntOrNull() ?: throw IllegalArgumentException("qué página")
                shelf.page(id, n, session.parameters["w"]?.firstOrNull()?.toIntOrNull()).let { (stream, mime) -> binary(stream, mime, -1, cache = true) }
            }
            "f" -> shelf.file(id).let { (stream, mime, size) -> ranged(session, stream, mime, size) }
            else -> json(Response.Status.NOT_FOUND, JSONObject().put("detail", "no existe /shelf/$rest"))
        }
    }

    // ---- what is kept for reading offline (see Offline) ----
    private fun offlineRoute(session: IHTTPSession, rest: String): Response {
        val parts = rest.split('/').filter { it.isNotEmpty() }
        val m = session.method
        return when {
            parts.isEmpty() && m == Method.GET -> jsonArray(offline.list())
            parts.isEmpty() && m == Method.POST -> { offline.start(JSONObject(readBody(session))); empty() }
            parts == listOf("where") -> text(offline.where())
            parts.size == 1 && m == Method.DELETE -> { offline.remove(parts[0].toLong()); empty() }
            else -> json(Response.Status.NOT_FOUND, JSONObject().put("detail", "no existe /host/offline/$rest"))
        }
    }

    /** `/offline/<id>/cover`, `/file`, `/p/<n>` */
    private fun offlineFile(rest: String): Response {
        val parts = rest.split('/').filter { it.isNotEmpty() }
        val id = parts.firstOrNull()?.toLongOrNull() ?: throw IllegalArgumentException("qué archivo")
        val file = offline.find(id, parts.drop(1)) ?: return json(Response.Status.NOT_FOUND, JSONObject().put("detail", "no descargado"))
        return binary(java.io.FileInputStream(file), Offline.mimeOf(file), file.length(), cache = true)
    }

    private fun jsonArray(body: org.json.JSONArray): Response = newFixedLengthResponse(Response.Status.OK, "application/json", body.toString()).also { it.setGzipEncoding(false) }
    private fun empty(): Response = newFixedLengthResponse(Response.Status.OK, "application/json", "null").also { it.setGzipEncoding(false) }
    private fun text(body: String): Response = newFixedLengthResponse(Response.Status.OK, "application/json", JSONObject.quote(body)).also { it.setGzipEncoding(false) }

    private fun binary(stream: InputStream, mime: String, length: Long, cache: Boolean): Response {
        val response = if (length >= 0) newFixedLengthResponse(Response.Status.OK, mime, stream, length) else newChunkedResponse(Response.Status.OK, mime, stream)
        response.setGzipEncoding(false)
        if (cache) response.addHeader("Cache-Control", "private, max-age=31536000")
        return response
    }

    /** A whole file, or the one range asked for (pdf.js and epub.js ask for pieces). */
    private fun ranged(session: IHTTPSession, stream: InputStream, mime: String, size: Long): Response {
        val range = session.headers["range"]
        if (size < 0 || range == null || !range.startsWith("bytes=")) {
            return binary(stream, mime, size, cache = false).also { it.addHeader("Accept-Ranges", "bytes") }
        }
        val spec = range.removePrefix("bytes=").split('-')
        val start = spec.getOrNull(0)?.toLongOrNull() ?: 0L
        val end = spec.getOrNull(1)?.toLongOrNull()?.coerceAtMost(size - 1) ?: (size - 1)
        if (start > end || start >= size) {
            stream.close()
            return newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, "text/plain", "").also { it.addHeader("Content-Range", "bytes */$size") }
        }
        var skipped = 0L
        while (skipped < start) { val n = stream.skip(start - skipped); if (n <= 0) break; skipped += n }
        val length = end - start + 1
        val limited = object : InputStream() {
            var left = length
            override fun read(): Int = if (left <= 0) -1 else stream.read().also { if (it >= 0) left-- }
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (left <= 0) return -1
                val n = stream.read(b, off, minOf(len.toLong(), left).toInt())
                if (n > 0) left -= n
                return n
            }
            override fun close() = stream.close()
        }
        val response = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, mime, limited, length)
        response.setGzipEncoding(false)
        response.addHeader("Content-Range", "bytes $start-$end/$size")
        response.addHeader("Accept-Ranges", "bytes")
        return response
    }

    // ---- settings: the address and user; the app password only goes in, never out ----
    private fun settingsRoute(session: IHTTPSession): Response = when (session.method) {
        Method.GET -> json(Response.Status.OK, settings.describe())
        Method.PUT -> {
            val body = JSONObject(readBody(session))
            settings.url = body.optString("url", settings.url).trim()
            settings.username = body.optString("username", settings.username).trim()
            settings.name = body.optString("name", settings.name).trim()
            val token = body.optString("token", "").trim()
            if (token.isNotEmpty()) settings.saveToken(token)
            json(Response.Status.OK, settings.describe())
        }
        Method.DELETE -> { settings.forget(); json(Response.Status.OK, settings.describe()) }
        else -> json(Response.Status.METHOD_NOT_ALLOWED, JSONObject().put("detail", "no"))
    }

    // ---- the app's own preferences the page sets (Ajustes): `{ wifiOnly }` ----
    private fun prefsRoute(session: IHTTPSession): Response {
        if (session.method == Method.PUT) {
            val body = JSONObject(readBody(session))
            if (body.has("wifiOnly")) settings.wifiOnly = body.optBoolean("wifiOnly", false)
        } else if (session.method != Method.GET) {
            return json(Response.Status.METHOD_NOT_ALLOWED, JSONObject().put("detail", "no"))
        }
        return json(Response.Status.OK, JSONObject().put("wifiOnly", settings.wifiOnly))
    }

    // ---- a file served here, saved where the person wants or shared (see Files) ----
    // POST `{ action: "save" | "share", path, name, mime }`; a save answers `{ ok }` (false: they gave up)
    private fun fileRoute(session: IHTTPSession): Response {
        if (session.method != Method.POST) return json(Response.Status.METHOD_NOT_ALLOWED, JSONObject().put("detail", "solo POST"))
        val body = JSONObject(readBody(session))
        val path = body.optString("path")
        val name = body.optString("name").ifBlank { "archivo" }
        val mime = body.optString("mime")
        return when (body.optString("action")) {
            "save" -> json(Response.Status.OK, JSONObject().put("ok", files.save(path, name, mime)))
            "share" -> { files.share(path, name, mime); json(Response.Status.OK, JSONObject().put("ok", true)) }
            else -> json(Response.Status.BAD_REQUEST, JSONObject().put("detail", "¿guardar o compartir?"))
        }
    }

    // ---- the device's lock (see Lock): GET whether there is one, POST `{ reason }` asks for it and answers `{ ok }` ----
    private fun lockRoute(session: IHTTPSession): Response = when (session.method) {
        Method.GET -> json(Response.Status.OK, JSONObject().put("available", lock.available()))
        Method.POST -> {
            val reason = JSONObject(readBody(session)).optString("reason", "")
            json(Response.Status.OK, JSONObject().put("ok", lock.unlock(reason)))
        }
        else -> json(Response.Status.METHOD_NOT_ALLOWED, JSONObject().put("detail", "no"))
    }

    // ---- the service of the Archivador, with the user's credential added here ----
    private fun proxy(session: IHTTPSession): Response {
        val authorization = settings.authorization()?.takeIf { settings.url.isNotEmpty() }
            ?: return json(Response.Status.UNAUTHORIZED, JSONObject().put("detail", "No hay ningún servidor propio conectado (Bibliotecas)."))
        val query = session.queryParameterString?.takeIf { it.isNotEmpty() }?.let { "?$it" } ?: ""
        val conn = URL(settings.url + session.uri + query).openConnection() as HttpURLConnection
        conn.requestMethod = session.method.name
        conn.connectTimeout = 15_000
        conn.readTimeout = 120_000
        conn.instanceFollowRedirects = false
        conn.setRequestProperty("Authorization", authorization)
        session.headers["content-type"]?.let { conn.setRequestProperty("Content-Type", it) }
        session.headers["accept"]?.let { conn.setRequestProperty("Accept", it) }
        session.headers["range"]?.let { conn.setRequestProperty("Range", it) }
        if (session.method == Method.POST || session.method == Method.PUT || session.method == Method.PATCH) {
            val body = readBodyBytes(session)
            conn.doOutput = true
            conn.setFixedLengthStreamingMode(body.size)
            conn.outputStream.use { it.write(body) }
        }
        val code = try { conn.responseCode } catch (e: Exception) {
            return json(status(502), JSONObject().put("detail", "Sin conexión con La Estantería: ${e.message}"))
        }
        val stream: InputStream = (if (code >= 400) conn.errorStream else conn.inputStream) ?: ByteArrayInputStream(ByteArray(0))
        val type = conn.contentType ?: "application/octet-stream"
        val response = newChunkedResponse(status(code), type, stream)
        response.setGzipEncoding(false)
        for (name in listOf("Content-Disposition", "Content-Range", "Accept-Ranges", "Cache-Control", "ETag", "Last-Modified")) {
            conn.getHeaderField(name)?.let { response.addHeader(name, it) }
        }
        return response
    }

    // ---- any server, for the page (see Net): `/host/fetch?url=`, the headers to send in X-Fetch-Headers (JSON) ----
    private fun fetchRoute(session: IHTTPSession): Response {
        val target = net.target(session.parameters["url"]?.firstOrNull())
        val headers = session.headers["x-fetch-headers"]?.takeIf { it.isNotBlank() }?.let {
            try { JSONObject(it) } catch (_: Exception) { throw IllegalArgumentException("X-Fetch-Headers tiene que ser un objeto JSON.") }
        }
        val method = session.method
        val body = if (method == Method.GET || method == Method.HEAD) null else readBodyBytes(session)
        val upstream = try { net.call(target, method.name, headers, body, session.headers["content-type"]) } catch (e: java.io.IOException) {
            return json(status(502), JSONObject().put("detail", "Sin conexión con ${target.host}: ${e.message ?: e.javaClass.simpleName}"))
                .also { it.addHeader("X-Fetch-Error", "1") }
        }
        val content = upstream.body
        val stream: InputStream = content?.byteStream() ?: ByteArrayInputStream(ByteArray(0)).also { upstream.close() }
        val length = content?.contentLength() ?: 0L
        val type = upstream.header("Content-Type") ?: "application/octet-stream"
        val response = if (length >= 0) newFixedLengthResponse(status(upstream.code), type, stream, length)
            else newChunkedResponse(status(upstream.code), type, stream)
        response.setGzipEncoding(false)
        response.addHeader("X-Fetch-Url", upstream.request.url.toString())
        for (name in FORWARDED) upstream.header(name)?.let { response.addHeader(name, it) }
        return response
    }

    // ---- what happens (progress), as server-sent events (see Events) ----
    private fun eventStream(): Response {
        val response = newChunkedResponse(Response.Status.OK, "text/event-stream; charset=utf-8", events.open())
        response.setGzipEncoding(false)
        response.addHeader("Cache-Control", "no-cache")
        response.addHeader("X-Accel-Buffering", "no")
        return response
    }

    // ---- helpers ----
    fun json(status: Response.IStatus, body: JSONObject): Response {
        val response = newFixedLengthResponse(status, "application/json", body.toString())
        response.setGzipEncoding(false)
        return response
    }

    private fun readBodyBytes(session: IHTTPSession): ByteArray {
        val length = session.headers["content-length"]?.toIntOrNull() ?: 0
        val data = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = session.inputStream.read(data, read, length - read)
            if (n < 0) break
            read += n
        }
        return if (read == length) data else data.copyOf(read)
    }

    private fun readBody(session: IHTTPSession): String = String(readBodyBytes(session), Charsets.UTF_8).ifBlank { "{}" }

    private fun status(code: Int): Response.IStatus =
        Response.Status.lookup(code) ?: object : Response.IStatus {
            override fun getRequestStatus() = code
            override fun getDescription() = "$code Status"
        }

    private fun mimeOf(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html; charset=utf-8"
        "js", "mjs" -> "text/javascript; charset=utf-8"
        "css" -> "text/css; charset=utf-8"
        "json" -> "application/json"
        "svg" -> "image/svg+xml"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "webp" -> "image/webp"
        "woff" -> "font/woff"
        "woff2" -> "font/woff2"
        "ttf" -> "font/ttf"
        "wasm" -> "application/wasm"
        else -> "application/octet-stream"
    }

    companion object {
        const val PORT = 48123
        const val SOCKET_READ_TIMEOUT = 30_000   // for reading a request; a response (the event stream) may take as long as it wants
        const val version = "0.1.0"
        /** what a fetched answer brings back of the server's headers (besides type and length) */
        private val FORWARDED = listOf("Content-Disposition", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Cache-Control",
            "WWW-Authenticate", "Link", "Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Retry-After", "DAV")
        private val EXPOSED = (listOf("X-Fetch-Url", "X-Fetch-Error") + FORWARDED).joinToString(", ")
    }
}
