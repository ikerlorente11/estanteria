package com.ikerlorente11.estanteria.host

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

/** Where La Estantería is and who you are: the address and user in the app's preferences, the app
 * password encrypted with a key of the Android keystore (like the credential store on Windows). */
class Settings(context: Context) {
    private val plain: SharedPreferences = context.getSharedPreferences("estanteria", Context.MODE_PRIVATE)
    private val secret: SharedPreferences by lazy {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "estanteria.secret", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    var url: String
        get() = (plain.getString("url", null) ?: DEFAULT_URL).trimEnd('/')
        set(value) { plain.edit().putString("url", value.trimEnd('/')).apply() }

    var username: String
        get() = plain.getString("username", "") ?: ""
        set(value) { plain.edit().putString("username", value).apply() }

    /** the app password of `username` ('' when none is kept) */
    fun token(): String = if (username.isEmpty()) "" else (secret.getString("token:$username", "") ?: "")
    fun saveToken(token: String) { secret.edit().putString("token:$username", token).apply() }
    fun forgetToken() { secret.edit().remove("token:$username").apply() }

    /** The Authorization header the service wants (HTTP basic with the app password). */
    fun authorization(): String? {
        val token = token()
        if (username.isEmpty() || token.isEmpty()) return null
        val raw = "$username:$token".toByteArray(Charsets.UTF_8)
        return "Basic " + android.util.Base64.encodeToString(raw, android.util.Base64.NO_WRAP)
    }

    /** One folder per account and service, so two users of the same device keep their own downloads. */
    fun accountKey(): String {
        val host = try { java.net.URL(url).host } catch (_: Exception) { url }
        return "$username@$host".replace(Regex("[^A-Za-z0-9-]"), "_")
    }

    fun describe(): JSONObject = JSONObject().put("url", url).put("username", username).put("hasToken", token().isNotEmpty())

    companion object {
        const val DEFAULT_URL = "https://estanteria.pistation.dev"
    }
}
