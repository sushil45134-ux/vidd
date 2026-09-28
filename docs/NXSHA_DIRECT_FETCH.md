# Nxsha Direct Fetch — episodes seedhe Nxsha ke catalogue se

## Problem (purana system)

Purana auto-fetch (`/api/anime-auto`) episode list **AniList + Jikan (MAL)** se
banata tha. Ye teeno tarah se toot-ta tha:

1. Jikan/MAL down ho (aksar hota hai) → khaali list
2. AniList `streamingEpisodes` me sirf ep-1 hota hai → **"12 me se sirf 1 episode"**
   (Chainsmoker Cat bug)
3. AniList relations galat/side-story seasons bana dete the → App.tsx me
   S0/S1 renumbering hacks lagane pade

## Naya system

**Nxsha ka poora catalogue TMDB ka mirror hai** — embed URL me TMDB numeric id
chalta hai (`nxsha.space/embed/tv/{tmdbId}/{s}/{e}`) aur player ka Episodes
list bhi TMDB season data hi hai. Isliye naya route seedha TMDB ke
server-rendered pages scrape karta hai (koi API key nahi):

```
GET /api/nxsha-fetch?q=<TMDB link | Nxsha link | TMDB id | naam>[&specials=1]
```

- `themoviedb.org/tv/{id}` → title, poster, backdrop, genres, overview
- `themoviedb.org/tv/{id}/season/{n}` → REAL episode list: number, naam,
  air-date, thumbnail, runtime — exactly wahi jo Nxsha player me hai
- Sirf **aired** episodes return hote hain (air-date <= aaj + 36h grace),
  kyunki Nxsha ke paas future episodes ki stream nahi hoti
- Parsing class-names pe nahi, **canonical URLs + title attributes** pe based
  hai (`/season/{s}/episode/{e}` links, `Episode N - Title"` attrs) — TMDB ka
  CSS badle to bhi chalega
- Response 5 min cache (`max-age=300`) — naye episodes jaldi dikhte hain

## Files

| File | Kaam |
|---|---|
| `src/routes/api/nxsha-fetch.ts` | TMDB scraper API route |
| `src/lib/nxshaFetch.ts` | Client types + `nxshaResultToMovies()` |
| `src/components/NxshaFetchPanel.tsx` | Admin panel (Upload → Anime tab, sabse upar) |

## Playlist prefix: `nxsha-tv-{tmdbId}`

Naye collections ka `playlistId` is prefix se shuru hota hai. `App.tsx` aur
`MovieModal.tsx` ke legacy Nxsha season-renumbering hacks (jo >2 season wale
anime ko S0/S1 me kaat dete the) is prefix ko dekh kar **skip** ho jaate hain —
kyunki TMDB se aaye season numbers pehle se Nxsha ke saath 1:1 sahi hain.

## Example — Chainsmoker Cat

```
/api/nxsha-fetch?q=https://www.themoviedb.org/tv/312949
```
→ Season 1: 12/12 aired episodes, har ek ka apna naam + TMDB still +
`https://nxsha.space/embed/tv/312949/1/{e}?lang=hi&server=GbruHindi&one_server=true&disable_app_ad=true`

Anime ke alawa **koi bhi TV series** isi panel se add ho sakti hai (Anime
category checkbox off kar do).
