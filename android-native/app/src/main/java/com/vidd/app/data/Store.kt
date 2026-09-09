package com.vidd.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.json.JSONObject

private val Context.dataStore by preferencesDataStore("vidd")

/** Ek downloaded video ka hisaab. */
data class DlMeta(
    val id: Long,
    val title: String,
    val image: String,
    val fileName: String,
    val dmId: Long,          // DownloadManager ki ID
    val done: Boolean,       // poora download hua ya chal raha
    val size: Long = 0L,
)

/**
 * Phone me save rehne wala data: My List, Likes, Downloads, notification hisaab.
 * (App band karke kholo — ye sab bana rehta hai.)
 */
object Store {

    lateinit var appCtx: Context
        private set

    fun init(ctx: Context) {
        appCtx = ctx.applicationContext
    }

    private val MY_LIST = stringSetPreferencesKey("mylist")
    private val LIKED = stringSetPreferencesKey("liked")
    private val DOWNLOADS = stringPreferencesKey("downloads_json")
    private val LAST_SEEN = stringPreferencesKey("last_seen_created_at")

    // ---------- My List ----------
    // lazy isliye taaki Store.init() ke baad hi DataStore chhue (warna crash).
    val myList: Flow<Set<String>> by lazy {
        appCtx.dataStore.data.map { it[MY_LIST] ?: emptySet() }
    }

    suspend fun toggleMyList(id: Long): Boolean {
        var added = false
        appCtx.dataStore.edit { p ->
            val cur = p[MY_LIST] ?: emptySet()
            val key = id.toString()
            if (cur.contains(key)) p[MY_LIST] = cur - key
            else { p[MY_LIST] = cur + key; added = true }
        }
        return added
    }

    suspend fun myListNow(): Set<String> =
        appCtx.dataStore.data.map { it[MY_LIST] ?: emptySet() }.first()

    // ---------- Likes ----------
    val liked: Flow<Set<String>> by lazy {
        appCtx.dataStore.data.map { it[LIKED] ?: emptySet() }
    }

    suspend fun toggleLiked(id: Long) {
        appCtx.dataStore.edit { p ->
            val cur = p[LIKED] ?: emptySet()
            val key = id.toString()
            p[LIKED] = if (cur.contains(key)) cur - key else cur + key
        }
    }

    // ---------- Downloads ----------
    val downloads: Flow<Map<String, DlMeta>> by lazy {
        appCtx.dataStore.data.map { parseDlMap(it[DOWNLOADS]) }
    }

    suspend fun downloadsNow(): Map<String, DlMeta> =
        appCtx.dataStore.data.map { parseDlMap(it[DOWNLOADS]) }.first()

    suspend fun putDownload(meta: DlMeta) {
        appCtx.dataStore.edit { p ->
            val map = parseDlMap(p[DOWNLOADS]).toMutableMap()
            map[meta.id.toString()] = meta
            p[DOWNLOADS] = toDlJson(map)
        }
    }

    suspend fun removeDownload(id: Long) {
        appCtx.dataStore.edit { p ->
            val map = parseDlMap(p[DOWNLOADS]).toMutableMap()
            map.remove(id.toString())
            p[DOWNLOADS] = toDlJson(map)
        }
    }

    /** DownloadManager ID se movie dhoondo (complete hone par). */
    suspend fun findByDmId(dmId: Long): DlMeta? =
        downloadsNow().values.firstOrNull { it.dmId == dmId }

    private fun parseDlMap(json: String?): Map<String, DlMeta> {
        if (json.isNullOrEmpty()) return emptyMap()
        return try {
            val o = JSONObject(json)
            val out = mutableMapOf<String, DlMeta>()
            o.keys().forEach { k ->
                val e = o.getJSONObject(k)
                out[k] = DlMeta(
                    id = k.toLongOrNull() ?: return@forEach,
                    title = e.optString("title"),
                    image = e.optString("image"),
                    fileName = e.optString("fileName"),
                    dmId = e.optLong("dmId"),
                    done = e.optBoolean("done"),
                    size = e.optLong("size"),
                )
            }
            out
        } catch (_: Exception) { emptyMap() }
    }

    private fun toDlJson(map: Map<String, DlMeta>): String {
        val o = JSONObject()
        map.forEach { (k, m) ->
            o.put(k, JSONObject().apply {
                put("title", m.title)
                put("image", m.image)
                put("fileName", m.fileName)
                put("dmId", m.dmId)
                put("done", m.done)
                put("size", m.size)
            })
        }
        return o.toString()
    }

    // ---------- Notification hisaab ----------
    suspend fun lastSeen(): String =
        appCtx.dataStore.data.map { it[LAST_SEEN] ?: "" }.first()

    suspend fun setLastSeen(createdAt: String) {
        appCtx.dataStore.edit { it[LAST_SEEN] = createdAt }
    }
}
