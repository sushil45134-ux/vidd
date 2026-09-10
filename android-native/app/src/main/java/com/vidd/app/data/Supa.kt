package com.vidd.app.data

import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.scalars.ScalarsConverterFactory
import retrofit2.http.GET
import java.util.concurrent.TimeUnit

/**
 * Supabase se seedha baat — wahi database jo website use karti hai.
 * Sirf padhne (read) wale calls — isliye anon key kaafi hai.
 */
object Supa {

    const val BASE_URL = "https://yjakihgnxntjfjvarxmt.supabase.co/rest/v1/"

    // Anon (public) key — client app me rakhna safe hai (sirf read permission).
    private const val ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYWtpaGdueG50amZqdmFyeG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MjIwMjQsImV4cCI6MjEwMDE5ODAyNH0.swnTt5ubxf04lkRvaulAhXExdYSAXsRjPuEY1Iv63Do"

    interface Api {
        @GET("movies?select=*&order=created_at.desc")
        suspend fun movies(): String

        @GET("hero_banners?select=*&order=sort_order.asc")
        suspend fun heroBanners(): String

        @GET("site_config?select=*&id=eq.1")
        suspend fun siteConfig(): String

        @GET("collection_covers?select=playlist_id,image_url")
        suspend fun collectionCovers(): String
    }

    val api: Api by lazy {
        val client = OkHttpClient.Builder()
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val req = chain.request().newBuilder()
                    .header("apikey", ANON_KEY)
                    .header("Authorization", "Bearer $ANON_KEY")
                    .header("Accept", "application/json")
                    .build()
                chain.proceed(req)
            }
            .build()
        Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(client)
            .addConverterFactory(ScalarsConverterFactory.create())
            .build()
            .create(Api::class.java)
    }
}
