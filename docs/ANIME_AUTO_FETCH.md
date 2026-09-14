# Anime Auto-Fetch System — Jikan + AniList (No TMDB, No API Key)

## Problem solved
Tumhare paas TMDB API nahi hai, aur tum manually har season/episode ka poster, description, cover add nahi karna chahte. Is naye system me sirf **Anime ka naam + IMDb ID** dalo, aur pura anime auto fetch ho jayega.

## Kaise kaam karta hai?

### Backend: `/api/anime-auto`
- **AniList GraphQL** (`https://graphql.anilist.co`) — public, no key
  - Search by anime name
  - Fetch full details: title (romaji/english/native), description, cover (extraLarge), banner, genres, averageScore, studios, seasonYear, episodes count
  - Fetch relations (prequel/sequel) to build multi-season chain (e.g. Naruto → Naruto Shippuden, Demon Slayer S1 → S2 → S3)
- **Jikan API** (`https://api.jikan.moe/v4`) — MyAnimeList unofficial, no key
  - For each season (via `idMal`), fetch all episodes: `GET /anime/{malId}/episodes`
  - Each episode: title, synopsis, aired date, filler/recap flag, thumbnail image (`images.jpg.image_url`)
  - Rate limit respected (400ms delay, retry on 429)
- Fallback: If Jikan episodes empty, use AniList `streamingEpisodes` or generate placeholders from episode count

### Frontend: `AnimeAutoFetchPanel.tsx`
1. User enters:
   - Anime Name: e.g. `Demon Slayer`, `Naruto`, `One Piece`
   - IMDb ID: e.g. `tt15765670` (ya TMDB numeric ID)
   - Provider: `NHD` (default) ya `Nxsha` (Hindi audio)
2. Click **Fetch Anime**
3. API returns structured data:
```json
{
  "mainTitle": "Demon Slayer",
  "mainCover": "https://...",
  "mainBanner": "https://...",
  "totalSeasons": 3,
  "totalEpisodes": 55,
  "seasons": [
    {
      "seasonNumber": 1,
      "title": "Demon Slayer",
      "coverImage": "https://...",
      "episodes": [
        { "episodeNumber": 1, "title": "Cruelty", "image": "https://...", "synopsis": "..." }
      ]
    }
  ]
}
```
4. UI shows preview: banner, cover, genres, each season with episode thumbnails (from Jikan)
5. User selects seasons (default all)
6. Click **Add Episodes** → converts to `Movie[]` via `autoFetchToMovies()`:
   - `embedUrl` built from template: `https://nhdapi.com/tv/{id}/{s}/{e}` → `https://nhdapi.com/tv/tt15765670/1/1`
   - `image` = Jikan episode image or AniList cover
   - `playlistId` = `anime-auto-{anilistId}-{imdbId}` (groups into one series card)
   - `seasonNumber`, `episodeNumber` set properly

### No manual work
- Cover, banner, description, genres auto from AniList
- Episode title, synopsis, thumbnail auto from Jikan
- Player links auto from IMDb ID + template
- Seasons auto-detected via relations

## Usage in UploadModal
- Open **Add Movie** modal (admin)
- New tab **Anime** (Wand icon) — next to Series, Drive, MEGA
- Enter anime name + IMDb ID → Fetch → Select seasons → Add
- Done! Series appears as one card with season browser, just like Crunchyroll

## Example
- Name: `Naruto`
- IMDb: `tt0388629`
- Provider: `NHD`
- Result: 5 seasons (Naruto 220 ep + Shippuden 500 ep + etc) auto, each episode has real thumbnail from Jikan, description, and player link `https://nhdapi.com/tv/tt0388629/1/1`, `/1/2`, etc.

## Why no TMDB?
- AniList + Jikan are free, no API key, anime-specific, better data for anime (filler info, Japanese titles, studios, relations)
- TMDB is for general movies, not ideal for anime seasons

## Files added
- `src/routes/api/anime-auto.ts` — server route
- `src/lib/animeAutoFetch.ts` — client helper + types + `autoFetchToMovies()`
- `src/components/AnimeAutoFetchPanel.tsx` — UI panel
- Updated `src/components/UploadModal.tsx` — added Anime tab
- Updated `src/routeTree.gen.ts` — registered new route
