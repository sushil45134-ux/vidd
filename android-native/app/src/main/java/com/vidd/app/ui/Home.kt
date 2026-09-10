package com.vidd.app.ui

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
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vidd.app.data.Movie
import com.vidd.app.data.Repo
import com.vidd.app.data.Store
import com.vidd.app.data.matchCategory
import com.vidd.app.data.resolveCustomRow
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun HomeScreen(onDetails: (Long) -> Unit, onPlay: (Long) -> Unit) {
    val st by Repo.state.collectAsStateWithLifecycle()
    val myIds by Store.myList.collectAsStateWithLifecycle(initialValue = emptySet())

    LaunchedEffect(Unit) { Repo.refresh() }

    Scaffold(topBar = { ViddTopBar(onRefresh = { refreshNow() }) }, containerColor = Color.Black) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            when {
                st.loading && st.display.isEmpty() -> LoadingFull("Videos load ho rahe hain…")
                st.error != null && st.display.isEmpty() ->
                    ErrorState(st.error!!) { refreshNow() }
                st.display.isEmpty() ->
                    EmptyState("🎬", "Abhi koi video nahi", "Website se video add karo, yahaan dikhega.")
                else -> {
                    val myMovies = myIds.mapNotNull { Repo.byId(it.toLongOrNull() ?: -1) }
                    LazyColumn(Modifier.fillMaxSize()) {
                        item { HeroPager(st.heroes, onPlay, onDetails) }

                        // Admin ke custom rows (website jaisa order)
                        st.customRows.filter { it.visible && (it.section == "home" || it.section == "all") }
                            .forEach { row ->
                                val items = resolveCustomRow(row, st.display)
                                if (items.isNotEmpty()) {
                                    item {
                                        SectionRow(row.title, items, row.isLarge, onDetails, onPlay)
                                    }
                                }
                            }

                        // Auto rows
                        val fresh = st.display.sortedByDescending { it.createdAt }.take(12)
                        item { SectionRow("🔥 New & Popular", fresh, true, onDetails, onPlay) }

                        if (myMovies.isNotEmpty()) {
                            item { SectionRow("❤️ My List", myMovies, false, onDetails, onPlay) }
                        }
                        val series = st.display.filter { it.isCollection }
                        if (series.isNotEmpty()) {
                            item { SectionRow("📺 Series & Playlists", series, true, onDetails, onPlay) }
                        }
                        val anime = st.display.filter { matchCategory("anime", it) }
                        if (anime.isNotEmpty()) {
                            item { SectionRow("⛩️ Anime", anime, false, onDetails, onPlay) }
                        }
                        val cartoon = st.display.filter { matchCategory("cartoon", it) }
                        if (cartoon.isNotEmpty()) {
                            item { SectionRow("🐭 Cartoon", cartoon, false, onDetails, onPlay) }
                        }
                        val top = st.display.filter { it.match >= 95 }.take(12)
                        if (top.isNotEmpty()) {
                            item { SectionRow("⭐ Top Rated", top, false, onDetails, onPlay) }
                        }
                        item { Spacer(Modifier.height(80.dp)) }
                    }
                }
            }
        }
    }
}

private fun refreshNow() {
    kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Main).launch {
        Repo.refresh(force = true)
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun HeroPager(
    movies: List<Movie>,
    onPlay: (Long) -> Unit,
    onDetails: (Long) -> Unit,
) {
    if (movies.isEmpty()) return
    val pager = rememberPagerState(pageCount = { movies.size })

    // Auto-slide har 5 second me
    LaunchedEffect(movies.size) {
        while (true) {
            delay(5000)
            val next = (pager.currentPage + 1) % movies.size
            try { pager.animateScrollToPage(next) } catch (_: Exception) { }
        }
    }

    HorizontalPager(state = pager, modifier = Modifier.fillMaxWidth().aspectRatio(16f / 10f)) { page ->
        val m = movies[page % movies.size]
        Box(Modifier.fillMaxSize().clickable { onDetails(m.id) }) {
            ViddImage(m.backdrop, m.title, Modifier.fillMaxSize())
            // Neeche kaala gradient taaki text saaf dikhe
            Box(
                Modifier.fillMaxSize().background(
                    Brush.verticalGradient(
                        listOf(Color.Transparent, Color.Transparent, Color.Black.copy(alpha = 0.9f), Color.Black)
                    )
                )
            )
            Column(
                Modifier.align(Alignment.BottomStart).padding(16.dp).fillMaxWidth()
            ) {
                Text("⭐ FEATURED", color = ViddRed, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                Text(
                    m.title, color = Color.White, fontSize = 24.sp,
                    fontWeight = FontWeight.Black, maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (m.description.isNotEmpty()) {
                    Text(
                        m.description, color = Color(0xFFDDDDDD), fontSize = 12.sp,
                        maxLines = 2, overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(
                        onClick = { onPlay(m.playable.id) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                        shape = RoundedCornerShape(6.dp),
                    ) {
                        Icon(Icons.Filled.PlayArrow, null, tint = Color.Black)
                        Spacer(Modifier.width(4.dp))
                        Text("Play", color = Color.Black, fontWeight = FontWeight.Bold)
                    }
                    OutlinedButton(
                        onClick = { onDetails(m.id) },
                        shape = RoundedCornerShape(6.dp),
                    ) {
                        Icon(Icons.Filled.Info, null, tint = Color.White)
                        Spacer(Modifier.width(4.dp))
                        Text("More", color = Color.White)
                    }
                }
                // Dots
                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    repeat(movies.size) { i ->
                        Box(
                            Modifier.padding(horizontal = 3.dp)
                                .width(if (i == pager.currentPage) 18.dp else 6.dp)
                                .height(6.dp)
                                .background(
                                    if (i == pager.currentPage) ViddRed else Color.Gray,
                                    RoundedCornerShape(3.dp)
                                )
                        )
                    }
                }
            }
        }
    }
}
