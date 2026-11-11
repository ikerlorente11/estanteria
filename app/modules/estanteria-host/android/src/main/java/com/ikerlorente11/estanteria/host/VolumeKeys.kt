package com.ikerlorente11.estanteria.host

import android.app.Activity
import android.view.KeyEvent
import android.view.Window
import java.lang.ref.WeakReference

/**
 * The volume keys turning pages while a reader is open (Ajustes), without touching MainActivity: the activity's
 * window callback is wrapped in one that takes KEYCODE_VOLUME_UP/DOWN while `on` (both their DOWN and their UP, so
 * the system's volume does not change) and hands everything else to the one it wraps. Installed once per window,
 * on the UI thread; a new activity (recreated) gets it again from the module's foreground hook.
 * `turn` gets +1 for volume down (next page) and -1 for volume up (previous one).
 */
class VolumeKeys(private val turn: (Int) -> Unit) {
    @Volatile var on = false
    private var installed: WeakReference<Window>? = null

    fun install(activity: Activity?) {
        val current = activity ?: return
        current.runOnUiThread {
            val window = current.window ?: return@runOnUiThread
            val base = window.callback ?: return@runOnUiThread
            if (installed?.get() === window && base is Callback) return@runOnUiThread
            if (base !is Callback) window.callback = Callback(base)
            installed = WeakReference(window)
        }
    }

    private inner class Callback(private val base: Window.Callback) : Window.Callback by base {
        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            val code = event.keyCode
            if (on && (code == KeyEvent.KEYCODE_VOLUME_DOWN || code == KeyEvent.KEYCODE_VOLUME_UP)) {
                // one page per press (holding the key does not run through the book)
                if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) turn(if (code == KeyEvent.KEYCODE_VOLUME_DOWN) 1 else -1)
                return true
            }
            return base.dispatchKeyEvent(event)
        }
    }
}
