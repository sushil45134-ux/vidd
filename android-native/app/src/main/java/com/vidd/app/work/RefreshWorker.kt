package com.vidd.app.work

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.vidd.app.data.Notify
import com.vidd.app.data.Store
import com.vidd.app.data.Supa
import com.vidd.app.data.parseMoviesJson

/**
 * Har kuch ghante me Supabase check karta hai:
 * koi naya video aaya to notification bhejta hai.
 * (App band ho tab bhi Android ise chala deta hai.)
 */
class RefreshWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        return try {
            val movies = parseMoviesJson(Supa.api.movies())
            if (movies.isEmpty()) return Result.success()

            val maxSeen = movies.maxOf { it.createdAt }
            val lastSeen = Store.lastSeen()

            if (lastSeen.isEmpty()) {
                // Pehli baar: sirf hisaab note karo, notification mat bhejo.
                Store.setLastSeen(maxSeen)
                return Result.success()
            }

            val fresh = movies.filter { it.createdAt > lastSeen }.sortedBy { it.createdAt }
            Store.setLastSeen(maxSeen)
            if (fresh.isNotEmpty()) {
                Notify.newVideos(applicationContext, fresh.size, fresh.last().title)
            }
            Result.success()
        } catch (_: Exception) {
            Result.success() // fail par retry-spam nahi — agli baar phir check hoga
        }
    }
}
