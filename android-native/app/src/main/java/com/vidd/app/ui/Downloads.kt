package com.vidd.app.ui

import android.app.DownloadManager
import android.text.format.Formatter
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vidd.app.data.DlMeta
import com.vidd.app.data.Down
import com.vidd.app.data.Store
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DownloadsScreen(onPlay: (Long) -> Unit) {
    val dls by Store.downloads.collectAsStateWithLifecycle(initialValue = emptyMap())
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()

    Scaffold(topBar = { ViddTopBar("Downloads") }, containerColor = Color.Black) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            if (dls.isEmpty()) {
                EmptyState(
                    "⬇️", "Koi download nahi",
                    "Direct video (mp4) par Download dabao — bina internet ke dekho.\nNote: YouTube wale videos download nahi hote."
                )
            } else {
                LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(dls.values.toList(), key = { it.id }) { meta ->
                        DownloadRow(
                            meta = meta,
                            onPlay = { onPlay(meta.id) },
                            onDelete = {
                                scope.launch {
                                    Down.cancel(ctx, meta.dmId)
                                    try { Down.localFile(ctx, meta)?.delete() } catch (_: Exception) { }
                                    Store.removeDownload(meta.id)
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DownloadRow(meta: DlMeta, onPlay: () -> Unit, onDelete: () -> Unit) {
    val ctx = LocalContext.current
    val fileOk = Down.localFile(ctx, meta) != null

    // Chalti download ka progress live
    val frac by produceState<Float?>(null, meta.done, meta.dmId) {
        while (!meta.done) {
            val p = try { Down.progress(ctx, meta.dmId) } catch (_: Exception) { null }
            if (p == null) break
            value = if (p.status == DownloadManager.STATUS_SUCCESSFUL) 1f else p.fraction
            if (p.status == DownloadManager.STATUS_SUCCESSFUL ||
                p.status == DownloadManager.STATUS_FAILED
            ) break
            delay(1000)
        }
    }

    val ready = meta.done && fileOk
    Row(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ViddCard)
            .clickable(enabled = ready, onClick = onPlay)
            .padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(130.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp))) {
            ViddImage(meta.image, meta.title, Modifier.fillMaxWidth())
            if (ready) {
                Icon(
                    Icons.Filled.PlayArrow, null, tint = Color.White,
                    modifier = Modifier.align(Alignment.Center)
                        .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(15.dp))
                        .padding(4.dp),
                )
            }
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(
                meta.title, color = Color.White, fontSize = 14.sp,
                fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(4.dp))
            if (ready) {
                val size = try { Down.localFile(ctx, meta)?.length() ?: meta.size } catch (_: Exception) { meta.size }
                Text(
                    "✅ Ready • ${Formatter.formatShortFileSize(ctx, size)}",
                    color = ViddGreen, fontSize = 12.sp,
                )
            } else if (frac == null) {
                Text("⏳ Shuru ho raha…", color = ViddGray, fontSize = 12.sp)
            } else {
                LinearProgressIndicator(
                    progress = frac ?: 0f,
                    color = ViddRed, trackColor = Color.DarkGray,
                    modifier = Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)),
                )
                Text("${((frac ?: 0f) * 100).toInt()}% download ho raha…", color = ViddGray, fontSize = 11.sp)
            }
        }
        IconButton(onClick = onDelete) {
            Icon(Icons.Filled.Delete, "Delete", tint = ViddGray)
        }
    }
}
