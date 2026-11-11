package com.ikerlorente11.estanteria.host

import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.kxml2.io.KXmlParser
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer

/** The pure parts of the shelf's new formats: the tar index, the MOBI and FB2 covers. */
class FormatsTest {
    private val jpegA = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 'A'.code.toByte())
    private val jpegB = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 'B'.code.toByte(), 'B'.code.toByte())

    // ---- tar ----
    @Test
    fun tarIndexesPagesAndReadsThemAtTheirOffsets() {
        val file = File.createTempFile("pages", ".cbt")
        val long = "a/" + "very-long-folder-name/".repeat(8) + "p1.jpg"      // > 100 chars: GNU long name or pax
        val files = linkedMapOf("b/p10.jpg" to "ten", "b/p2.jpg" to "two", long to "long", "notes.txt" to "no", "b/.hidden.jpg" to "no")
        TarArchiveOutputStream(FileOutputStream(file)).use { tar ->
            tar.setLongFileMode(TarArchiveOutputStream.LONGFILE_POSIX)
            for ((name, text) in files) {
                val bytes = text.toByteArray()
                tar.putArchiveEntry(TarArchiveEntry(name).apply { size = bytes.size.toLong() })
                tar.write(bytes)
                tar.closeArchiveEntry()
            }
        }
        val head = file.readBytes().copyOf(512)
        assertTrue(Tar.isTar(head))
        RandomAccessFile(file, "r").channel.use { ch ->
            val entries = Tar.index(ch, { it.endsWith(".jpg") && !it.substringAfterLast('/').startsWith(".") }, Shelf.NATURAL)
            assertEquals(listOf(long, "b/p2.jpg", "b/p10.jpg"), entries.map { it.name })
        }
        RandomAccessFile(file, "r").channel.use { ch ->
            val entries = Tar.index(ch, { it.endsWith(".jpg") }, Shelf.NATURAL)
            assertEquals("two", String(Tar.read(ch, entries.first { it.name == "b/p2.jpg" })))
            assertEquals("long", String(Tar.read(ch, entries.first { it.name == long })))
        }
        file.delete()
    }

    // ---- MOBI ----
    private fun be32(v: Long) = ByteBuffer.allocate(4).putInt(v.toInt()).array()

    /** A Palm database: records 0 (headers), 1 (text), then the images; EXTH 201 = `cover` if given. */
    private fun mobi(images: List<ByteArray>, cover: Long?, thumb: Long? = null): ByteArray {
        val firstImage = 2L
        val mobiLength = 0xE8
        val zero = ByteArray(16 + mobiLength)
        "MOBI".toByteArray().copyInto(zero, 16)
        be32(mobiLength.toLong()).copyInto(zero, 20)
        be32(firstImage).copyInto(zero, 0x6C)
        val exth = ByteArrayOutputStream()
        val records = listOfNotNull(cover?.let { 201L to it }, thumb?.let { 202L to it })
        if (records.isNotEmpty()) {
            be32(0x40).copyInto(zero, 0x80)
            exth.write("EXTH".toByteArray()); exth.write(be32(12L + records.size * 12)); exth.write(be32(records.size.toLong()))
            for ((type, value) in records) { exth.write(be32(type)); exth.write(be32(12)); exth.write(be32(value)) }
        }
        val recs = listOf(zero + exth.toByteArray(), "some text".toByteArray()) + images + listOf("FLIS0000".toByteArray())
        val out = ByteArrayOutputStream()
        val header = ByteArray(78)
        "BOOKMOBI".toByteArray().copyInto(header, 60)
        header[76] = (recs.size shr 8).toByte(); header[77] = recs.size.toByte()
        out.write(header)
        var offset = 78L + recs.size * 8 + 2
        for ((i, r) in recs.withIndex()) { out.write(be32(offset)); out.write(be32(i.toLong() * 2)); offset += r.size }
        out.write(ByteArray(2))
        recs.forEach { out.write(it) }
        return out.toByteArray()
    }

    private fun mobiCoverOf(bytes: ByteArray) = Books.mobiCover(bytes.size.toLong()) { at, n -> bytes.copyOfRange(at.toInt(), minOf(bytes.size, at.toInt() + n)) }

    @Test
    fun mobiCoverFollowsExth201() = assertArrayEquals(jpegB, mobiCoverOf(mobi(listOf(jpegA, jpegB), cover = 1)))

    @Test
    fun mobiCoverFallsBackToThumbnailThenFirstImage() {
        assertArrayEquals(jpegA, mobiCoverOf(mobi(listOf(jpegA, jpegB), cover = null, thumb = 0)))
        assertArrayEquals(jpegA, mobiCoverOf(mobi(listOf(jpegA, jpegB), cover = null)))
        assertArrayEquals(jpegB, mobiCoverOf(mobi(listOf("RESC".toByteArray(), jpegB), cover = null)))
    }

    @Test
    fun notAMobiHasNoCover() {
        assertNull(mobiCoverOf(ByteArray(200)))
        assertNull(mobiCoverOf(mobi(emptyList(), cover = null)))
    }

    // ---- FB2 ----
    private val b64 = java.util.Base64.getMimeEncoder(20, "\n".toByteArray())

    private fun fb2(cover: Boolean) = """<?xml version="1.0" encoding="windows-1251"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><book-title>Título</book-title>${if (cover) "<coverpage><image l:href=\"#cover.jpg\"/></coverpage>" else ""}</title-info></description>
<body><section><p>Text&nbsp;with an entity</p><image l:href="#other.png"/></section></body>
<binary id="other.png" content-type="image/png">${b64.encodeToString(jpegA)}</binary>
<binary id="cover.jpg" content-type="image/jpeg">
${b64.encodeToString(jpegB + ByteArray(40) { it.toByte() })}
</binary>
</FictionBook>""".toByteArray(charset("windows-1251"))

    @Test
    fun fb2CoverIsTheBinaryTheCoverpageNames() =
        assertArrayEquals(jpegB + ByteArray(40) { it.toByte() }, Books.fb2Cover(fb2(true).inputStream(), KXmlParser()))

    @Test
    fun fb2WithoutCoverpageHasNone() = assertNull(Books.fb2Cover(fb2(false).inputStream(), KXmlParser()))

    @Test
    fun base64SkipsWhatIsNotItsAlphabet() {
        val data = ByteArray(300) { (it * 7).toByte() }
        assertArrayEquals(data, Books.base64(" \r\n" + java.util.Base64.getMimeEncoder().encodeToString(data) + "\n"))
        assertArrayEquals(byteArrayOf(1, 2), Books.base64("AQI="))
    }

    @Test
    fun formatsByName() {
        assertEquals("fbz", Shelf.formatOf("Libro.FB2.zip"))
        assertEquals("cbz", Shelf.formatOf("tomo.zip"))
        assertEquals("cbt", Shelf.formatOf("tomo.cbt"))
        assertEquals("mobi", Shelf.formatOf("libro.azw3"))
        assertEquals("txt", Shelf.formatOf("libro.txt"))
        assertEquals("djvu", Shelf.formatOf("libro.djv"))
        assertNull(Shelf.formatOf("libro.doc"))
    }
}
