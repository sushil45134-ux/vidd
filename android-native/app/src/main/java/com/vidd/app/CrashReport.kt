package com.vidd.app

import android.content.Context
import android.content.Intent
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter

/**
 * App kabhi crash ho to wajah file me likh do —
 * agli baar khulne par user wahi report share kar sakega.
 */
object CrashReport {
    private const val FILE = "last_crash.txt"

    fun install(ctx: Context) {
        val dir = ctx.applicationContext.filesDir
        val old = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            try {
                val sw = StringWriter()
                e.printStackTrace(PrintWriter(sw))
                val info = "Phone: ${Build.MANUFACTURER} ${Build.MODEL}\n" +
                    "Android: ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})\n" +
                    "App: 2.0.1\n\n$sw"
                File(dir, FILE).writeText(info.take(20000))
            } catch (_: Exception) {
            }
            old?.uncaughtException(t, e)
        }
    }

    fun read(ctx: Context): String? {
        return try {
            val f = File(ctx.filesDir, FILE)
            if (f.exists()) f.readText() else null
        } catch (_: Exception) { null }
    }

    fun clear(ctx: Context) {
        try {
            File(ctx.filesDir, FILE).delete()
        } catch (_: Exception) {
        }
    }

    fun shareIntent(text: String): Intent {
        return Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, "vid app crash report:\n\n$text")
        }
    }
}
