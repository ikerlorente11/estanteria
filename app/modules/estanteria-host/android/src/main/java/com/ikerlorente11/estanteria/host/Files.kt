package com.ikerlorente11.estanteria.host

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * What can be done with a file this host serves (one of this device, a copy kept for reading offline,
 * something downloaded from a catalog), from the menu of its «Descargado» button:
 * - `save`: the system's «save as» (where and with what name the person wants), and the bytes copied there.
 * - `share`: the system's share sheet (send it by mail, a chat, to another app…), from a copy in the cache.
 *
 * The file is named by the path the page reads it at (`/shelf/f/<id>`, `/offline/<…>`, or the server's
 * `/api/items/<id>/file`), and read back from this same server, so whatever it can serve can be saved or shared.
 */
class Files(
    private val context: Context,
    private val picker: Picker,
    private val activity: () -> Activity?,
    private val port: () -> Int,
    private val token: () -> String,
    /** the file itself when it is on this device: a File of the app's (a catalog download) or a content:// Uri */
    private val original: (path: String) -> Any?,
    /** the folder of an item kept to read offline as its pages (a comic, a PDF), if it is */
    private val keptPages: (id: Long) -> File?,
) {
    /** Asks where, and copies it there; false if the person gave up. A comic kept to read offline is its
     * pages: they go as a CBZ, made here (no need of the server, nor of a connection). */
    fun save(path: String, name: String, mime: String): Boolean {
        val pages = keptPagesOf(path)
        val target = picker.createDocument(if (pages != null) cbzName(name) else name, if (pages != null) CBZ else mime) ?: return false
        try {
            (context.contentResolver.openOutputStream(Uri.parse(target), "w") ?: throw IllegalStateException("no se pudo escribir ahí")).use { out ->
                when {
                    pages != null -> pack(pages, out)
                    else -> when (val own = original(path)) {
                        is File -> own.inputStream().use { it.copyTo(out, 1 shl 16) }
                        is Uri -> (context.contentResolver.openInputStream(own) ?: throw IllegalStateException("no se puede leer")).use { it.copyTo(out, 1 shl 16) }
                        else -> open(path).use { it.copyTo(out, 1 shl 16) }
                    }
                }
            }
        } catch (e: Exception) {
            // nothing half-written left behind
            try { android.provider.DocumentsContract.deleteDocument(context.contentResolver, Uri.parse(target)) } catch (_: Exception) {}
            throw e
        }
        return true
    }

    /** Opens the share sheet with the file: itself when it is on this device (no copy, at once), else a
     * copy in the cache (the original from the server, a kept copy), which the next share replaces. */
    fun share(path: String, given: String, givenMime: String) {
        val pages = keptPagesOf(path)
        val name = if (pages != null) cbzName(given) else given
        val mime = if (pages != null) CBZ else givenMime
        val uri = when (val own = if (pages != null) null else original(path)) {
            is File -> FileProvider.getUriForFile(context, AUTHORITY(context), own)
            is Uri -> own                            // a document of the person's folders: its read grant goes along
            else -> {
                val dir = File(context.cacheDir, "compartir")
                dir.deleteRecursively()
                dir.mkdirs()
                val file = File(dir, safeName(name))
                file.outputStream().buffered().use { out -> if (pages != null) pack(pages, out) else open(path).use { it.copyTo(out, 1 shl 16) } }
                FileProvider.getUriForFile(context, AUTHORITY(context), file)
            }
        }
        val send = Intent(Intent.ACTION_SEND).apply {
            type = mime.ifBlank { "application/octet-stream" }
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TITLE, name)
            // the share sheet's preview shows this name (not the document's inner id)
            clipData = android.content.ClipData.newRawUri(name, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val current = activity() ?: throw IllegalStateException("la app no está delante")
        current.runOnUiThread { current.startActivity(Intent.createChooser(send, name).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
    }

    /** The file, read back from this server (only its own paths: never somewhere else). */
    private fun open(path: String): InputStream {
        // a file of this device, a kept copy, or the original from the connected server (this host adds its credential)
        val clean = path.substringBefore('?')
        require(clean.startsWith("/shelf/") || clean.startsWith("/offline/") || Regex("""^/api/items/\d+/file$""").matches(clean)) { "eso no es un archivo que se pueda guardar" }
        val conn = URL("http://127.0.0.1:${port()}$clean?t=${token()}").openConnection() as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 120_000
        if (conn.responseCode !in 200..299) {
            val detail = try { conn.errorStream?.bufferedReader()?.readText() } catch (_: Exception) { null }
            conn.disconnect()
            throw IllegalStateException("no se pudo leer el archivo (${conn.responseCode}${detail?.let { ": $it" } ?: ""})")
        }
        return conn.inputStream
    }

    /** The pages kept of the server's item at `/api/items/<id>/file`, when it is kept so. */
    private fun keptPagesOf(path: String): File? =
        Regex("""^/api/items/(\d+)/file""").find(path.substringBefore('?'))?.let { keptPages(it.groupValues[1].toLong()) }

    /** The pages, in order, as a CBZ (stored: they are JPEG already, squeezing them gains nothing). */
    private fun pack(dir: File, out: java.io.OutputStream) {
        val pages = File(dir, "p").listFiles()?.filter { it.isFile && !it.name.endsWith(".part") }
            ?.sortedBy { it.nameWithoutExtension.toIntOrNull() ?: Int.MAX_VALUE } ?: emptyList()
        if (pages.isEmpty()) throw IllegalStateException("la copia no tiene páginas")
        val zip = java.util.zip.ZipOutputStream(out)
        zip.setLevel(java.util.zip.Deflater.NO_COMPRESSION)
        pages.forEachIndexed { i, f ->
            zip.putNextEntry(java.util.zip.ZipEntry("%04d.%s".format(i + 1, f.extension.ifBlank { "jpg" })))
            f.inputStream().use { it.copyTo(zip, 1 shl 16) }
            zip.closeEntry()
        }
        zip.finish()
    }

    private fun cbzName(name: String) = name.substringBeforeLast('.', name) + ".cbz"

    companion object {
        const val CBZ = "application/vnd.comicbook+zip"
        fun AUTHORITY(context: Context) = "${context.packageName}.estanteria.compartir"
    }

    private fun safeName(name: String): String = name.replace(Regex("[/\\\\:*?\"<>|]+"), "_").ifBlank { "archivo" }
}
