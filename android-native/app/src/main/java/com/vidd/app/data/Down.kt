package com.vidd.app.data

import android.app.DownloadManager
import android.content.Context
import android.net.Uri
import android.os.Environment
import java.io.File

data class DlProgress(
    val status: Int,       // DownloadManager.STATUS_* jaisa
    val downloaded: Long,
    val total: Long,
) {
    val fraction: Float
        get() = if (total > 0) (downloaded.toFloat() / total).coerceIn(0f, 1f) else 0f
}

/** Video download (offline) ka poora kaam — Android ka DownloadManager. */
object Down {

    fun fileNameFor(movie: Movie): String {
        val ext = movie.videoUrl
            ?.lowercase()?.substringBefore("?")
            ?.substringAfterLast(".", "")
            ?.takeIf { it in setOf("mp4", "webm", "mkv", "mov") } ?: "mp4"
        val safe = movie.title.replace(Regex("[^A-Za-z0-9]+"), "_").take(40)
        return "vidd_${movie.id}_${safe}.$ext"
    }

    fun fileFor(ctx: Context, fileName: String): File =
        File(ctx.getExternalFilesDir(Environment.DIRECTORY_MOVIES), fileName)

    /** Download shuru karo → DownloadManager ID milegi. */
    fun enqueue(ctx: Context, movie: Movie): Long {
        val url = movie.videoUrl ?: return -1
        val req = DownloadManager.Request(Uri.parse(url))
            .setTitle(movie.title)
            .setDescription("vid offline video")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(
                ctx, Environment.DIRECTORY_MOVIES, fileNameFor(movie)
            )
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(false)
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        return dm.enqueue(req)
    }

    /** Download kahan tak pahuncha? */
    fun progress(ctx: Context, dmId: Long): DlProgress? {
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val c = dm.query(DownloadManager.Query().setFilterById(dmId))
        c?.use {
            if (it.moveToFirst()) {
                val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                val done = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                return DlProgress(status, done, total)
            }
        }
        return null
    }

    fun cancel(ctx: Context, dmId: Long) {
        val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        try { dm.remove(dmId) } catch (_: Exception) { }
    }

    /** Offline play ke liye file taiyaar hai? */
    fun localFile(ctx: Context, meta: DlMeta): File? {
        val f = fileFor(ctx, meta.fileName)
        return if (f.exists() && f.length() > 0) f else null
    }
}
