package com.ikerlorente11.estanteria.host

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/**
 * The device's own lock for the app's lock (Ajustes): its fingerprint or face, or its PIN, pattern or password
 * (BiometricPrompt with the device credential allowed). Asked from a request of the page, like Picker: the
 * request's thread waits here until the person passes or gives up.
 *
 * BIOMETRIC_WEAK | DEVICE_CREDENTIAL is the one combination androidx.biometric takes on every Android version
 * (DEVICE_CREDENTIAL alone and BIOMETRIC_STRONG | DEVICE_CREDENTIAL only from Android 11); below Android 11 the
 * library falls back to the system's «confirm your PIN» screen when there is no biometric enrolled.
 */
class Lock(private val context: Context, private val activity: () -> Activity?) {

    /** Whether this device has a lock set up the prompt can ask for. */
    fun available(): Boolean {
        val result = try { BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) } catch (e: Exception) {
            Log.w("estanteria", "canAuthenticate", e); BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE
        }
        if (result == BiometricManager.BIOMETRIC_SUCCESS) return true
        // before Android 11 the library may not count the PIN alone: a secure keyguard is enough for the prompt
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            val keyguard = context.getSystemService(KeyguardManager::class.java)
            return keyguard?.isDeviceSecure == true
        }
        return false
    }

    /** Shows the prompt (title «La Estantería», `reason` under it) and answers whether the person passed. */
    @Synchronized
    fun unlock(reason: String): Boolean {
        val current = activity() as? FragmentActivity ?: return false
        if (current.isFinishing || !current.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) return false
        val outcome = CompletableFuture<Boolean>()
        current.runOnUiThread {
            try {
                val prompt = BiometricPrompt(current, ContextCompat.getMainExecutor(current), object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { outcome.complete(true) }
                    override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                        Log.i("estanteria", "desbloqueo: $errorCode $errString")
                        outcome.complete(false)
                    }
                    // onAuthenticationFailed: a finger not recognised; the prompt stays for another try
                })
                val info = BiometricPrompt.PromptInfo.Builder()
                    .setTitle("La Estantería")
                    .apply { if (reason.isNotBlank()) setSubtitle(reason) }
                    .setAllowedAuthenticators(AUTHENTICATORS)
                    .build()
                prompt.authenticate(info)
            } catch (e: Exception) {
                Log.w("estanteria", "no se pudo pedir el desbloqueo", e)
                outcome.complete(false)
            }
        }
        return try { outcome.get(10, TimeUnit.MINUTES) } catch (_: Exception) { false }
    }

    companion object {
        private const val AUTHENTICATORS = BIOMETRIC_WEAK or DEVICE_CREDENTIAL
    }
}
