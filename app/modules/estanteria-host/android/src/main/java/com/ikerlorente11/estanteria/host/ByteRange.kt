package com.ikerlorente11.estanteria.host

/**
 * The piece of a file a `Range` header asks for (pdf.js and epub.js ask for pieces; a <video> asks for the
 * rest from where it is at, `bytes=N-`, and for the end when the index of an MP4 lies there). Only the first
 * range of the header is answered: no multipart answers here, the browser takes the one piece.
 */
object ByteRange {
    /** What is past the end: answered 416, with the file's size in Content-Range. */
    val UNSATISFIABLE = LongRange.EMPTY

    /**
     * The bytes `header` asks for of a file of `size` bytes, both ends included; [UNSATISFIABLE] when they lie
     * past its end; null when the whole file goes (no header, another unit, a size not known, or a range that
     * does not parse, which the RFC says to ignore).
     */
    fun parse(header: String?, size: Long): LongRange? {
        if (header == null || size < 0) return null
        val spec = header.trim()
        if (!spec.startsWith("bytes=", ignoreCase = true)) return null
        val first = spec.substring(6).substringBefore(',').trim()
        val dash = first.indexOf('-')
        if (dash < 0) return null
        val from = first.substring(0, dash).trim()
        val to = first.substring(dash + 1).trim()
        if (from.isEmpty()) {
            // `bytes=-N`: the last N bytes
            val n = to.toLongOrNull()?.takeIf { it >= 0 } ?: return null
            if (n == 0L || size == 0L) return UNSATISFIABLE
            return maxOf(0L, size - n)..(size - 1)
        }
        val start = from.toLongOrNull()?.takeIf { it >= 0 } ?: return null
        val end = if (to.isEmpty()) size - 1 else to.toLongOrNull()?.takeIf { it >= start } ?: return null
        if (start >= size) return UNSATISFIABLE
        return start..minOf(end, size - 1)
    }
}
