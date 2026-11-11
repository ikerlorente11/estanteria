package com.ikerlorente11.estanteria.host

import com.github.junrar.Archive
import me.zhanghai.android.libarchive.ArchiveEntry
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.nio.ByteBuffer
import me.zhanghai.android.libarchive.Archive as LibArchive

/** A cbr's entries, one after another. junrar reads RAR 4 (and older) but not RAR 5 (WinRAR's default
 * since 5.0): those, and whatever junrar cannot open, go through libarchive (RAR 4 and 5). */
object Rar {
    private val RAR5 = byteArrayOf(0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00)

    fun isRar5(file: File): Boolean = file.inputStream().use { s ->
        val head = ByteArray(RAR5.size)
        var read = 0
        while (read < head.size) { val n = s.read(head, read, head.size - read); if (n < 0) break; read += n }
        read == head.size && head.contentEquals(RAR5)
    }

    /** Calls [block] with each file of the archive that [wanted] keeps, in the archive's order (the stream is
     * only good during the call). If junrar fails halfway, libarchive goes on from where it was. */
    fun forEach(file: File, wanted: (String) -> Boolean, block: (String, InputStream) -> Unit) {
        if (isRar5(file)) return libarchive(file, wanted, block)
        val told = HashSet<String>()
        try {
            junrar(file, wanted) { name, stream -> block(name, stream); told.add(name) }
        } catch (e: Exception) {
            try { libarchive(file, { it !in told && wanted(it) }, block) } catch (again: Exception) { again.addSuppressed(e); throw again }
        }
    }

    /** The names of the files that [wanted] keeps, without unpacking them. */
    fun names(file: File, wanted: (String) -> Boolean): List<String> {
        val names = mutableListOf<String>()
        forEach(file, { if (wanted(it)) names.add(it); false }) { _, _ -> }
        return names
    }

    /** One file, by name. */
    fun read(file: File, name: String): ByteArray? {
        var found: ByteArray? = null
        forEach(file, { found == null && it == name }) { _, stream -> found = stream.readBytes() }
        return found
    }

    private fun junrar(file: File, wanted: (String) -> Boolean, block: (String, InputStream) -> Unit) {
        Archive(file).use { rar ->
            while (true) {
                val header = rar.nextFileHeader() ?: break
                val name = header.fileName.replace('\\', '/')
                if (header.isDirectory || !wanted(name)) continue
                val out = ByteArrayOutputStream()
                rar.extractFile(header, out)
                block(name, out.toByteArray().inputStream())
            }
        }
    }

    private fun libarchive(file: File, wanted: (String) -> Boolean, block: (String, InputStream) -> Unit) {
        val archive = LibArchive.readNew()
        try {
            LibArchive.readSupportFormatRar(archive)
            LibArchive.readSupportFormatRar5(archive)
            LibArchive.readOpenFileName(archive, file.absolutePath.toByteArray(), 64 * 1024)
            while (true) {
                val entry = LibArchive.readNextHeader(archive)
                if (entry == 0L) break
                if (ArchiveEntry.filetype(entry) and ArchiveEntry.AE_IFMT != ArchiveEntry.AE_IFREG) continue
                val name = (ArchiveEntry.pathnameUtf8(entry) ?: ArchiveEntry.pathname(entry)?.let { String(it, Charsets.UTF_8) } ?: continue)
                    .replace('\\', '/')
                if (!wanted(name)) continue
                block(name, EntryStream(archive))
            }
        } finally {
            LibArchive.readFree(archive)
        }
    }

    /** The data of the entry libarchive is on. */
    private class EntryStream(private val archive: Long) : InputStream() {
        private var done = false

        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (done) return -1
            if (len == 0) return 0
            val buffer = ByteBuffer.wrap(b, off, len)
            LibArchive.readData(archive, buffer)
            val n = buffer.position() - off
            if (n <= 0) { done = true; return -1 }
            return n
        }

        override fun read(): Int {
            val one = ByteArray(1)
            return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
        }
    }
}
