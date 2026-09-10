package com.vidd.app.ui

import android.content.Intent
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vidd.app.data.DlMeta
import com.vidd.app.data.Down
import com.vidd.app.data.Movie
import com.vidd.app.data.Repo
import com.vidd.app.data.Store
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun DetailsScreen(
    id: Long,
    onBack: () -> Unit,
    onPlay: (Long) -> Unit,
    onDetails: (Long) -> Unit,
) {
    val st by Repo.state.collectAsStateWithLifecycle()
    val myIds by Store.myList.collectAsStateWithLifecycle(initialValue = emptySet())
    val likedIds by Store.liked.collectAsStateWithLifecycle(initialValue = emptySet())
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current

    LaunchedEffect(Unit) { Repo.refresh() }

    val movie = Repo.byId(id)
    when {
        movie == null && st.loading -> LoadingFull()
        movie == null -> ErrorState("Ye video nahi mila.") { onBack() }
        else -> {
            val m = movie!!
            val playable = m.playable
            val more = remember(m, st.display) {
                st.display.filter { it.id != m.id && it.genre.any { g -> m.genre.contains(g) } }.take(10)
            }
            LazyColumn(Modifier.fillMaxSize().background(Color.Black)) {
                item {
                    // Backdrop + back button
                    Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f)) {
                        ViddImage(m.backdrop, m.title, Modifier.fillMaxSize())
                        Box(
                            Modifier.fillMaxSize().background(
                                Brush.verticalGradient(
                                    listOf(Color.Black.copy(alpha = 0.5f), Color.Transparent, Color.Black)
                                )
                            )
                        )
                        IconButton(
                            onClick = onBack,
                            modifier = Modifier.align(Alignment.TopStart).padding(8.dp)
                                .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(20.dp)),
                        ) { Icon(Icons.Filled.ArrowBack, "Peeche", tint = Color.White) }
                        IconButton(
                            onClick = {
                                val send = Intent(Intent.ACTION_SEND).apply {
                                    type = "text/plain"
                                    putExtra(Intent.EXTRA_TEXT, "🎬 ${m.title} — vid app par dekho!")
                                }
                                ctx.startActivity(Intent.createChooser(send, "Share karo"))
                            },
                            modifier = Modifier.align(Alignment.TopEnd).padding(8.dp)
                                .background(Color.Black.copy(alpha = 0.5f), RoundedCornerShape(20.dp)),
                        ) { Icon(Icons.Filled.Share, "Share", tint = Color.White) }
                    }
                }
                item {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        Text(m.title, color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Black)
                        Spacer(Modifier.height(6.dp))
                        // Meta line
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("${m.match}% match", color = ViddGreen, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                            Text("${m.year}", color = ViddGray, fontSize = 13.sp)
                            Chip(m.rating)
                            if (m.duration.isNotEmpty()) Text(m.duration, color = ViddGray, fontSize = 13.sp)
                            if (m.isCollection) Chip("${m.seasons.size}S • ${m.episodes.size}EP")
                        }
                        Spacer(Modifier.height(12.dp))
                        // Play button
                        Button(
                            onClick = { onPlay(playable.id) },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                            shape = RoundedCornerShape(6.dp),
                        ) {
                            Icon(Icons.Filled.PlayArrow, null, tint = Color.Black)
                            Spacer(Modifier.width(6.dp))
                            Text("Play", color = Color.Black, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        }
                        Spacer(Modifier.height(8.dp))
                        // My List / Like / Download
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                            val inList = myIds.contains(m.id.toString())
                            ActionBtn(
                                icon = { Icon(if (inList) Icons.Filled.Check else Icons.Filled.Add, null, tint = Color.White) },
                                label = "My List",
                                onClick = { scope.launch { Store.toggleMyList(m.id) } },
                            )
                            val liked = likedIds.contains(m.id.toString())
                            ActionBtn(
                                icon = {
                                    Icon(
                                        if (liked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                                        null, tint = if (liked) ViddRed else Color.White,
                                    )
                                },
                                label = "Like",
                                onClick = { scope.launch { Store.toggleLiked(m.id) } },
                            )
                            if (!m.isCollection && m.isDownloadable) {
                                DownloadActionBtn(m)
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Text(m.description.ifEmpty { "Description nahi di gayi hai." }, color = Color(0xFFDDDDDD), fontSize = 14.sp)
                        Spacer(Modifier.height(8.dp))
                        if (m.cast.isNotEmpty()) {
                            Text("Cast: ${m.cast.joinToString(", ")}", color = ViddGray, fontSize = 12.sp)
                        }
                        if (m.creator != null) {
                            Text("Creator: ${m.creator}", color = ViddGray, fontSize = 12.sp)
                        }
                        Spacer(Modifier.height(8.dp))
                        GenreChips(m.genre)
                        Spacer(Modifier.height(8.dp))
                    }
                }

                // Episodes (series ho to)
                if (m.isCollection && m.seasons.isNotEmpty()) {
                    item { EpisodesBlock(m, onPlay) }
                }

                // More like this
                if (more.isNotEmpty()) {
                    item { SectionRow("More Like This", more, false, onDetails, onPlay) }
                }
                item { Spacer(Modifier.height(80.dp)) }
            }
        }
    }
}

@Composable
private fun ActionBtn(icon: @Composable () -> Unit, label: String, onClick: () -> Unit) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable(onClick = onClick).padding(8.dp),
    ) {
        icon()
        Text(label, color = ViddGray, fontSize = 11.sp)
    }
}

/** Download button + progress (details + episode dono jagah). */
@Composable
fun DownloadActionBtn(movie: Movie) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val dls by Store.downloads.collectAsStateWithLifecycle(initialValue = emptyMap())
    val meta = dls[movie.id.toString()]

    // Chalti download ka progress har second update karo
    val prog by produceState<Double?>(null, meta) {
        while (meta != null && !meta.done) {
            val p = try { Down.progress(ctx, meta.dmId) } catch (_: Exception) { null }
            value = p?.fraction?.toDouble()
            if (p == null) break
            delay(1000)
        }
    }

    when {
        meta != null && meta.done && Down.localFile(ctx, meta) != null -> {
            ActionBtn(
                icon = { Icon(Icons.Filled.Check, null, tint = ViddGreen) },
                label = "Downloaded",
                onClick = {
                    scope.launch {
                        Down.cancel(ctx, meta.dmId)
                        try { Down.localFile(ctx, meta)?.delete() } catch (_: Exception) { }
                        Store.removeDownload(movie.id)
                    }
                },
            )
        }
        meta != null -> {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(8.dp)) {
                if (prog == null) CircularProgressIndicator(color = ViddRed, modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                else Text("${((prog ?: 0.0) * 100).toInt()}%", color = ViddRed, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text("Cancel", color = ViddGray, fontSize = 11.sp, modifier = Modifier.clickable {
                    scope.launch {
                        Down.cancel(ctx, meta.dmId)
                        Store.removeDownload(movie.id)
                    }
                })
            }
        }
        else -> {
            ActionBtn(
                icon = { Icon(Icons.Filled.Download, null, tint = Color.White) },
                label = "Download",
                onClick = {
                    scope.launch {
                        val dmId = Down.enqueue(ctx, movie)
                        if (dmId > 0) {
                            Store.putDownload(
                                DlMeta(movie.id, movie.title, movie.image, Down.fileNameFor(movie), dmId, false)
                            )
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun EpisodesBlock(m: Movie, onPlay: (Long) -> Unit) {
    var seasonIdx by remember { mutableIntStateOf(0) }
    val seasons = m.seasons
    val cur = seasons.getOrElse(seasonIdx) { seasons.first() }

    Text(
        "Episodes", color = Color.White, fontSize = 18.sp,
        fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 16.dp, top = 8.dp),
    )
    if (seasons.size > 1) {
        ScrollableTabRow(
            selectedTabIndex = seasonIdx,
            containerColor = Color.Black,
            contentColor = Color.White,
            edgePadding = 16.dp,
        ) {
            seasons.forEachIndexed { i, s ->
                Tab(
                    selected = seasonIdx == i,
                    onClick = { seasonIdx = i },
                    text = { Text("Season ${s.seasonNumber}", color = Color.White, fontSize = 13.sp) },
                )
            }
        }
    }
    Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        cur.episodes.forEach { ep ->
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(ViddCard)
                    .clickable { onPlay(ep.id) }
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.width(140.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp))) {
                    ViddImage(ep.image, ep.title, Modifier.fillMaxSize())
                    Icon(
                        Icons.Filled.PlayArrow, null, tint = Color.White,
                        modifier = Modifier.align(Alignment.Center).size(30.dp)
                            .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(15.dp))
                            .padding(4.dp),
                    )
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        "E${ep.episodeNumber ?: ""} • ${ep.title}",
                        color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                    if (ep.duration.isNotEmpty()) {
                        Text(ep.duration, color = ViddGray, fontSize = 11.sp)
                    }
                }
                if (ep.isDownloadable) {
                    DownloadActionBtn(ep)
                }
            }
        }
    }
}
