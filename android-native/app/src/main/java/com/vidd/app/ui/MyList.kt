package com.vidd.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vidd.app.data.Repo
import com.vidd.app.data.Store

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MyListScreen(onDetails: (Long) -> Unit) {
    val myIds by Store.myList.collectAsStateWithLifecycle(initialValue = emptySet())
    val st by Repo.state.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { Repo.refresh() }

    val movies = myIds.mapNotNull { Repo.byId(it.toLongOrNull() ?: -1) }

    Scaffold(topBar = { ViddTopBar("My List") }, containerColor = Color.Black) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            when {
                st.loading && st.display.isEmpty() -> LoadingFull()
                movies.isEmpty() -> EmptyState(
                    "❤️", "List khaali hai",
                    "Kisi video par + My List dabao — wo yahaan save hoga."
                )
                else -> LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    contentPadding = PaddingValues(8.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(movies, key = { it.id }) { m ->
                        Box(Modifier.padding(4.dp).fillMaxWidth()) {
                            PosterCard(m, onClick = { onDetails(m.id) }, modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
            }
        }
    }
}
