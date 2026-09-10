package com.vidd.app.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.sp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val TABS = listOf(
    Tab("home", "Home", Icons.Filled.Home),
    Tab("browse", "Browse", Icons.Filled.Movie),
    Tab("search", "Search", Icons.Filled.Search),
    Tab("mylist", "My List", Icons.Filled.Bookmark),
    Tab("downloads", "Downloads", Icons.Filled.Download),
)

@Composable
fun ViddNav() {
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route ?: "home"
    val showBar = !route.startsWith("player")

    Scaffold(
        containerColor = Color.Black,
        bottomBar = {
            if (showBar) {
                NavigationBar(containerColor = Color(0xFF0A0A0A)) {
                    TABS.forEach { t ->
                        val selected = route == t.route ||
                            (t.route == "home" && route.startsWith("details"))
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                nav.navigate(t.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(t.icon, t.label) },
                            label = { Text(t.label, fontSize = 10.sp) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = ViddRed,
                                selectedTextColor = Color.White,
                                unselectedIconColor = ViddGray,
                                unselectedTextColor = ViddGray,
                                indicatorColor = Color.Transparent,
                            ),
                        )
                    }
                }
            }
        },
    ) { pad ->
        NavHost(nav, startDestination = "home", Modifier.padding(pad)) {
            composable("home") {
                HomeScreen(
                    onDetails = { nav.navigate("details/$it") },
                    onPlay = { nav.navigate("player/$it") },
                )
            }
            composable("browse") {
                BrowseScreen(onDetails = { nav.navigate("details/$it") })
            }
            composable("search") {
                SearchScreen(onDetails = { nav.navigate("details/$it") })
            }
            composable("mylist") {
                MyListScreen(onDetails = { nav.navigate("details/$it") })
            }
            composable("downloads") {
                DownloadsScreen(onPlay = { nav.navigate("player/$it") })
            }
            composable(
                "details/{id}",
                arguments = listOf(navArgument("id") { type = NavType.LongType }),
            ) { back ->
                val id = back.arguments?.getLong("id") ?: -1
                DetailsScreen(
                    id = id,
                    onBack = { nav.popBackStack() },
                    onPlay = { nav.navigate("player/$it") },
                    onDetails = { nav.navigate("details/$it") },
                )
            }
            composable(
                "player/{id}",
                arguments = listOf(navArgument("id") { type = NavType.LongType }),
            ) { back ->
                val id = back.arguments?.getLong("id") ?: -1
                PlayerScreen(
                    id = id,
                    onBack = { nav.popBackStack() },
                    onEpisode = { next ->
                        // Next/Prev par purana player hatao, naya kholo
                        nav.navigate("player/$next") {
                            popUpTo("player/$id") { inclusive = true }
                        }
                    },
                )
            }
        }
    }
}
