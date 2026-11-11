package com.ikerlorente11.estanteria.host

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.os.Build
import com.awxkee.jxlcoder.JxlCoder
import com.awxkee.jxlcoder.PreferredColorConfig
import com.awxkee.jxlcoder.ScaleMode
import java.io.ByteArrayOutputStream

/**
 * Decoding the images of comics, also those the web view cannot show: JPEG XL (no decoder in Android
 * nor in the web view: libjxl, through jxl-coder), served as JPEG. AVIF pages go as they are: the web
 * view (Chrome 85+) shows them, while Android's own decoder depends on the maker before Android 14.
 */
object Images {
    /** the widest a page made JPEG here is (as the PDF pages rendered) */
    const val MAX_PAGE = 3200

    /** A page that is served as JPEG instead of as it is, by its name. */
    fun needsJpeg(name: String): Boolean = name.substringAfterLast('.', "").lowercase() == "jxl"

    /** JPEG XL, by its first bytes: a bare codestream (FF 0A) or the ISO box container. */
    fun isJxl(b: ByteArray): Boolean =
        (b.size >= 2 && b[0] == 0xFF.toByte() && b[1] == 0x0A.toByte()) ||
            (b.size >= 12 && b.copyOf(12).contentEquals(byteArrayOf(0, 0, 0, 0x0C, 0x4A, 0x58, 0x4C, 0x20, 0x0D, 0x0A, 0x87.toByte(), 0x0A)))

    /** AVIF, by its `ftyp` box: the brand or a compatible brand says avif (avis when animated). */
    fun isAvif(b: ByteArray): Boolean {
        if (b.size < 16 || String(b, 4, 4, Charsets.ISO_8859_1) != "ftyp") return false
        val box = ((b[0].toInt() and 0xff) shl 24 or ((b[1].toInt() and 0xff) shl 16) or ((b[2].toInt() and 0xff) shl 8) or (b[3].toInt() and 0xff))
            .coerceIn(16, minOf(b.size, 256))
        return (8 until box - 3 step 4).any { String(b, it, 4, Charsets.ISO_8859_1) in setOf("avif", "avis") }
    }

    /** Width and height without decoding the pixels (0, 0 when they cannot be told). */
    fun size(raw: ByteArray): Pair<Int, Int> {
        if (isJxl(raw)) return try { JxlCoder.getSize(raw)?.let { it.width to it.height } ?: (0 to 0) } catch (_: Throwable) { 0 to 0 }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
        return bounds.outWidth.coerceAtLeast(0) to bounds.outHeight.coerceAtLeast(0)
    }

    /** The image decoded, no wider than `maxWidth`. */
    fun decode(raw: ByteArray, maxWidth: Int): Bitmap {
        if (isJxl(raw)) return jxl(raw, maxWidth)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
        if (bounds.outWidth <= 0) throw unreadable(raw)
        val opts = BitmapFactory.Options().apply {
            inSampleSize = 1
            while (bounds.outWidth / (inSampleSize * 2) >= maxWidth) inSampleSize *= 2
        }
        val decoded = BitmapFactory.decodeByteArray(raw, 0, raw.size, opts) ?: throw unreadable(raw)
        if (decoded.width <= maxWidth) return decoded
        val scaled = Bitmap.createScaledBitmap(decoded, maxWidth, (decoded.height.toLong() * maxWidth / decoded.width).toInt().coerceAtLeast(1), true)
        if (scaled !== decoded) decoded.recycle()
        return scaled
    }

    /** The image as JPEG, no wider than `maxWidth` (what is transparent, on white). */
    fun toJpeg(raw: ByteArray, maxWidth: Int = MAX_PAGE, quality: Int = 88): ByteArray {
        var bitmap = decode(raw, maxWidth)
        if (bitmap.hasAlpha()) {
            val flat = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
            Canvas(flat).apply { drawColor(Color.WHITE); drawBitmap(bitmap, 0f, 0f, null) }
            bitmap.recycle()
            bitmap = flat
        }
        val out = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
        bitmap.recycle()
        return out.toByteArray()
    }

    private fun jxl(raw: ByteArray, maxWidth: Int): Bitmap = try {
        val size = JxlCoder.getSize(raw) ?: throw IllegalStateException("no es un JPEG XL válido")
        if (size.width > maxWidth) {
            val height = (size.height.toLong() * maxWidth / size.width).toInt().coerceAtLeast(1)
            JxlCoder.decodeSampled(raw, maxWidth, height, PreferredColorConfig.RGBA_8888, ScaleMode.FIT)
        } else {
            JxlCoder.decode(raw, PreferredColorConfig.RGBA_8888)
        }
    } catch (e: Throwable) {          // also the library failing to load (an UnsatisfiedLinkError)
        throw IllegalStateException("No se pudo leer la imagen JPEG XL: ${e.message ?: e}")
    }

    private fun unreadable(raw: ByteArray): Exception =
        if (isAvif(raw) && Build.VERSION.SDK_INT < Build.VERSION_CODES.S) IllegalStateException("Las imágenes AVIF necesitan Android 12 o posterior.")
        else IllegalStateException("imagen ilegible")
}
