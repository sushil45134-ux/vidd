package com.vidd.app.data

import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

// ---------------------------------------------------------------------------
// Domain models — website ke Movie/Season/CustomRow ka Kotlin roop
// ---------------------------------------------------------------------------

data class Season(
    val seasonNumber: Int,
    val episodes: List<Movie>,
)

data class Movie(
    val id: Long,
    val title: String,
    val description: String,
    val image: String,
    val backdrop: String,
    val year: Int,
    val rating: String,
    val duration: String,
    val genre: List<String>,
    val match: Int,
    val cast: List<String>,
    val creator: String?,
    val videoUrl: String?,
    val youtubeId: String?,
    val embedUrl: String?,
    val embedPlatform: String?,
    val playlistId: String?,
    val playlistTitle: String?,
    val episodeNumber: Int?,
    val seasonNumber: Int?,
    val isCollection: Boolean,
    val episodes: List<Movie> = emptyList(),
    val seasons: List<Season> = emptyList(),
    val sourceType: String = "uploaded",
    val createdAt: String = "",
) {
    /** Website ke getMovieRef() jaisa unique nishan (custom rows milane ke liye). */
    val ref: String
        get() {
            val collectionPlaylistId = if (isCollection) {
                episodes.firstOrNull()?.playlistId ?: playlistId
            } else playlistId
            if (collectionPlaylistId != null) return "playlist:$collectionPlaylistId"
            if (youtubeId != null) return "youtube:$youtubeId"
            if (embedUrl != null) return "embed:$embedUrl"
            if (videoUrl != null) return "video:$videoUrl"
            return "title:${title.trim().lowercase()}:$year"
        }

    /** Collection ho to pehla episode, warna khud. */
    val playable: Movie
        get() = if (isCollection && episodes.isNotEmpty()) episodes.first() else this

    /** Seedhi video file hai jo ExoPlayer chala sake? (mp4/webm/mkv ya HLS/DASH) */
    val isDirectVideo: Boolean
        get() {
            val u = videoUrl?.lowercase()?.substringBefore("?") ?: return false
            return u.endsWith(".mp4") || u.endsWith(".webm") || u.endsWith(".mkv") ||
                u.endsWith(".mov") || u.endsWith(".m3u8") || u.endsWith(".mpd")
        }

    /** Download ho sakta hai? Sirf seedhi file wale (YouTube download nahi hota). */
    val isDownloadable: Boolean
        get() {
            val u = videoUrl?.lowercase()?.substringBefore("?") ?: return false
            return u.endsWith(".mp4") || u.endsWith(".webm") || u.endsWith(".mkv") ||
                u.endsWith(".mov")
        }
}

data class HeroBanner(
    val movieId: Long,
    val bannerImage: String,
    val title: String?,
    val description: String?,
    val badge: String?,
)

data class CustomRow(
    val id: String,
    val title: String,
    val visible: Boolean,
    val movieIds: List<Long>,
    val movieRefs: List<String>,
    val isLarge: Boolean,
    val section: String, // home | movies | anime | cartoon | tvshows | new | mylist | all
)

// ---------------------------------------------------------------------------
// JSON parsing (org.json — har field missing-safe)
// ---------------------------------------------------------------------------

private fun JSONObject.str(key: String): String? =
    if (isNull(key)) null else optString(key, null)?.takeIf { it.isNotEmpty() }

private fun JSONObject.strList(key: String): List<String> {
    if (isNull(key)) return emptyList()
    val arr = optJSONArray(key) ?: return emptyList()
    return List(arr.length()) { i -> arr.optString(i) }.filter { it.isNotEmpty() }
}

private fun fallbackImage(r: JSONObject): String {
    r.str("youtube_id")?.let { return "https://img.youtube.com/vi/$it/hqdefault.jpg" }
    val platform = r.str("embed_platform")
    val embed = r.str("embed_url")
    if (platform == "Dailymotion" && embed != null) {
        val vid = embed.substringAfter("/video/", "").substringBefore("?")
        if (vid.isNotEmpty()) return "https://www.dailymotion.com/thumbnail/video/$vid"
    }
    return "https://placehold.co/640x360/181818/777?text=Video"
}

fun JSONObject.toMovie(): Movie {
    val fallback = fallbackImage(this)
    val img = str("image") ?: str("thumbnail_url") ?: fallback
    return Movie(
        id = optLong("id"),
        title = str("title") ?: "Untitled",
        description = str("description") ?: "",
        image = img,
        backdrop = str("backdrop") ?: img,
        year = optInt("year", Calendar.getInstance().get(Calendar.YEAR)),
        rating = str("rating") ?: "TV-14",
        duration = str("duration") ?: "",
        genre = strList("genre"),
        match = optInt("match_score", 95),
        cast = strList("cast_members"),
        creator = str("creator"),
        videoUrl = str("video_url"),
        youtubeId = str("youtube_id"),
        embedUrl = str("embed_url"),
        embedPlatform = str("embed_platform"),
        playlistId = str("playlist_id"),
        playlistTitle = str("playlist_title"),
        episodeNumber = if (isNull("episode_number")) null else optInt("episode_number"),
        seasonNumber = if (isNull("season_number")) null else optInt("season_number"),
        isCollection = optBoolean("is_collection", false),
        sourceType = str("source_type") ?: "uploaded",
        createdAt = str("created_at") ?: "",
    )
}

fun JSONObject.toHeroBanner(): HeroBanner = HeroBanner(
    movieId = optLong("movie_id"),
    bannerImage = str("banner_image") ?: "",
    title = str("title"),
    description = str("description"),
    badge = str("badge"),
)

fun JSONObject.toCustomRow(): CustomRow {
    val ids = mutableListOf<Long>()
    optJSONArray("movieIds")?.let { arr ->
        for (i in 0 until arr.length()) ids.add(arr.optLong(i))
    }
    val refs = mutableListOf<String>()
    optJSONArray("movieRefs")?.let { arr ->
        for (i in 0 until arr.length()) refs.add(arr.optString(i))
    }
    return CustomRow(
        id = str("id") ?: "",
        title = str("title") ?: "",
        visible = optBoolean("visible", true),
        movieIds = ids,
        movieRefs = refs,
        isLarge = optBoolean("isLarge", false),
        section = (str("section") ?: "home").lowercase(),
    )
}

// ---------------------------------------------------------------------------
// Website jaisi grouping: playlist → collection, season-wise episodes
// ---------------------------------------------------------------------------

fun groupCollections(synced: List<Movie>, covers: Map<String, String>): List<Movie> {
    val byPlaylist = synced.groupBy { it.playlistId ?: "single_${it.id}" }
    return byPlaylist.map { (key, eps) ->
        val seasons = eps.groupBy { it.seasonNumber ?: 1 }.toSortedMap()
            .map { (num, list) ->
                Season(num, list.sortedBy { it.episodeNumber ?: 0 })
            }
        val flat = seasons.flatMap { it.episodes }
        val first = flat.first()
        val synthId = (key.hashCode().toLong() and 0x7fffffffL) + 1_000_000_000L
        val cover = first.playlistId?.let { covers[it] }
        first.copy(
            id = synthId,
            title = first.playlistTitle ?: first.title,
            description = buildString {
                if (seasons.size > 1) append("${seasons.size} seasons • ")
                append("${flat.size} episode")
                if (flat.size != 1) append("s")
            },
            isCollection = true,
            episodes = flat,
            seasons = seasons,
            image = cover ?: first.image,
            backdrop = cover ?: first.backdrop,
        )
    }
}

/** Custom row ke movieIds/movieRefs ko asli movies se milao (website jaisa). */
fun resolveCustomRow(row: CustomRow, display: List<Movie>): List<Movie> {
    val byId = display.associateBy { it.id }
    val byRef = display.associateBy { it.ref }
    val byEpisodeId = mutableMapOf<Long, Movie>()
    display.forEach { m -> m.episodes.forEach { e -> byEpisodeId[e.id] = m } }
    val used = mutableSetOf<Long>()
    val out = mutableListOf<Movie>()
    fun push(m: Movie?) {
        if (m != null && used.add(m.id)) out.add(m)
    }
    row.movieRefs.forEach { push(byRef[it]) }
    row.movieIds.forEach { push(byId[it] ?: byEpisodeId[it]) }
    return out
}

/** Hero banners ko movies se jodo (override title/desc/banner ke saath). */
fun resolveHeroes(heroes: List<HeroBanner>, display: List<Movie>): List<Movie> {
    val out = heroes.mapNotNull { h ->
        val base = display.firstOrNull { it.id == h.movieId } ?: return@mapNotNull null
        base.copy(
            title = h.title?.takeIf { it.isNotEmpty() } ?: base.title,
            description = h.description?.takeIf { it.isNotEmpty() } ?: base.description,
            backdrop = h.bannerImage.ifEmpty { base.backdrop },
            image = h.bannerImage.ifEmpty { base.image },
        )
    }
    return out.ifEmpty { display.take(5) }
}

/** Category filter — website ke CATEGORY_MATCH jaisa. */
fun matchCategory(cat: String, m: Movie): Boolean {
    val g = m.genre.map { it.lowercase() }
    return when (cat) {
        "anime" -> g.contains("anime")
        "cartoon" -> g.contains("cartoon")
        "movies" -> !g.contains("anime") && !g.contains("cartoon")
        "tvshows" -> m.rating.startsWith("TV")
        "new" -> m.year == Calendar.getInstance().get(Calendar.YEAR)
        else -> true
    }
}

fun parseMoviesJson(json: String): List<Movie> {
    val arr = JSONArray(json)
    return List(arr.length()) { i -> arr.getJSONObject(i).toMovie() }
}

fun parseHeroesJson(json: String): List<HeroBanner> {
    val arr = JSONArray(json)
    return List(arr.length()) { i -> arr.getJSONObject(i).toHeroBanner() }
}

fun parseCoversJson(json: String): Map<String, String> {
    val arr = JSONArray(json)
    val out = mutableMapOf<String, String>()
    for (i in 0 until arr.length()) {
        val o = arr.getJSONObject(i)
        val pid = o.str("playlist_id")
        val url = o.str("image_url")
        if (pid != null && url != null) out[pid] = url
    }
    return out
}

fun parseConfigJson(json: String): List<CustomRow> {
    val arr = JSONArray(json)
    if (arr.length() == 0) return emptyList()
    val rows = arr.getJSONObject(0).optJSONArray("custom_rows") ?: return emptyList()
    return List(rows.length()) { i -> rows.getJSONObject(i).toCustomRow() }
}
