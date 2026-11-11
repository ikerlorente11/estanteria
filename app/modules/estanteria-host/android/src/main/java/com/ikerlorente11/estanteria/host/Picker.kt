package com.ikerlorente11.estanteria.host

import android.app.Activity
import android.content.Intent
import android.net.Uri
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

/** The system's folder and file choosers (Storage Access Framework), asked from a request of the page:
 * the request's thread waits here until the user picks or cancels. The module hands the activity's
 * result back through `onResult`. What is picked is kept readable across restarts. */
class Picker(private val activity: () -> Activity?) {
    private var waiting: CompletableFuture<List<String>>? = null

    fun pickFolders(): List<String> = ask(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }, FOLDERS)

    fun pickFiles(): List<String> = ask(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }, FILES)

    /** The system's «save as»: where and with what name; the new document's URI, null if cancelled. */
    fun createDocument(name: String, mime: String): String? = ask(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = mime.ifBlank { "application/octet-stream" }
        putExtra(Intent.EXTRA_TITLE, name)
    }, CREATE).firstOrNull()

    @Synchronized
    private fun ask(intent: Intent, code: Int): List<String> {
        val current = activity() ?: throw IllegalStateException("la app no está delante")
        waiting?.complete(emptyList())
        val future = CompletableFuture<List<String>>()
        waiting = future
        current.runOnUiThread { current.startActivityForResult(intent, code) }
        return try { future.get(10, TimeUnit.MINUTES) } catch (_: Exception) { emptyList() } finally { if (waiting === future) waiting = null }
    }

    /** From the module's OnActivityResult. */
    fun onResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != FOLDERS && requestCode != FILES && requestCode != CREATE) return
        val future = waiting ?: return
        if (resultCode != Activity.RESULT_OK || data == null) { future.complete(emptyList()); return }
        val uris = mutableListOf<Uri>()
        data.data?.let { uris.add(it) }
        data.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) } }
        val resolver = activity()?.contentResolver
        for (uri in uris) {
            if (requestCode == CREATE) break          // written once, now: nothing to keep
            try { resolver?.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) {}
        }
        future.complete(uris.map { it.toString() })
    }

    companion object {
        const val FOLDERS = 48101
        const val FILES = 48102
        const val CREATE = 48103
    }
}
