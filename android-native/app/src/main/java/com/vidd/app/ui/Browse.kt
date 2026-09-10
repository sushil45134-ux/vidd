package com.vidd.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vidd.app.data.Repo
import com.vidd.app.data.matchCategory

private val TABS = listOf(
    "movies" to "Movies",
    "anime" to "Anime",
    "cartoon" to "Cartoon",
    "tvshows" to "TV Shows",
    "new" to "New",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrowseScreen(onDetails: (Long) -> Unit) {
    val st by Repo.state.collectAsStateWithLifecycle()
    var tab by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { Repo.refresh() }

    Scaffold(topBar = { ViddTopBar() }, containerColor = Color.Black) { pad ->
        Column(Modifier.fillMaxSize().padding(pad)) {
            TabRow(
                selectedTabIndex = tab,
                containerColor = Color.Black,
                contentColor = Color.White,
            ) {
                TABS.forEachIndexed { i, (_, label) ->
                    Tab(
                        selected = tab == i,
                        onClick = { tab = i },
                        text = { Text(label, fontSize = 12.sp, color = Color.White) },
                    )
                }
            }
            val list = st.display.filter { matchCategory(TABS[tab].first, it) }
            when {
                st.loading && st.display.isEmpty() -> LoadingFull()
                list.isEmpty() -> EmptyState("📭", "Kuch nahi mila", "Is category me abhi koi video nahi hai.")
                else -> LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    contentPadding = PaddingValues(8.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(list, key = { it.id }) { m ->
                        Box(Modifier.padding(4.dp).fillMaxWidth()) {
                            PosterCard(m, onClick = { onDetails(m.id) }, modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
            }
        }
    }
}
