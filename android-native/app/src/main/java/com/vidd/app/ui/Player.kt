package com.vidd.app.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.net.Uri
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebViewClient
import android.webkit.WebView
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.vidd.app.data.Down
import com.vidd.app.data.Movie
import com.vidd.app.data.Repo
import com.vidd.app.data.Store

@Composable
fun PlayerScreen(id: Long, onBack: () -> Unit, onEpisode: (Long) -> Unit) {
    val ctx = LocalContext.current
    val activity = ctx as? Activity
    val dls by Store.downloads.collectAsStateWithLifecycle(initialValue = emptyMap())
    val landscape =
        LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE

    // Screen se hatne par rotation normal karo
    DisposableEffect(Unit) {
        onDispose {
            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        }
    }
    // Back: landscape me pehle portrait, warna wapas
    BackHandler {
        if (landscape) activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        else onBack()
    }

    val movie = Repo.byId(id)
    if (movie == null) {
        ErrorState("Video nahi mila.") { onBack() }
        return
    }

    // Offline file sabse pehle (bina internet ke bhi chalegi)
    val local = dls[id.toString()]?.let { Down.localFile(ctx, it) }

    val siblings = remember(movie) {
        movie.playlistId?.let { Repo.siblingsOf(it) } ?: emptyList()
    }
    val idx = siblings.indexOfFirst { it.id == id }
    val prev = if (idx > 0) siblings[idx - 1] else null
    val next = if (idx >= 0 && idx < siblings.lastIndex) siblings[idx + 1] else null

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (landscape) {
            // Poori screen sirf player
            PlayerBox(movie, local?.let { Uri.fromFile(it).toString() }, Modifier.fillMaxSize())
        } else {
            LazyColumn(Modifier.fillMaxSize()) {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconButton(onClick = onBack) {
                            Icon(Icons.Filled.ArrowBack, "Band karo", tint = Color.White)
                        }
                        Text(
                            movie.title, color = Color.White, fontSize = 15.sp,
                            fontWeight = FontWeight.Bold, maxLines = 1,
                            overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = {
                            activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                        }) { Icon(Icons.Filled.Fullscreen, "Fullscreen", tint = Color.White) }
                    }
                }
                item {
                    PlayerBox(movie, local?.let { Uri.fromFile(it).toString() }, Modifier.fillMaxWidth().aspectRatio(16f / 9f))
                }
                // Prev / Next
                if (prev != null || next != null) {
                    item {
                        Row(
                            Modifier.fillMaxWidth().padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceEvenly,
                        ) {
                            Button(
                                onClick = { prev?.let { onEpisode(it.id) } },
                                enabled = prev != null,
                                colors = ButtonDefaults.buttonColors(containerColor = ViddCard),
                            ) {
                                Icon(Icons.Filled.SkipPrevious, null, tint = Color.White)
                                Spacer(Modifier.width(4.dp))
                                Text("Prev", color = Color.White)
                            }
                            Button(
                                onClick = { next?.let { onEpisode(it.id) } },
                                enabled = next != null,
                                colors = ButtonDefaults.buttonColors(containerColor = ViddRed),
                            ) {
                                Text("Next", color = Color.White)
                                Spacer(Modifier.width(4.dp))
                                Icon(Icons.Filled.SkipNext, null, tint = Color.White)
                            }
                        }
                    }
                }
                item {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        if (local != null) Chip("⬇ OFFLINE PLAY")
                        Spacer(Modifier.height(6.dp))
                        if (movie.description.isNotEmpty()) {
                            Text(movie.description, color = Color(0xFFDDDDDD), fontSize = 13.sp)
                            Spacer(Modifier.height(8.dp))
                        }
                        GenreChips(movie.genre)
                    }
                }
                // Up next
                if (siblings.size > 1) {
                    item {
                        Text(
                            "Up Next (${siblings.size} episodes)", color = Color.White,
                            fontSize = 16.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 8.dp),
                        )
                    }
                    itemsIndexed(siblings, key = { _, e -> e.id }) { _, ep ->
                        val current = ep.id == id
                        Row(
                            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (current) ViddRed.copy(alpha = 0.2f) else ViddCard)
                                .clickable { if (!current) onEpisode(ep.id) }
                                .padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.width(120.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(6.dp))) {
                                ViddImage(ep.image, ep.title, Modifier.fillMaxSize())
                                if (current) {
                                    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.5f)))
                                    Icon(Icons.Filled.PlayArrow, null, tint = ViddRed, modifier = Modifier.align(Alignment.Center).size(28.dp))
                                }
                            }
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(
                                    "E${ep.episodeNumber ?: ""} • ${ep.title}", color = Color.White,
                                    fontSize = 13.sp, fontWeight = FontWeight.Medium,
                                    maxLines = 2, overflow = TextOverflow.Ellipsis,
                                )
                                if (ep.duration.isNotEmpty()) Text(ep.duration, color = ViddGray, fontSize = 11.sp)
                            }
                        }
                    }
                }
                item { Spacer(Modifier.height(40.dp)) }
            }
        }
    }
}

/** Sahi player chuno: offline file → YouTube → direct video → embed. */
@Composable
private fun PlayerBox(movie: Movie, localUri: String?, modifier: Modifier) {
    when {
        localUri != null -> ExoScreen(localUri, modifier)
        movie.youtubeId != null -> YtScreen(movie.youtubeId!!, modifier)
        movie.isDirectVideo && movie.videoUrl != null -> ExoScreen(movie.videoUrl!!, modifier)
        movie.embedUrl != null -> EmbedScreen(movie, modifier)
        else -> NoSourceBox(movie, modifier)
    }
}

@Composable
private fun ExoScreen(url: String, modifier: Modifier) {
    val ctx = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val exo = remember(url) {
        ExoPlayer.Builder(ctx).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            prepare()
            playWhenReady = true
        }
    }
    // App peeche jaye to pause, wapas aaye to play
    DisposableEffect(lifecycle, exo) {
        val obs = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_PAUSE -> exo.pause()
                Lifecycle.Event.ON_RESUME -> exo.play()
                else -> {}
            }
        }
        lifecycle.addObserver(obs)
        onDispose {
            runCatching { lifecycle.removeObserver(obs) }
            runCatching { exo.stop(); exo.release() }
        }
    }
    AndroidView(
        factory = { c -> PlayerView(c).apply { player = exo; useController = true } },
        modifier = modifier.background(Color.Black),
    )
}

/** YouTube video — seedha YouTube ka apna embed page (WebView me browser jaisa). */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun YtScreen(videoId: String, modifier: Modifier) {
    val ctx = LocalContext.current
    // Custom HTML + IFrame API ke bajaye YouTube ka official embed URL seedha
    // load karo — WebView use browser ki tarah chalata hai. Yeh sabse pakka
    // tareeka hai: na height ka issue, na origin/postMessage ka.
    val embedUrl = remember(videoId) {
        "https://www.youtube-nocookie.com/embed/$videoId" +
            "?autoplay=1&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3" +
            "&origin=https%3A%2F%2Fwww.youtube.com"
    }
    var loadError by remember(videoId) { mutableStateOf(false) }
    var webRef by remember { mutableStateOf<WebView?>(null) }
    var loadedFor by remember { mutableStateOf<String?>(null) }

    Box(modifier.background(Color.Black)) {
        AndroidView(
            factory = { c ->
                WebView(c).apply {
                    webRef = this
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.mediaPlaybackRequiresUserGesture = false
                    settings.loadWithOverviewMode = true
                    settings.useWideViewPort = true
                    webChromeClient = WebChromeClient()
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest
                        ): Boolean {
                            val host = request.url.host ?: return false
                            val internal = host.endsWith("youtube.com") ||
                                host.endsWith("youtube-nocookie.com") ||
                                host.endsWith("ytimg.com") ||
                                host.endsWith("googlevideo.com") ||
                                host.endsWith("googleapis.com") ||
                                host.endsWith("gstatic.com") ||
                                host.endsWith("googleusercontent.com") ||
                                host.endsWith("ggpht.com") ||
                                host.endsWith("google.com")
                            if (internal) return false // player ke andar hi khule
                            // Baaki bahar ke links browser me bhejo
                            runCatching {
                                ctx.startActivity(Intent(Intent.ACTION_VIEW, request.url))
                            }
                            return true
                        }

                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            error: android.webkit.WebResourceError
                        ) {
                            // Sirf main page fail ho to error dikhao (ads/images
                            // ka fail ignore karo)
                            if (request.isForMainFrame) loadError = true
                        }
                    }
                    loadedFor = embedUrl
                    loadUrl(embedUrl)
                }
            },
            update = { wv ->
                // Episode badle to naya video load karo
                if (loadedFor != embedUrl) {
                    loadedFor = embedUrl
                    loadError = false
                    wv.loadUrl(embedUrl)
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        if (loadError) {
            PlayerWebError(
                onRetry = {
                    loadError = false
                    webRef?.loadUrl(embedUrl)
                },
                onOpenBrowser = {
                    runCatching {
                        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(embedUrl)))
                    }
                },
            )
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun EmbedScreen(movie: Movie, modifier: Modifier) {
    val ctx = LocalContext.current
    // Embed ka apna URL seedha load karo (apne origin se) — Dailymotion,
    // BitChute, Streamable sab apne embed page ke liye design kiye hote hain.
    val embedUrl = remember(movie.embedUrl) {
        movie.embedUrl?.replaceFirst("http://", "https://") ?: ""
    }
    val allowedHost = remember(embedUrl) {
        runCatching { Uri.parse(embedUrl).host }.getOrNull()
    }
    var loadError by remember(embedUrl) { mutableStateOf(false) }
    var webRef by remember { mutableStateOf<WebView?>(null) }
    var loadedFor by remember { mutableStateOf<String?>(null) }

    Box(modifier.background(Color.Black)) {
        AndroidView(
            factory = { c ->
                WebView(c).apply {
                    webRef = this
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.mediaPlaybackRequiresUserGesture = false
                    webChromeClient = WebChromeClient()
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView,
                            request: WebResourceRequest
                        ): Boolean {
                            val host = request.url.host ?: return false
                            val internal = allowedHost != null &&
                                (host.equals(allowedHost, ignoreCase = true) ||
                                    host.endsWith(".$allowedHost", ignoreCase = true))
                            if (internal) return false
                            runCatching {
                                ctx.startActivity(Intent(Intent.ACTION_VIEW, request.url))
                            }
                            return true
                        }

                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            error: android.webkit.WebResourceError
                        ) {
                            if (request.isForMainFrame) loadError = true
                        }
                    }
                    loadedFor = embedUrl
                    loadUrl(embedUrl)
                }
            },
            update = { wv ->
                if (loadedFor != embedUrl && embedUrl.isNotEmpty()) {
                    loadedFor = embedUrl
                    loadError = false
                    wv.loadUrl(embedUrl)
                }
            },
            modifier = Modifier.fillMaxSize(),
        )

        if (loadError) {
            PlayerWebError(
                onRetry = {
                    loadError = false
                    webRef?.loadUrl(embedUrl)
                },
                onOpenBrowser = {
                    runCatching {
                        ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(embedUrl)))
                    }
                },
            )
        }
    }
}

/** WebView load fail ho to retry / browser me kholo. */
@Composable
private fun PlayerWebError(onRetry: () -> Unit, onOpenBrowser: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Color.Black).padding(16.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("😕", fontSize = 40.sp)
        Spacer(Modifier.height(8.dp))
        Text("Video load nahi hua", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text("Internet check karke dobara try karo", color = ViddGray, fontSize = 12.sp)
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = onRetry,
            colors = ButtonDefaults.buttonColors(containerColor = ViddRed),
        ) {
            Icon(Icons.Filled.PlayArrow, null, tint = Color.White)
            Spacer(Modifier.width(6.dp))
            Text("Dobara Try Karo", color = Color.White)
        }
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = onOpenBrowser,
            colors = ButtonDefaults.buttonColors(containerColor = ViddCard),
        ) {
            Icon(Icons.Filled.OpenInNew, null, tint = Color.White)
            Spacer(Modifier.width(6.dp))
            Text("Browser Me Kholo", color = Color.White)
        }
    }
}

@Composable
private fun NoSourceBox(movie: Movie, modifier: Modifier) {
    val ctx = LocalContext.current
    Column(
        modifier.background(Color.Black),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("😕", fontSize = 40.sp)
        Text("Is video ka source nahi mila", color = Color.White, fontSize = 14.sp)
        if (movie.embedUrl != null) {
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = {
                    ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(movie.embedUrl)))
                },
                colors = ButtonDefaults.buttonColors(containerColor = ViddRed),
            ) {
                Icon(Icons.Filled.OpenInNew, null, tint = Color.White)
                Spacer(Modifier.width(6.dp))
                Text("Browser Me Kholo", color = Color.White)
            }
        }
    }
}
