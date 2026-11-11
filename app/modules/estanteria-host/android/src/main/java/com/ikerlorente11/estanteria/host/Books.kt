package com.ikerlorente11.estanteria.host

import org.xmlpull.v1.XmlPullParser
import java.io.InputStream
import java.io.InputStreamReader

/**
 * The covers of the books the viewer lays out itself (foliate-js reads them whole from `/shelf/f/`):
 * here only the image the book declares as its cover is dug out. EPUB's is in Shelf (it needs the zip);
 * these work on bytes and streams so they can be tried without Android.
 */
object Books {
    // ---- MOBI, AZW, AZW3 (KF8), PRC: a Palm database whose records after the text are the images ----
    private const val NONE = 0xFFFFFFFFL

    /**
     * The cover of a Mobipocket book of `size` bytes, reading it with `read(offset, length)`: the record
     * EXTH 201 points at (counted from the MOBI header's first image), else EXTH 202's thumbnail, else the
     * first image record. Null when there is none (or this is not a MOBI).
     */
    fun mobiCover(size: Long, read: (Long, Int) -> ByteArray): ByteArray? {
        if (size < 86) return null
        val head = read(0, 78)
        if (String(head, 60, 8, Charsets.ISO_8859_1) != "BOOKMOBI") return null
        val count = u16(head, 76)
        if (count < 2 || 78L + count * 8L > size) return null
        val table = read(78, count * 8)
        fun start(i: Int) = u32(table, i * 8)
        fun end(i: Int) = if (i + 1 < count) start(i + 1) else size
        fun record(i: Int, limit: Int): ByteArray? {
            val from = start(i)
            val length = (end(i) - from).coerceAtMost(limit.toLong())
            return if (from in 0 until size && length > 0) read(from, length.toInt()) else null
        }

        val zero = record(0, 1 shl 18) ?: return null
        if (zero.size < 0x84 || String(zero, 16, 4, Charsets.ISO_8859_1) != "MOBI") return null
        val headerLength = u32(zero, 20)
        val firstImage = u32(zero, 0x6C)
        if (firstImage == NONE || firstImage <= 0 || firstImage >= count) return null
        var cover = NONE
        var thumb = NONE
        if (u32(zero, 0x80) and 0x40L != 0L) {
            var p = (16 + headerLength).toInt()
            if (p >= 16 && p + 12 <= zero.size && String(zero, p, 4, Charsets.ISO_8859_1) == "EXTH") {
                val records = u32(zero, p + 8)
                p += 12
                var i = 0L
                while (i < records && p + 8 <= zero.size) {
                    val type = u32(zero, p)
                    val length = u32(zero, p + 4).toInt()
                    if (length < 8) break
                    if (length >= 12 && p + 12 <= zero.size) {
                        if (type == 201L) cover = u32(zero, p + 8)
                        if (type == 202L) thumb = u32(zero, p + 8)
                    }
                    p += length
                    i++
                }
            }
        }
        fun image(relative: Long): ByteArray? {
            if (relative == NONE) return null
            val i = firstImage + relative
            if (i >= count) return null
            return record(i.toInt(), MAX_IMAGE)?.takeIf { isImage(it) }
        }
        image(cover)?.let { return it }
        image(thumb)?.let { return it }
        // no EXTH saying which: the first record from the first image on that is an image
        var i = firstImage.toInt()
        while (i < count && i < firstImage + 64) {
            val r = record(i, MAX_IMAGE)
            if (r != null && isImage(r)) return r
            if (r != null && r.size >= 4 && String(r, 0, 4, Charsets.ISO_8859_1) in setOf("FLIS", "FCIS", "SRCS", "BOUN", "FDST")) break
            i++
        }
        return null
    }

    private const val MAX_IMAGE = 32 shl 20

    private fun u16(b: ByteArray, at: Int): Int = ((b[at].toInt() and 0xff) shl 8) or (b[at + 1].toInt() and 0xff)
    private fun u32(b: ByteArray, at: Int): Long =
        ((b[at].toLong() and 0xff) shl 24) or ((b[at + 1].toLong() and 0xff) shl 16) or ((b[at + 2].toLong() and 0xff) shl 8) or (b[at + 3].toLong() and 0xff)

    /** JPEG, PNG, GIF or BMP, by their first bytes. */
    fun isImage(b: ByteArray): Boolean = b.size >= 4 && (
        (b[0] == 0xFF.toByte() && b[1] == 0xD8.toByte() && b[2] == 0xFF.toByte()) ||
            (b[0] == 0x89.toByte() && b[1] == 'P'.code.toByte() && b[2] == 'N'.code.toByte() && b[3] == 'G'.code.toByte()) ||
            (b[0] == 'G'.code.toByte() && b[1] == 'I'.code.toByte() && b[2] == 'F'.code.toByte()) ||
            (b[0] == 'B'.code.toByte() && b[1] == 'M'.code.toByte()))

    // ---- FB2: XML with the images inside, in base64 ----
    /**
     * The cover of a FictionBook: `<coverpage><image l:href="#id"/>` in the description, then the
     * `<binary id="id">` it names (the binaries go at the end; the file is read as a stream, never whole).
     * The XML is read as Latin-1: only the markup and the base64 matter here, and an id spelled in another
     * alphabet is spelled the same way in both places. `parser` is a fresh XmlPullParser (Android's
     * `Xml.newPullParser()`).
     */
    fun fb2Cover(input: InputStream, parser: XmlPullParser): ByteArray? {
        try { parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false) } catch (_: Exception) {}
        try { parser.setFeature("http://xmlpull.org/v1/doc/features.html#relaxed", true) } catch (_: Exception) {}   // &nbsp; and the like
        parser.setInput(InputStreamReader(input, Charsets.ISO_8859_1))
        var inCoverpage = false
        var wanted: String? = null
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG) {
                when (parser.name.substringAfter(':')) {
                    "coverpage" -> inCoverpage = true
                    "image" -> if (inCoverpage && wanted == null) {
                        for (a in 0 until parser.attributeCount) {
                            if (parser.getAttributeName(a).substringAfter(':') == "href") wanted = parser.getAttributeValue(a).trim().removePrefix("#")
                        }
                    }
                    "body" -> if (wanted == null) return null          // past the description without a cover
                    "binary" -> if (wanted != null && attribute(parser, "id") == wanted) return base64(parser.nextText())
                }
            } else if (event == XmlPullParser.END_TAG) {
                when (parser.name.substringAfter(':')) {
                    "coverpage" -> inCoverpage = false
                    "description" -> if (wanted == null) return null
                }
            }
            event = parser.next()
        }
        return null
    }

    private fun attribute(parser: XmlPullParser, name: String): String? {
        for (a in 0 until parser.attributeCount) if (parser.getAttributeName(a).substringAfter(':') == name) return parser.getAttributeValue(a)
        return null
    }

    /** Base64, skipping what is not of its alphabet (the line breaks and spaces of an FB2's binaries). */
    fun base64(text: String): ByteArray {
        val out = java.io.ByteArrayOutputStream(text.length * 3 / 4)
        var bits = 0
        var held = 0
        for (c in text) {
            val v = when (c) {
                in 'A'..'Z' -> c - 'A'
                in 'a'..'z' -> c - 'a' + 26
                in '0'..'9' -> c - '0' + 52
                '+', '-' -> 62
                '/', '_' -> 63
                '=' -> break
                else -> continue
            }
            bits = ((bits shl 6) or v) and 0xffff
            held += 6
            if (held >= 8) {
                held -= 8
                out.write((bits shr held) and 0xff)
            }
        }
        return out.toByteArray()
    }
}
