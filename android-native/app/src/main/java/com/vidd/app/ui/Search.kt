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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vidd.app.data.Repo

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(onDetails: (Long) -> Unit) {
    val st by Repo.state.collectAsStateWithLifecycle()
    var q by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { Repo.refresh() }

    // Website jaisi search: saari videos + episodes me dhoondo
    val pool = remember(st) { st.display + st.synced }
    val results = remember(q, pool) {
        val s = q.trim().lowercase()
        if (s.isEmpty()) emptyList()
        else pool.filter { m ->
            m.title.lowercase().contains(s) ||
                m.genre.any { it.lowercase().contains(s) } ||
                m.description.lowercase().contains(s) ||
                m.cast.any { it.lowercase().contains(s) } ||
                (m.creator?.lowercase()?.contains(s) == true)
        }.distinctBy { it.id }.take(60)
    }

    Scaffold(topBar = { ViddTopBar() }, containerColor = Color.Black) { pad ->
        Column(Modifier.fillMaxSize().padding(pad)) {
            OutlinedTextField(
                value = q,
                onValueChange = { q = it },
                placeholder = { Text("Movie, show, actor… dhoondo", color = ViddGray) },
                leadingIcon = { Icon(Icons.Filled.Search, null, tint = ViddGray) },
                trailingIcon = {
                    if (q.isNotEmpty()) {
                        IconButton(onClick = { q = "" }) {
                            Icon(Icons.Filled.Close, "Saaf karo", tint = ViddGray)
                        }
                    }
                },
                singleLine = true,
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = Color.White,
                    unfocusedTextColor = Color.White,
                    focusedBorderColor = ViddRed,
                    unfocusedBorderColor = Color.DarkGray,
                    cursorColor = ViddRed,
                ),
                modifier = Modifier.fillMaxWidth().padding(12.dp),
            )
            when {
                q.trim().isEmpty() -> EmptyState("🔍", "Kya dekhna hai?", "Upar naam likho — saari library me dhoondenge.")
                results.isEmpty() -> EmptyState("😶", "Kuch nahi mila", "'$q' ke liye koi video nahi hai.")
                else -> LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    contentPadding = PaddingValues(8.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    items(results, key = { it.id }) { m ->
                        Box(Modifier.padding(4.dp).fillMaxWidth()) {
                            PosterCard(m, onClick = { onDetails(m.id) }, modifier = Modifier.fillMaxWidth())
                        }
                    }
                }
            }
        }
    }
}
