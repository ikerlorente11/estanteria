package com.ikerlorente11.estanteria.host

import org.apache.commons.compress.archivers.tar.TarFile
import java.nio.ByteBuffer
import java.nio.channels.SeekableByteChannel

/**
 * Comics in a tar (cbt). A tar keeps every file whole and uncompressed after its 512-byte header, so
 * there is nothing to unpack: the headers are walked once (commons-compress' TarFile, which knows ustar
 * prefixes, GNU long names and pax headers) and each page is then read with one seek.
 */
object Tar {
    /** Where a file's bytes are inside the tar. */
    class Entry(val name: String, val offset: Long, val size: Long)

    /** The files of the tar whose names `keep` accepts, in the order of their names (`order`). The channel
     * is the caller's and stays open (TarFile holds nothing else; closing it would close the channel). */
    fun index(channel: SeekableByteChannel, keep: (String) -> Boolean, order: Comparator<String>): List<Entry> =
        TarFile(channel).entries.filter { it.isFile && !it.isSparse && keep(it.name) }
            .map { Entry(it.name, it.dataOffset, it.size) }
            .sortedWith { a, b -> order.compare(a.name, b.name) }

    /** The bytes of one entry. */
    fun read(channel: SeekableByteChannel, entry: Entry): ByteArray {
        if (entry.size > Int.MAX_VALUE) throw IllegalStateException("página demasiado grande")
        val buf = ByteBuffer.allocate(entry.size.toInt())
        channel.position(entry.offset)
        while (buf.hasRemaining()) if (channel.read(buf) < 0) throw IllegalStateException("el tar está cortado")
        return buf.array()
    }

    /** Whether these first bytes (at least 262) are a tar's: «ustar» at 257 (POSIX and GNU). */
    fun isTar(head: ByteArray): Boolean =
        head.size >= 262 && String(head, 257, 5, Charsets.ISO_8859_1) == "ustar"
}
