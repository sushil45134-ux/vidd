package com.vidd.app.data

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Download poora hote hi Store update + notification. */
class DownloadReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) return
        val dmId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1)
        if (dmId == -1L) return
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val meta = Store.findByDmId(dmId)
                if (meta != null) {
                    val prog = Down.progress(ctx, dmId)
                    if (prog?.status == DownloadManager.STATUS_SUCCESSFUL) {
                        Store.putDownload(meta.copy(done = true, size = prog.total))
                        Notify.downloadDone(ctx, meta.title)
                    }
                }
            } catch (_: Exception) {
            } finally {
                pending.finish()
            }
        }
    }
}
