package com.vidd.app.data

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.vidd.app.MainActivity
import com.vidd.app.R

object Notify {

    private const val CH_NEW = "vidd_new_videos"
    private const val CH_DL = "vidd_downloads"

    fun channels(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CH_NEW, "Naye videos", NotificationManager.IMPORTANCE_DEFAULT)
        )
        nm.createNotificationChannel(
            NotificationChannel(CH_DL, "Downloads", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    private fun canNotify(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun openApp(ctx: Context): PendingIntent {
        val i = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            ctx, 0, i,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /** "3 naye videos aaye!" wali notification. */
    fun newVideos(ctx: Context, count: Int, firstTitle: String) {
        if (!canNotify(ctx)) return
        val text = if (count == 1) firstTitle else "$firstTitle + ${count - 1} aur"
        val n = NotificationCompat.Builder(ctx, CH_NEW)
            .setSmallIcon(R.drawable.ic_stat_vid)
            .setContentTitle("🎬 $count naya video aaya!")
            .setContentText(text)
            .setContentIntent(openApp(ctx))
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(ctx).notify(1001, n)
    }

    /** "Download ho gaya" wali notification. */
    fun downloadDone(ctx: Context, title: String) {
        if (!canNotify(ctx)) return
        val n = NotificationCompat.Builder(ctx, CH_DL)
            .setSmallIcon(R.drawable.ic_stat_vid)
            .setContentTitle("⬇️ Download poora hua")
            .setContentText(title)
            .setContentIntent(openApp(ctx))
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(ctx).notify(2001, n)
    }
}
