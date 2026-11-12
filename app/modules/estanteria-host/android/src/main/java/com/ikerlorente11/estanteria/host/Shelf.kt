package com.ikerlorente11.estanteria.host

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.util.Xml
import androidx.documentfile.provider.DocumentFile
import org.apache.commons.compress.archivers.sevenz.SevenZFile
import org.apache.commons.compress.archivers.zip.ZipFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.util.concurrent.ConcurrentHashMap

/**
 * The shelf of this device, like the desktop's local.rs: folders the user adds as libraries (chosen with
 * the system picker, kept as tree URIs) and files opened one by one («Abrir con», the file picker).
 * Nothing is copied when they are listed; the page reads them through the host:
 *
 * - `/shelf/c/<id>`: a small cover (the first page, or the one a book declares; 400 px wide, kept in
 *   `local-cache/covers/`). A TXT or a DjVu has none: the viewer shows its placeholder;
 * - `/shelf/p/<id>/<n>?w=`: a page. A cbz is read straight from the archive and a cbt by the offsets of
 *   its entries; a cbr or cb7 is unpacked once into `local-cache/<id>/x/p/`, and a PDF page is rendered at
 *   the width asked and kept there too. AVIF and JPEG XL pages are served as JPEG (`local-cache/<id>/j/`).
 *   That cache has a size limit: what was opened longest ago goes first;
 * - `/shelf/f/<id>`: the file itself (the books, which the viewer lays out itself: EPUB, MOBI/AZW3, FB2,
 *   FBZ and TXT; a DjVu, which the viewer renders itself, so it has no pages nor cover here; or a PDF for
 *   the document reader).
 *
 * An item's id is `LOCAL_BASE` + a hash of its URI, so the same file is the same item (with its progress
 * and notes) every time, and never meets an id of the service (those count from 1).
 */
class Shelf(private val context: Context, private val settings: Settings, private val events: Events, private val picker: Picker) {
    private class Root(val id: Int, val uri: String, var name: String)
    private class Known(val uri: Uri, val format: String, val name: String)

    private val roots = mutableListOf<Root>()
    private val files = mutableListOf<String>()
    private var cacheLimit = DEFAULT_CACHE
    private val known = ConcurrentHashMap<Long, Known>()
    private val zips = ConcurrentHashMap<Long, List<String>>()
    private val tars = ConcurrentHashMap<Long, List<Tar.Entry>>()

    init { load() }

    // ---- what the user chose: folders and files, kept in local-library.json ----
    private fun configFile() = File(File(context.filesDir, "estanteria").also { it.mkdirs() }, "local-library.json")

    @Synchronized
    private fun load() {
        val file = configFile()
        if (!file.isFile) return
        try {
            val json = JSONObject(file.readText())
            val r = json.optJSONArray("roots") ?: JSONArray()
            for (i in 0 until r.length()) r.getJSONObject(i).let { roots.add(Root(it.getInt("id"), it.getString("path"), it.optString("name"))) }
            val f = json.optJSONArray("files") ?: JSONArray()
            for (i in 0 until f.length()) files.add(f.getString(i))
            cacheLimit = json.optLong("cache_limit", DEFAULT_CACHE)
        } catch (_: Exception) {}
    }

    @Synchronized
    private fun save() {
        val json = JSONObject()
            .put("roots", JSONArray().also { a -> roots.forEach { a.put(JSONObject().put("id", it.id).put("path", it.uri).put("name", it.name)) } })
            .put("files", JSONArray(files))
            .put("cache_limit", cacheLimit)
        val tmp = File(configFile().parentFile, "local-library.json.part")
        tmp.writeText(json.toString())
        tmp.renameTo(configFile())
    }

    @Synchronized
    fun config(): JSONObject = JSONObject()
        .put("roots", JSONArray().also { a -> roots.forEach { a.put(rootJson(it)) } })
        .put("files", files.size)
        .put("cache_limit", cacheLimit)
        .put("cache_bytes", Offline.sizeOf(cacheDir()))

    private fun rootJson(root: Root) = JSONObject().put("id", root.id).put("path", root.uri).put("name", root.name)

    fun pickFolders(): JSONArray = JSONArray(picker.pickFolders())
    fun pickFiles(): JSONArray = JSONArray(picker.pickFiles())

    @Synchronized
    fun addRoot(uri: String): JSONObject {
        roots.firstOrNull { it.uri == uri }?.let { return rootJson(it) }
        val tree = DocumentFile.fromTreeUri(context, Uri.parse(uri)) ?: throw IllegalArgumentException("no se puede abrir esa carpeta")
        val id = (roots.maxOfOrNull { it.id } ?: 1) + 1      // 1 is the root of the files added on their own
        val root = Root(id, uri, tree.name ?: "Carpeta")
        roots.add(root)
        save()
        return rootJson(root)
    }

    @Synchronized
    fun removeRoot(id: Int) {
        roots.removeAll { it.id == id }
        save()
    }

    @Synchronized
    fun renameRoot(id: Int, name: String) {
        roots.firstOrNull { it.id == id }?.name = name
        save()
    }

    /** Adds a file on its own (it shows among «Archivos sueltos»); what it is, listed. */
    @Synchronized
    fun addFile(uri: String): JSONObject {
        val parsed = Uri.parse(uri)
        val doc = single(parsed) ?: throw IllegalArgumentException("no se encuentra el archivo")
        val name = doc.name ?: nameOf(parsed) ?: "archivo"
        val format = formatOf(name) ?: throw IllegalArgumentException(UNSUPPORTED)
        if (files.none { it == uri }) { files.add(uri); save() }
        return listed(LOOSE_ROOT, parsed, "", name, format, doc.length(), doc.lastModified() / 1000)
    }

    /** Forgets a file added on its own; one downloaded from a catalog (it lives in the app's `catalogo/`, where
     * nothing else would reach it) is deleted too. */
    @Synchronized
    fun removeFile(id: Long) {
        files.filter { idOf(it) == id }.forEach { uri ->
            catalogFile(Uri.parse(uri))?.let { f ->
                f.delete()
                // the series' folder goes with its last file
                f.parentFile?.takeIf { it != Net.folder(context).canonicalFile && it.list()?.isEmpty() == true }?.delete()
            }
        }
        files.removeAll { idOf(it) == id }
        save()
        File(cacheDir(), id.toString()).deleteRecursively()
    }

    /** A file of the shelf: a content:// URI (the system picker, «Abrir con») or a file:// one, which is only
     * taken inside the folder of the catalog downloads (see Net): the page may not reach the app's other files. */
    private fun single(uri: Uri): DocumentFile? =
        if (uri.scheme == "file") catalogFile(uri)?.let { DocumentFile.fromFile(it) }
        else DocumentFile.fromSingleUri(context, uri)

    private fun catalogFile(uri: Uri): File? {
        if (uri.scheme != "file") return null
        val file = File(uri.path ?: return null)
        val folder = Net.folder(context).canonicalFile
        // in it, or in the folder of a series inside it
        return file.canonicalFile.takeIf { it.parentFile == folder || it.parentFile?.parentFile == folder }
    }

    /** Everything on the shelf now: the files of every folder (and their subfolders) and those added alone. */
    fun scan(): JSONArray {
        val out = JSONArray()
        val seen = HashSet<Long>()
        val (currentRoots, currentFiles) = synchronized(this) { roots.toList() to files.toList() }
        for (root in currentRoots) {
            val tree = DocumentFile.fromTreeUri(context, Uri.parse(root.uri)) ?: continue
            walk(root.id, tree, "", 0, out, seen)
        }
        for (uri in currentFiles) {
            val parsed = Uri.parse(uri)
            if (seen.contains(idOf(uri))) continue
            val doc = single(parsed) ?: continue
            if (!doc.exists()) continue
            val name = doc.name ?: continue
            val format = formatOf(name) ?: continue
            out.put(listed(LOOSE_ROOT, parsed, "", name, format, doc.length(), doc.lastModified() / 1000))
            seen.add(idOf(uri))
        }
        return out
    }

    private fun walk(rootId: Int, dir: DocumentFile, folder: String, depth: Int, out: JSONArray, seen: HashSet<Long>) {
        if (depth > 24) return
        val entries = try { dir.listFiles() } catch (_: Exception) { return }
        for (entry in entries) {
            val name = entry.name ?: continue
            if (name.startsWith(".")) continue
            if (entry.isDirectory) walk(rootId, entry, if (folder.isEmpty()) name else "$folder/$name", depth + 1, out, seen)
            else formatOf(name)?.let { format ->
                out.put(listed(rootId, entry.uri, folder, name, format, entry.length(), entry.lastModified() / 1000))
                seen.add(idOf(entry.uri.toString()))
            }
        }
    }

    private fun listed(root: Int, uri: Uri, folder: String, name: String, format: String, size: Long, modified: Long): JSONObject {
        val id = idOf(uri.toString())
        known[id] = Known(uri, format, name)
        return JSONObject().put("id", id).put("root", root).put("path", uri.toString()).put("folder", folder).put("name", name)
            .put("format", format).put("size", size).put("modified", modified)
    }

    // ---- the cache of unpacked pages and rendered PDF pages ----
    private fun cacheDir() = File(context.cacheDir, "local-cache").also { it.mkdirs() }
    private fun itemCache(id: Long) = File(cacheDir(), id.toString()).also { it.mkdirs(); it.setLastModified(System.currentTimeMillis()) }

    @Synchronized
    fun setCacheLimit(bytes: Long) { cacheLimit = bytes.coerceAtLeast(64L shl 20); save(); prune() }

    fun clearCache() {
        cacheDir().listFiles()?.filter { it.isDirectory && it.name != "covers" }?.forEach { it.deleteRecursively() }
        zips.clear()
        tars.clear()
    }

    /** Drops what was opened longest ago until the cache fits its limit (what is being read stays). */
    private fun prune(keep: Long? = null) {
        val dirs = cacheDir().listFiles()?.filter { it.isDirectory && it.name != "covers" }?.sortedBy { it.lastModified() } ?: return
        var total = dirs.sumOf { Offline.sizeOf(it) }
        for (dir in dirs) {
            if (total <= cacheLimit) break
            if (dir.name == keep?.toString()) continue
            total -= Offline.sizeOf(dir)
            dir.deleteRecursively()
        }
    }

    // ---- opening the files ----
    private fun item(id: Long): Known = known[id] ?: throw IllegalArgumentException("ese archivo no está en la estantería")

    private fun descriptor(uri: Uri): ParcelFileDescriptor =
        context.contentResolver.openFileDescriptor(uri, "r") ?: throw IllegalStateException("no se puede abrir el archivo")

    private fun open(uri: Uri): InputStream = context.contentResolver.openInputStream(uri) ?: throw IllegalStateException("no se puede abrir el archivo")

    /** What a comic archive really is (cbz, cbr, cb7 or cbt), by its first bytes: many a .cbr is a zip inside. */
    private fun containerOf(uri: Uri, format: String): String {
        if (format !in listOf("cbz", "cbr", "cb7", "cbt")) return format
        val head = try { open(uri).use { s -> readUpTo(s, 512) } } catch (_: Exception) { return format }
        return when {
            head.size >= 6 && head.copyOf(6).contentEquals(byteArrayOf(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07)) -> "cbr"
            head.size >= 4 && head.copyOf(4).contentEquals(byteArrayOf(0x50, 0x4b, 0x03, 0x04)) -> "cbz"
            head.size >= 6 && head.copyOf(6).contentEquals(byteArrayOf(0x37, 0x7a, 0xbc.toByte(), 0xaf.toByte(), 0x27, 0x1c)) -> "cb7"
            Tar.isTar(head) -> "cbt"
            else -> format
        }
    }

    /** What the viewer needs before reading: how many pages and their sizes (a cbr or cb7 gets unpacked now). */
    fun prepare(id: Long): JSONObject {
        val k = item(id)
        val dir = itemCache(id)
        val format = containerOf(k.uri, k.format)
        val kept = File(dir, "prepared.json")
        if (kept.isFile) {
            try {
                val json = JSONObject(kept.readText())
                if (format == "cbz") zips.getOrPut(id) { zipPages(k.uri) }
                if (format == "cbt") tars.getOrPut(id) { tarPages(k.uri) }
                return json
            } catch (_: Exception) {}
        }
        val sizes = JSONArray()
        val pages: Int
        when (format) {
            "cbz" -> {
                val names = zipPages(k.uri)
                if (names.isEmpty()) throw IllegalStateException("no tiene imágenes")
                zips[id] = names
                withZip(k.uri) { zip -> names.forEach { n -> sizes.put(boundsOf(zip.getInputStream(zip.getEntry(n)), n)) } }
                pages = names.size
            }
            "cbt" -> {
                val entries = tarPages(k.uri)
                if (entries.isEmpty()) throw IllegalStateException("no tiene imágenes")
                tars[id] = entries
                withChannel(k.uri) { ch -> entries.forEach { e -> sizes.put(boundsOf(Tar.read(ch, e).inputStream(), e.name)) } }
                pages = entries.size
            }
            "cbr", "cb7" -> {
                pages = unpack(k.uri, format, File(dir, "x"))
                val pagesDir = File(dir, "x/p")
                for (n in 0 until pages) sizes.put(Offline.stem(pagesDir, n.toString())?.let { f -> boundsOf(FileInputStream(f), f.name) } ?: JSONArray().put(0).put(0))
                prune(keep = id)
            }
            "pdf" -> {
                descriptor(k.uri).use { pfd ->
                    PdfRenderer(pfd).use { pdf ->
                        pages = pdf.pageCount
                        for (n in 0 until pages) pdf.openPage(n).use { p -> sizes.put(JSONArray().put(p.width * 2).put(p.height * 2)) }
                    }
                }
            }
            "djvu" -> throw IllegalArgumentException("Un DjVu lo dibuja el visor con el archivo entero: el host no saca sus páginas.")
            else -> pages = 0
        }
        var complete = true
        for (i in 0 until sizes.length()) { val s = sizes.getJSONArray(i); if (s.getInt(0) == 0 || s.getInt(1) == 0) complete = false }
        val json = JSONObject().put("pages", pages).put("page_sizes", if (complete) sizes else JSONArray())
        kept.writeText(json.toString())
        return json
    }

    /** A page: (bytes or file, mime). */
    fun page(id: Long, n: Int, width: Int?): Pair<InputStream, String> {
        val k = item(id)
        when (val format = containerOf(k.uri, k.format)) {
            "cbz" -> {
                val names = zips[id] ?: run { prepare(id); zips[id] ?: emptyList() }
                val name = names.getOrNull(n) ?: throw IllegalArgumentException("esa página no existe")
                return viewable(id, n, name) { zipRead(k.uri, name) }
            }
            "cbt" -> {
                val entries = tars[id] ?: run { prepare(id); tars[id] ?: emptyList() }
                val entry = entries.getOrNull(n) ?: throw IllegalArgumentException("esa página no existe")
                return viewable(id, n, entry.name) { withChannel(k.uri) { ch -> Tar.read(ch, entry) }.inputStream() }
            }
            "cbr", "cb7" -> {
                val pagesDir = File(itemCache(id), "x/p")
                val file = Offline.stem(pagesDir, n.toString()) ?: run { prepare(id); Offline.stem(pagesDir, n.toString()) }
                    ?: throw IllegalArgumentException("esa página no existe")
                return viewable(id, n, file.name) { FileInputStream(file) }
            }
            "pdf" -> {
                val w = (width ?: 1600).coerceIn(300, 3200)
                val dir = itemCache(id)
                val file = File(dir, "r$n-$w.jpg")
                if (!file.isFile) {
                    val rendered = renderPdf(k.uri, n, w)
                    val part = File(dir, "r$n-$w.part")
                    part.writeBytes(rendered)
                    part.renameTo(file)
                    prune(keep = id)
                }
                return FileInputStream(file) to "image/jpeg"
            }
            else -> throw IllegalArgumentException("$format no tiene páginas")
        }
    }

    /** A small cover: the first page, 400 px wide, kept. */
    fun cover(id: Long): Pair<InputStream, String> {
        val covers = File(cacheDir(), "covers").also { it.mkdirs() }
        val file = File(covers, "$id.jpg")
        if (file.isFile) return FileInputStream(file) to "image/jpeg"
        val avif = File(covers, "$id.avif")
        if (avif.isFile) return FileInputStream(avif) to "image/avif"
        val k = item(id)
        val raw: ByteArray = when (val format = containerOf(k.uri, k.format)) {
            "cbz" -> {
                val names = zipPages(k.uri)
                zipRead(k.uri, names.firstOrNull() ?: throw IllegalStateException("no tiene imágenes")).use { s -> s.readBytes() }
            }
            "cbt" -> {
                val first = tarPages(k.uri).firstOrNull() ?: throw IllegalStateException("no tiene imágenes")
                withChannel(k.uri) { ch -> Tar.read(ch, first) }
            }
            "cbr", "cb7" -> firstImage(k.uri, format)
            "pdf" -> renderPdf(k.uri, 0, COVER_WIDTH)
            "epub" -> epubCover(k.uri) ?: throw IllegalStateException("sin portada")
            "mobi" -> mobiCover(k.uri) ?: throw IllegalStateException("sin portada")
            "fb2" -> fb2Cover(k.uri) ?: throw IllegalStateException("sin portada")
            "fbz" -> fbzCover(k.uri) ?: throw IllegalStateException("sin portada")
            else -> throw IllegalStateException("sin portada")            // a TXT or a DjVu: the viewer keeps its placeholder
        }
        val small = try { small(raw) } catch (e: Exception) {
            // an AVIF this Android cannot decode (before Android 14 that is up to the maker): the web view shows it as it is
            if (!Images.isAvif(raw)) throw e
            avif.writeBytes(raw)
            return raw.inputStream() to "image/avif"
        }
        file.writeBytes(small)
        return small.inputStream() to "image/jpeg"
    }

    /** The file itself, to hand to another app: a catalog download (a File of the app's) or the document's Uri. */
    fun original(id: Long): Any? {
        val k = known[id] ?: return null
        return if (k.uri.scheme == "file") catalogFile(k.uri) else k.uri
    }

    /** The file itself and its size (for the readers that want the whole thing: the books, PDF as a document). */
    fun file(id: Long): Triple<InputStream, String, Long> {
        val k = item(id)
        val size = single(k.uri)?.length() ?: -1L
        return Triple(open(k.uri), mimeOfFormat(k.format), size)
    }

    // ---- zip (cbz): read straight from the archive ----
    private fun <T> withZip(uri: Uri, block: (ZipFile) -> T): T = descriptor(uri).use { pfd ->
        FileInputStream(pfd.fileDescriptor).use { stream ->
            ZipFile.builder().setSeekableByteChannel(stream.channel).get().use(block)
        }
    }

    private fun zipPages(uri: Uri): List<String> = withZip(uri) { zip ->
        zip.entries.toList().filter { !it.isDirectory && isPage(it.name) }.map { it.name }.sortedWith(NATURAL)
    }

    private fun zipRead(uri: Uri, name: String): InputStream {
        val out = ByteArrayOutputStream()
        withZip(uri) { zip -> zip.getInputStream(zip.getEntry(name) ?: throw IllegalArgumentException("esa página no existe")).use { it.copyTo(out) } }
        return out.toByteArray().inputStream()
    }

    // ---- tar (cbt): its entries indexed once, each page read at its offset ----
    private fun <T> withChannel(uri: Uri, block: (FileChannel) -> T): T = descriptor(uri).use { pfd ->
        FileInputStream(pfd.fileDescriptor).use { stream -> block(stream.channel) }
    }

    private fun tarPages(uri: Uri): List<Tar.Entry> = withChannel(uri) { ch -> Tar.index(ch, ::isPage, NATURAL) }

    /** A page as it is, or as JPEG if the web view cannot show it (AVIF, JPEG XL): made once, kept in the cache. */
    private fun viewable(id: Long, n: Int, name: String, raw: () -> InputStream): Pair<InputStream, String> {
        if (!Images.needsJpeg(name)) return raw() to mimeOf(name)
        val dir = File(itemCache(id), "j").also { it.mkdirs() }
        val file = File(dir, "$n.jpg")
        if (!file.isFile) {
            val jpeg = Images.toJpeg(raw().use { it.readBytes() })
            val part = File(dir, "$n.part")
            part.writeBytes(jpeg)
            part.renameTo(file)
            prune(keep = id)
        }
        return FileInputStream(file) to "image/jpeg"
    }

    // ---- rar and 7z: unpacked once ----
    /** Unpacks the images of a cbr or cb7 into `dir/p/<n>.<ext>` (in the order of their names). */
    private fun unpack(uri: Uri, format: String, dir: File): Int {
        dir.deleteRecursively()
        val pages = File(dir, "p").also { it.mkdirs() }
        val names = mutableListOf<Pair<String, File>>()
        fun keep(name: String, stream: InputStream) {
            if (!isPage(name)) return
            val tmp = File(pages, "x${names.size}.part")
            FileOutputStream(tmp).use { stream.copyTo(it) }
            names.add(name to tmp)
        }
        val source = File(dir, "src.$format")
        try {
            open(uri).use { s -> FileOutputStream(source).use { s.copyTo(it) } }
            if (format == "cb7") {
                SevenZFile.builder().setFile(source).get().use { sz ->
                    while (true) {
                        val entry = sz.nextEntry ?: break
                        if (entry.isDirectory) continue
                        keep(entry.name, sz.getInputStream(entry))
                    }
                }
            } else {
                Rar.forEach(source, ::isPage, ::keep)
            }
        } finally { source.delete() }
        if (names.isEmpty()) throw IllegalStateException("no tiene imágenes")
        names.sortWith { a, b -> NATURAL.compare(a.first, b.first) }
        names.forEachIndexed { n, (name, tmp) -> tmp.renameTo(File(pages, "$n.${name.substringAfterLast('.').lowercase()}")) }
        return names.size
    }

    /** The first page of a rar or 7z, by name. */
    private fun firstImage(uri: Uri, format: String): ByteArray {
        val tmp = File(cacheDir(), "first-${System.nanoTime()}.$format")
        try {
            open(uri).use { s -> FileOutputStream(tmp).use { s.copyTo(it) } }
            if (format == "cb7") {
                SevenZFile.builder().setFile(tmp).get().use { sz ->
                    val wanted = sz.entries.filter { !it.isDirectory && isPage(it.name) }.map { it.name }.sortedWith(NATURAL).firstOrNull()
                        ?: throw IllegalStateException("no tiene imágenes")
                    while (true) {
                        val entry = sz.nextEntry ?: break
                        if (entry.name == wanted) return sz.getInputStream(entry).use { it.readBytes() }
                    }
                }
            } else {
                val first = Rar.names(tmp, ::isPage).sortedWith(NATURAL).firstOrNull() ?: throw IllegalStateException("no tiene imágenes")
                return Rar.read(tmp, first) ?: throw IllegalStateException("no tiene imágenes")
            }
        } finally { tmp.delete() }
        throw IllegalStateException("no tiene imágenes")
    }

    // ---- PDF: rendered by Android ----
    private fun renderPdf(uri: Uri, n: Int, width: Int): ByteArray = descriptor(uri).use { pfd ->
        PdfRenderer(pfd).use { pdf ->
            if (n < 0 || n >= pdf.pageCount) throw IllegalArgumentException("esa página no existe")
            pdf.openPage(n).use { page ->
                val height = (width.toLong() * page.height / page.width).toInt().coerceAtLeast(1)
                val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                Canvas(bitmap).drawColor(Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                val out = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, 88, out)
                bitmap.recycle()
                out.toByteArray()
            }
        }
    }

    // ---- EPUB: the cover the book declares ----
    private fun epubCover(uri: Uri): ByteArray? = try {
        withZip(uri) { zip ->
            val container = zip.getInputStream(zip.getEntry("META-INF/container.xml")).use { String(it.readBytes()) }
            val opfName = Regex("full-path=\"([^\"]+)\"").find(container)?.groupValues?.get(1) ?: return@withZip null
            val opf = zip.getInputStream(zip.getEntry(opfName)).use { String(it.readBytes()) }
            val items = Regex("<item\\b[^>]*>").findAll(opf).map { it.value }.toList()
            fun attr(tag: String, name: String) = Regex("\\b$name=\"([^\"]*)\"").find(tag)?.groupValues?.get(1)
            var href = items.firstOrNull { (attr(it, "properties") ?: "").split(" ").contains("cover-image") }?.let { attr(it, "href") }
            if (href == null) {
                val coverId = Regex("<meta\\b[^>]*name=\"cover\"[^>]*content=\"([^\"]+)\"").find(opf)?.groupValues?.get(1)
                    ?: Regex("<meta\\b[^>]*content=\"([^\"]+)\"[^>]*name=\"cover\"").find(opf)?.groupValues?.get(1)
                if (coverId != null) href = items.firstOrNull { attr(it, "id") == coverId }?.let { attr(it, "href") }
            }
            if (href == null) href = items.firstOrNull { (attr(it, "id") ?: "").lowercase().contains("cover") && (attr(it, "media-type") ?: "").startsWith("image/") }?.let { attr(it, "href") }
            if (href == null) return@withZip null
            val base = opfName.substringBeforeLast('/', "")
            val path = if (base.isEmpty()) href else "$base/$href"
            zip.getEntry(path)?.let { e -> zip.getInputStream(e).use { it.readBytes() } }
        }
    } catch (_: Exception) { null }

    // ---- MOBI / AZW3, FB2, FBZ: see Books ----
    private fun mobiCover(uri: Uri): ByteArray? = try {
        withChannel(uri) { ch ->
            Books.mobiCover(ch.size()) { offset, length ->
                val buf = ByteBuffer.allocate(length)
                ch.position(offset)
                while (buf.hasRemaining()) if (ch.read(buf) < 0) break
                buf.array().copyOf(buf.position())
            }
        }
    } catch (_: Exception) { null }

    private fun fb2Cover(uri: Uri): ByteArray? = try {
        open(uri).use { Books.fb2Cover(it.buffered(), Xml.newPullParser()) }
    } catch (_: Exception) { null }

    /** An FBZ (or .fb2.zip) is a zip with the FB2 inside: its first .fb2. */
    private fun fbzCover(uri: Uri): ByteArray? = try {
        withZip(uri) { zip ->
            val entry = zip.entries.toList().filter { !it.isDirectory && it.name.lowercase().endsWith(".fb2") }
                .minWithOrNull { a, b -> NATURAL.compare(a.name, b.name) } ?: return@withZip null
            zip.getInputStream(entry).use { Books.fb2Cover(it.buffered(), Xml.newPullParser()) }
        }
    } catch (_: Exception) { null }

    // ---- uploading to the Archivador, a piece at a time (requests through Cloudflare carry at most 100 MB) ----
    /** The uploads asked to stop (by the file's id), until they see it. */
    private val stopUploads = ConcurrentHashMap.newKeySet<Long>()
    private class UploadCancelled : RuntimeException("cancelada")

    /** Stops the upload of that file going on: the piece going is cut and the service forgets what it got. */
    fun cancelUpload(id: Long) { stopUploads.add(id) }

    fun upload(id: Long, dest: String): JSONObject {
        stopUploads.remove(id)                // a stop asked of an earlier upload of it is not this one's
        try {
            return uploadFile(id, dest)
        } catch (e: UploadCancelled) {
            throw IllegalStateException("cancelada")
        } finally {
            stopUploads.remove(id)
        }
    }

    private fun uploadFile(id: Long, dest: String): JSONObject {
        val k = item(id)
        val authorization = settings.authorization() ?: throw IllegalStateException("Conecta con tu Archivador primero.")
        val base = settings.url
        val total = single(k.uri)?.length() ?: throw IllegalStateException("no se encuentra el archivo")
        // how it goes, told as the bytes leave (not only per piece of 32 MB: a small file would jump from 0 to 100)
        var told = 0L
        fun tell(at: Long, force: Boolean = false) {
            val now = System.currentTimeMillis()
            if (!force && now - told < 250) return
            told = now
            events.send("upload", JSONObject().put("id", id).put("sent", at).put("total", total))
        }
        fun call(method: String, url: String, type: String?, body: ByteArray?, written: ((Long) -> Unit)? = null): JSONObject {
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 900_000
            conn.setRequestProperty("Authorization", authorization)
            type?.let { t -> conn.setRequestProperty("Content-Type", t) }
            if (body != null) {
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(body.size)
                conn.outputStream.use { o ->
                    var off = 0
                    while (off < body.size) {
                        val n = minOf(1 shl 16, body.size - off)
                        o.write(body, off, n)
                        off += n
                        written?.invoke(off.toLong())
                    }
                }
            }
            val code = conn.responseCode
            val text = (if (code >= 400) conn.errorStream else conn.inputStream)?.use { s -> String(s.readBytes()) } ?: ""
            conn.disconnect()
            if (code >= 400) {
                val detail = try { JSONObject(text).optString("detail", "") } catch (_: Exception) { "" }
                throw IllegalStateException(detail.ifEmpty { "HTTP $code" }, if (code == 409 || code == 413) IllegalArgumentException("$code") else null)
            }
            return try { JSONObject(text) } catch (_: Exception) { JSONObject() }
        }
        val started = call("POST", "$base/api/uploads", "application/json", JSONObject().put("path", dest).put("size", total).toString().toByteArray())
        val upload = started.optString("id", "").ifEmpty { throw IllegalStateException("el servicio no empezó la subida") }
        val chunk = started.optInt("chunk", UPLOAD_CHUNK).coerceAtMost(UPLOAD_CHUNK)
        var sent = 0L
        fun stopped() {
            if (id !in stopUploads) return
            try { call("DELETE", "$base/api/uploads/$upload", null, null) } catch (_: Exception) {}
            throw UploadCancelled()
        }
        open(k.uri).use { stream ->
            val buf = ByteArray(chunk)
            while (sent < total) {
                stopped()
                var filled = 0
                while (filled < chunk) {
                    val got = stream.read(buf, filled, chunk - filled)
                    if (got <= 0) break
                    filled += got
                }
                if (filled == 0) break
                var attempt = 0
                while (true) {
                    attempt++
                    try {
                        val from = sent
                        call("PUT", "$base/api/uploads/$upload?offset=$sent", "application/octet-stream", buf.copyOf(filled)) { w -> stopped(); tell(from + w) }
                        break
                    } catch (e: IllegalStateException) {
                        if (e.cause is IllegalArgumentException && attempt > 1) break      // 409/413: the piece is there already
                        if (attempt >= 4) {
                            try { call("DELETE", "$base/api/uploads/$upload", null, null) } catch (_: Exception) {}
                            throw e
                        }
                        Thread.sleep(2000L * attempt)
                    }
                }
                sent += filled
                tell(sent, force = true)
            }
        }
        return call("POST", "$base/api/uploads/$upload/finish", null, null)
    }

    // ---- helpers ----
    private fun nameOf(uri: Uri): String? = try {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    } catch (_: Exception) { null } ?: uri.lastPathSegment?.substringAfterLast('/')

    /** A page's width and height (a JPEG XL's from its header, through the decoder). */
    private fun boundsOf(stream: InputStream, name: String): JSONArray = stream.use {
        if (name.substringAfterLast('.', "").lowercase() == "jxl") {
            val (w, h) = Images.size(it.readBytes())
            return@use JSONArray().put(w).put(h)
        }
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeStream(it, null, opts)
        JSONArray().put(opts.outWidth.coerceAtLeast(0)).put(opts.outHeight.coerceAtLeast(0))
    }

    /** The image no wider than COVER_WIDTH, as JPEG. */
    private fun small(raw: ByteArray): ByteArray = Images.toJpeg(raw, COVER_WIDTH, 82)

    private fun readUpTo(stream: InputStream, n: Int): ByteArray {
        val buf = ByteArray(n)
        var filled = 0
        while (filled < n) { val got = stream.read(buf, filled, n - filled); if (got <= 0) break; filled += got }
        return buf.copyOf(filled)
    }

    companion object {
        /** 2^50: from here on, items are files of this device (the viewer knows it too, see local.ts). */
        const val LOCAL_BASE = 1L shl 50
        const val LOOSE_ROOT = 1
        const val COVER_WIDTH = 400
        const val DEFAULT_CACHE = 1L shl 30
        const val UPLOAD_CHUNK = 32 shl 20
        private val IMAGES = setOf("jpg", "jpeg", "png", "webp", "gif", "avif", "jxl", "bmp")
        const val UNSUPPORTED = "La Estantería abre cómics (cbz, cbr, cb7, cbt), PDF, DjVu y libros (epub, mobi, azw3, fb2, fbz, txt)"

        fun idOf(uri: String): Long {
            var h = 0xcbf29ce484222325uL
            for (b in uri.lowercase().toByteArray(Charsets.UTF_8)) { h = h xor b.toUByte().toULong(); h *= 0x100000001b3uL }
            return LOCAL_BASE + (h and ((1uL shl 40) - 1uL)).toLong()
        }

        /** The format of a file by its name (the ids the viewer knows, see local.ts); null if it is not read here. */
        fun formatOf(name: String): String? {
            if (name.lowercase().endsWith(".fb2.zip")) return "fbz"          // before .zip, a comic
            return when (name.substringAfterLast('.', "").lowercase()) {
                "cbz", "zip" -> "cbz"
                "cbr", "rar" -> "cbr"
                "cb7", "7z" -> "cb7"
                "cbt", "tar" -> "cbt"
                "pdf" -> "pdf"
                "epub" -> "epub"
                "mobi", "azw", "azw3", "prc" -> "mobi"
                "fb2" -> "fb2"
                "fbz" -> "fbz"
                "txt" -> "txt"
                "djvu", "djv" -> "djvu"
                else -> null
            }
        }

        /** What a file is said to be when served whole (foliate-js tells FB2 and FBZ apart by it). */
        fun mimeOfFormat(format: String) = when (format) {
            "cbz" -> "application/vnd.comicbook+zip"
            "cbr" -> "application/vnd.comicbook-rar"
            "cb7" -> "application/x-7z-compressed"
            "cbt" -> "application/x-cbt"
            "pdf" -> "application/pdf"
            "epub" -> "application/epub+zip"
            "mobi" -> "application/x-mobipocket-ebook"
            "fb2" -> "application/x-fictionbook+xml"
            "fbz" -> "application/x-zip-compressed-fb2"
            "txt" -> "text/plain"
            "djvu" -> "image/vnd.djvu"
            else -> "application/octet-stream"
        }

        fun mimeOf(name: String) = when (name.substringAfterLast('.', "").lowercase()) {
            "jpg", "jpeg" -> "image/jpeg"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "avif" -> "image/avif"
            "jxl" -> "image/jxl"
            "bmp" -> "image/bmp"
            else -> "application/octet-stream"
        }

        /** An image entry of an archive that is a page: not a hidden file nor macOS' resource forks. */
        fun isPage(name: String): Boolean {
            val parts = name.replace('\\', '/').split('/')
            if (parts.any { it.startsWith(".") || it == "__MACOSX" }) return false
            return name.substringAfterLast('.', "").lowercase() in IMAGES
        }

        /** Natural order: digits by value, the rest ignoring case (p2 before p10). */
        val NATURAL = Comparator<String> { a, b ->
            val ra = Regex("\\d+|\\D+").findAll(a).map { it.value }.toList()
            val rb = Regex("\\d+|\\D+").findAll(b).map { it.value }.toList()
            var i = 0
            while (i < ra.size && i < rb.size) {
                val x = ra[i]; val y = rb[i]
                val c = if (x[0].isDigit() && y[0].isDigit()) x.trimStart('0').length.compareTo(y.trimStart('0').length).takeIf { it != 0 } ?: x.trimStart('0').compareTo(y.trimStart('0'))
                        else x.lowercase().compareTo(y.lowercase())
                if (c != 0) return@Comparator c
                i++
            }
            ra.size.compareTo(rb.size)
        }
    }
}
