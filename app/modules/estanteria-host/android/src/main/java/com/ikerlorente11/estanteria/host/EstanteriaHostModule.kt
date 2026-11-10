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

    override fun definition() = ModuleDefinition {
        Name("EstanteriaHost")

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
                    val candidate = HostServer(context.applicationContext, port, picker)
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
