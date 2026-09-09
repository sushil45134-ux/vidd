package com.vidd.app

import android.app.Application
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.vidd.app.data.Notify
import com.vidd.app.data.Store
import com.vidd.app.work.RefreshWorker
import java.util.concurrent.TimeUnit

class ViddApp : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashReport.install(this)
        Store.init(this)
        Notify.channels(this)

        // Har 6 ghante me naye videos check karo (sirf internet par).
        val req = PeriodicWorkRequestBuilder<RefreshWorker>(6, TimeUnit.HOURS)
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build()
            )
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "vidd-refresh",
            ExistingPeriodicWorkPolicy.KEEP,
            req,
        )
    }
}
