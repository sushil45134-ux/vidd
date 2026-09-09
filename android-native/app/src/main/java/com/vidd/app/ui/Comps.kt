package com.vidd.app.ui

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.vidd.app.data.Movie

// ---------------------------------------------------------------------------
// Image — normal URL + data: URL (hero banners) dono chalti hai
// ---------------------------------------------------------------------------

private fun decodeDataUrl(url: String): android.graphics.Bitmap? {
    return try {
        if (!url.startsWith("data:")) return null
        val base64 = url.substringAfter(",", "")
        if (base64.isEmpty()) return null
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (_: Exception) { null }
}

@Composable
fun ViddImage(
    url: String,
    desc: String?,
    modifier: Modifier = Modifier,
    scale: ContentScale = ContentScale.Crop,
) {
    Box(modifier.background(Color(0xFF1C1C1C))) {
        if (url.startsWith("data:")) {
            val bmp = remember(url) { decodeDataUrl(url) }
            if (bmp != null) {
                Image(
                    bitmap = bmp.asImageBitmap(),
                    contentDescription = desc,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = scale,
                )
            }
        } else {
            AsyncImage(
                model = url,
                contentDescription = desc,
                modifier = Modifier.fillMaxSize(),
                contentScale = scale,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Cards & rows
// ---------------------------------------------------------------------------

@Composable
fun PosterCard(
    movie: Movie,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.clickable(onClick = onClick)) {
        ViddImage(
            url = movie.image,
            desc = movie.title,
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(8.dp)),
        )
        Text(
            text = movie.title,
            color = Color.White,
            fontSize = 12.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

@Composable
fun BackdropCard(
    movie: Movie,
    onClick: () -> Unit,
    onPlay: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.width(240.dp).clickable(onClick = onClick)) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .clip(RoundedCornerShape(8.dp))
        ) {
            ViddImage(url = movie.backdrop, desc = movie.title, modifier = Modifier.fillMaxSize())
            IconButton(
                onClick = onPlay,
                modifier = Modifier
                    .align(Alignment.Center)
                    .size(48.dp)
                    .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(24.dp)),
            ) {
                Icon(Icons.Filled.PlayArrow, "Play", tint = Color.White, modifier = Modifier.size(30.dp))
            }
            if (movie.isCollection) {
                Text(
                    text = "${movie.episodes.size} EP",
                    color = Color.White,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(6.dp)
                        .background(ViddRed, RoundedCornerShape(4.dp))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }
        Text(
            text = movie.title,
            color = Color.White,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

@Composable
fun SectionRow(
    title: String,
    movies: List<Movie>,
    large: Boolean,
    onDetails: (Long) -> Unit,
    onPlay: (Long) -> Unit,
) {
    if (movies.isEmpty()) return
    Text(
        text = title,
        color = Color.White,
        fontSize = 18.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.padding(start = 12.dp, top = 16.dp, bottom = 8.dp),
    )
    LazyRow(
        contentPadding = PaddingValues(horizontal = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items(movies, key = { it.id }) { m ->
            if (large) {
                BackdropCard(m, onClick = { onDetails(m.id) }, onPlay = { onPlay(m.playable.id) })
            } else {
                PosterCard(m, onClick = { onDetails(m.id) })
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Top bar, states
// ---------------------------------------------------------------------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ViddTopBar(title: String = "vid", onRefresh: (() -> Unit)? = null) {
    TopAppBar(
        title = {
            Text(title, color = ViddRed, fontWeight = FontWeight.Black, fontSize = 24.sp)
        },
        actions = {
            if (onRefresh != null) {
                IconButton(onClick = onRefresh) {
                    Icon(Icons.Filled.Refresh, "Refresh", tint = Color.White)
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.Black),
    )
}

@Composable
fun LoadingFull(text: String = "Loading…") {
    Column(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = ViddRed)
        Spacer(Modifier.height(12.dp))
        Text(text, color = ViddGray, fontSize = 14.sp)
    }
}

@Composable
fun ErrorState(message: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("😕", fontSize = 48.sp)
        Spacer(Modifier.height(12.dp))
        Text(
            message, color = Color.White, fontSize = 15.sp,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = onRetry,
            colors = ButtonDefaults.buttonColors(containerColor = ViddRed),
        ) { Text("Dobara Try Karo") }
    }
}

@Composable
fun EmptyState(emoji: String, title: String, sub: String) {
    Column(
        modifier = Modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(emoji, fontSize = 48.sp)
        Spacer(Modifier.height(12.dp))
        Text(title, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(sub, color = ViddGray, fontSize = 13.sp, textAlign = TextAlign.Center)
    }
}

@Composable
fun Chip(text: String) {
    Text(
        text = text,
        color = Color.White,
        fontSize = 11.sp,
        modifier = Modifier
            .background(Color.White.copy(alpha = 0.14f), RoundedCornerShape(4.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
fun GenreChips(genres: List<String>) {
    if (genres.isEmpty()) return
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        genres.take(4).forEach { Chip(it) }
    }
}
