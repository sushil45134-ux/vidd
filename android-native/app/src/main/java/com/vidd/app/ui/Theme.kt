package com.vidd.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val ViddRed = Color(0xFFE50914)
val ViddGreen = Color(0xFF46D369)
val ViddGray = Color(0xFF9E9E9E)
val ViddCard = Color(0xFF1C1C1C)

private val Scheme = darkColorScheme(
    primary = ViddRed,
    onPrimary = Color.White,
    secondary = ViddRed,
    background = Color.Black,
    onBackground = Color.White,
    surface = Color(0xFF121212),
    onSurface = Color.White,
    surfaceVariant = ViddCard,
    onSurfaceVariant = Color.White,
)

@Composable
fun ViddTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Scheme, content = content)
}
