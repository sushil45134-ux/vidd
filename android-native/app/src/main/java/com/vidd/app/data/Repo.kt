package com.vidd.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext

/** Poori library ka state — saari screens yahi se data lengi. */
data class LibState(
    val loading: Boolean = true,
    val error: String? = null,
    val uploaded: List<Movie> = emptyList(),
    val synced: List<Movie> = emptyList(),
    val collections: List<Movie> = emptyList(),
    val display: List<Movie> = emptyList(),
    val heroes: List<Movie> = emptyList(),
    val customRows: List<CustomRow> = emptyList(),
)

object Repo {

    private val _state = MutableStateFlow(LibState())
    val state: StateFlow<LibState> = _state

    private var loadedOnce = false

    /** Supabase se sab kuch ek saath lao. */
    suspend fun refresh(force: Boolean = false) = withContext(Dispatchers.IO) {
        if (loadedOnce && !force && !_state.value.loading) return@withContext
        if (_state.value.display.isEmpty()) {
            _state.value = _state.value.copy(loading = true, error = null)
        }
        try {
            val (moviesJson, heroesJson, configJson, coversJson) = supervisorScope {
                val a = async { Supa.api.movies() }
                val b = async {
                    try { Supa.api.heroBanners() } catch (_: Exception) { "[]" }
                }
                val c = async {
                    try { Supa.api.siteConfig() } catch (_: Exception) { "[]" }
                }
                val d = async {
                    try { Supa.api.collectionCovers() } catch (_: Exception) { "[]" }
                }
                Quad(a.await(), b.await(), c.await(), d.await())
            }

            val all = parseMoviesJson(moviesJson)
            val uploaded = all.filter { it.sourceType != "synced" }
            val synced = all.filter { it.sourceType == "synced" }
            val covers = try { parseCoversJson(coversJson) } catch (_: Exception) { emptyMap() }
            val collections = groupCollections(synced, covers)
            val display = uploaded + collections
            val heroes = try {
                resolveHeroes(parseHeroesJson(heroesJson), display)
            } catch (_: Exception) { display.take(5) }
            val customRows = try { parseConfigJson(configJson) } catch (_: Exception) { emptyList() }

            loadedOnce = true
            _state.value = LibState(
                loading = false,
                uploaded = uploaded,
                synced = synced,
                collections = collections,
                display = display,
                heroes = heroes,
                customRows = customRows,
            )
        } catch (e: Exception) {
            _state.value = _state.value.copy(
                loading = false,
                error = if (_state.value.display.isEmpty()) {
                    "Internet nahi lag raha. Connection check karke dobara try karo."
                } else null,
            )
        }
    }

    /** Koi bhi movie/episode dhoondo — details/player screen ke liye. */
    fun byId(id: Long): Movie? {
        val st = _state.value
        st.display.firstOrNull { it.id == id }?.let { return it }
        st.display.forEach { m ->
            m.episodes.firstOrNull { it.id == id }?.let { return it }
        }
        (st.uploaded + st.synced).firstOrNull { it.id == id }?.let { return it }
        return null
    }

    /** Ek playlist ke saare episodes (next/prev ke liye), season+episode order me. */
    fun siblingsOf(playlistId: String): List<Movie> =
        _state.value.synced.filter { it.playlistId == playlistId }
            .sortedWith(compareBy({ it.seasonNumber ?: 1 }, { it.episodeNumber ?: 0 }))

    private data class Quad<A, B, C, D>(val a: A, val b: B, val c: C, val d: D)
}
