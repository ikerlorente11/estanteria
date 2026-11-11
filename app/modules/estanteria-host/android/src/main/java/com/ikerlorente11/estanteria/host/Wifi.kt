package com.ikerlorente11.estanteria.host

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/** «Solo con wifi» (Ajustes): while it is on, every download the app makes (into the shelf, for reading offline,
 * the app's own) first looks at the network it would use, and on one that costs (mobile data) it is refused with
 * a clear message. Browsing (catalogs, the server's lists, covers and pages read online) goes on any network. */
object Wifi {
    const val MESSAGE = "Descarga en pausa: solo con wifi (cámbialo en Ajustes)."

    /** Whether the active network is free to download on: not metered, or Wi-Fi or Ethernet. With no network at
     * all it says yes, so the download fails with its own «sin conexión» rather than a wrong reason. */
    fun unmetered(context: Context): Boolean {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return true
        val network = manager.activeNetwork ?: return true
        val caps = manager.getNetworkCapabilities(network) ?: return true
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    /** The reason a download may not start now, or null when it may. */
    fun blocked(context: Context, settings: Settings): String? =
        if (settings.wifiOnly && !unmetered(context)) MESSAGE else null

    /** Throws WifiOnlyException when a download may not start now (the host answers it as a 409). */
    fun check(context: Context, settings: Settings) {
        if (blocked(context, settings) != null) throw WifiOnlyException()
    }
}

class WifiOnlyException : IllegalStateException(Wifi.MESSAGE)
