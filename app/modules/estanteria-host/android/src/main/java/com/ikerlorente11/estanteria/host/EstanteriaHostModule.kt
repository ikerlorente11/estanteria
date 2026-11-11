package com.ikerlorente11.estanteria.host

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.BindException

/** The native side of La Estantería for Android: starts the local server the web view loads the viewer
 * from (see HostServer) and keeps it while the app lives. */
class EstanteriaHostModule : Module() {
    private var server: HostServer? = null
    private val picker = Picker { appContext.currentActivity }
    private val volumeKeys = VolumeKeys { dir -> sendEvent("onVolumeKey", mapOf("dir" to dir)) }
    private val settings: Settings? by lazy { appContext.reactContext?.applicationContext?.let { Settings(it) } }

    override fun definition() = ModuleDefinition {
        Name("EstanteriaHost")

        /** a volume key pressed while they turn pages: `{ dir }`, +1 for volume down (next page), -1 for volume up */
        Events("onVolumeKey")

        OnActivityResult { _, payload -> picker.onResult(payload.requestCode, payload.resultCode, payload.data) }

        /** Starts the server (or finds it running) and says where the page is: `{ url, token }`. */
        AsyncFunction("start") {
            val running = server
            if (running != null && running.isAlive) {
                return@AsyncFunction mapOf("url" to "http://127.0.0.1:${running.listeningPort}/", "token" to running.token)
            }
            val context = appContext.reactContext ?: throw IllegalStateException("sin contexto de la app")
            var last: Exception? = null
            for (port in HostServer.PORT until HostServer.PORT + 5) {
                try {
                    val candidate = HostServer(context.applicationContext, port, picker) { appContext.currentActivity }
                    candidate.start()
                    server = candidate
                    Log.i("estanteria", "host en 127.0.0.1:$port")
                    return@AsyncFunction mapOf("url" to "http://127.0.0.1:$port/", "token" to candidate.token)
                } catch (e: BindException) {
                    last = e
                }
            }
            throw IllegalStateException("No se pudo abrir el servidor local: ${last?.message}")
        }

        /** While on, the volume keys turn pages (onVolumeKey) instead of changing the volume. */
        Function("setVolumeKeys") { on: Boolean ->
            volumeKeys.on = on
            if (on) volumeKeys.install(appContext.currentActivity)
        }

        /** Why a download of the app's own may not start now («solo con wifi» on mobile data), or null. */
        Function("downloadBlocked") {
            val context = appContext.reactContext?.applicationContext
            val s = settings
            if (context == null || s == null) null else Wifi.blocked(context, s)
        }

        // the window callback that takes the volume keys goes on every activity the app shows (a recreated one too)
        OnActivityEntersForeground { volumeKeys.install(appContext.currentActivity) }

        Function("stop") {
            server?.stop()
            server = null
        }

        OnDestroy {
            server?.stop()
            server = null
        }
    }
}
