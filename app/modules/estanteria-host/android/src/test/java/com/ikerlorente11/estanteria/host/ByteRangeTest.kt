package com.ikerlorente11.estanteria.host

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Range header of `/shelf/f/`: what a <video>, pdf.js and epub.js ask for. */
class ByteRangeTest {
    private fun unsatisfiable(r: LongRange?) = assertTrue("$r", r != null && r.isEmpty())

    @Test
    fun noRangeIsTheWholeFile() {
        assertNull(ByteRange.parse(null, 1000))
        assertNull(ByteRange.parse("items=0-10", 1000))
        assertNull(ByteRange.parse("bytes=0-10", -1))         // the size is not known: the whole file, 200
    }

    @Test
    fun fromAndTo() {
        assertEquals(0L..999L, ByteRange.parse("bytes=0-", 1000))           // what a <video> asks first
        assertEquals(500L..999L, ByteRange.parse("bytes=500-", 1000))       // and after a seek
        assertEquals(0L..1L, ByteRange.parse("bytes=0-1", 1000))
        assertEquals(10L..999L, ByteRange.parse("bytes=10-5000", 1000))     // the end, cut to the file
        assertEquals(999L..999L, ByteRange.parse("Bytes=999-999", 1000))
    }

    @Test
    fun theLastBytes() {
        assertEquals(900L..999L, ByteRange.parse("bytes=-100", 1000))      // an MP4's index at its end
        assertEquals(0L..999L, ByteRange.parse("bytes=-5000", 1000))
        unsatisfiable(ByteRange.parse("bytes=-0", 1000))
        unsatisfiable(ByteRange.parse("bytes=-10", 0))
    }

    @Test
    fun onlyTheFirstOfSeveral() = assertEquals(0L..9L, ByteRange.parse("bytes=0-9, 20-29", 1000))

    @Test
    fun pastTheEnd() {
        unsatisfiable(ByteRange.parse("bytes=1000-", 1000))
        unsatisfiable(ByteRange.parse("bytes=2000-3000", 1000))
        unsatisfiable(ByteRange.parse("bytes=0-", 0))
    }

    @Test
    fun whatDoesNotParseIsIgnored() {
        assertNull(ByteRange.parse("bytes=10-5", 1000))
        assertNull(ByteRange.parse("bytes=abc-", 1000))
        assertNull(ByteRange.parse("bytes=5", 1000))
        assertNull(ByteRange.parse("bytes=-", 1000))
    }
}
