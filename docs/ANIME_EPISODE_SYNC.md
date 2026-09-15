# Anime Episode Auto-Sync — naye episodes apne aap website par

## Problem
Anime season add kar diya (Nxsha/NHD embed ke saath). Ab jab naya episode air hota hai,
toh wo website par season ke andar apne aap aa jana chahiye — manually add na karna pade.

## Key insight 💡
Nxsha/NHD embeds **IMDb-ID template** based hain:

```
https://nxsha.space/embed/tv/{id}/{s}/{e}?lang=hi&...
https://nhdapi.com/tv/{id}/{s}/{e}
```

Matlab player ke liye kisi bhi episode ka video link "fetch" karne ki zaroorat hi nahi —
template me episode number badalte hi player us episode ko play kar deta hai.
Jo cheez missing hoti hai wo sirf **episode ka CARD** (Supabase `movies` row) hai:
title, thumbnail, description aur embed URL. Sync system bas yahi rows generate karta hai.

## Flow

```
Supabase (existing episodes)          AniList (free, no key)         Jikan/MAL (free, no key)
  playlist_id = anime-auto-*    →    status / nextAiringEpisode  →   episode title,
  season + episode numbers           aired episode count               synopsis, thumbnail
                \                         |                               /
                 \                        v                              /
                  →  diff nikalo: aired episodes − DB episodes  ←
                                    |
                                    v
                 naye episode rows (same embed template, same playlistId)
                                    |
                                    v
                          Supabase me INSERT → season me dikhte hain ✅
```

Naye **season** (sequel airing start) bhi detect hote hain — AniList ke
PREQUEL/SEQUEL relation chain se.

## 3 trigger options

### 1. Admin button (manual, 1-click) — `AnimeEpisodeSyncPanel`
- Add Movie modal → **Anime** tab → sabse upar purple **"New Episode Auto-Sync"** card.
- **"Check New Episodes"** dabao → `/api/anime-sync` saari collections check karta hai
  aur batata hai kaunse season me kitne naye episodes aaye (e.g. `S1 • 12 → 13 aired • +1 new`).
- **"Add X New Episodes to Website"** dabao → rows Supabase me insert + UI refresh.
- Panel khulte hi **background auto-check** bhi chalta hai (har 6 ghante me max ek baar).
- Duplicate protection: insert se pehle DB se (playlist, season, episode) keys match hoti hain.

### 2. API endpoint — `/api/anime-sync`
Read-only plan deta hai (kabhi khud DB me likhta nahi — RLS authenticated write):

```
GET /api/anime-sync                    → saari collections ka plan
GET /api/anime-sync?playlistId=...     → sirf ek collection
GET /api/anime-sync?maxPerSeason=20    → per-season cap (default 50)
```

### 3. Fully automatic cron (zero manual kaam) — GitHub Actions ⭐
`.github/workflows/anime-episode-sync.yml` har **6 ghante** `scripts/anime-sync.mjs`
chalata hai, jo bina browser/admin login ke directly Supabase me naye episodes insert karta hai.

**One-time setup (2 minute):**
1. Supabase Dashboard → **Settings → API** → `service_role` (secret) key copy karo.
2. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `SUPABASE_SERVICE_ROLE_KEY`
   - Value: wo secret key
3. Bas. Har 6 ghante sync hoga. Manual trigger bhi kar sakte ho:
   GitHub → Actions → "Anime Episode Sync" → Run workflow.

Local test:
```sh
DRY_RUN=1 node scripts/anime-sync.mjs                      # sirf dekho kya add hoga
SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/anime-sync.mjs  # actually insert karo
```

Logic tests (offline): `node scripts/anime-sync.test.mjs`

## Safe by design
- Sirf `playlist_id LIKE 'anime-auto-%'` collections sync hoti hain (manual uploads untouched).
- Sirf wahi provider template use hota hai jo collection ke existing episodes me hai.
- Per-season cap (default 50) — long-running shows ek run me flood nahi karte.
- AniList ka `nextAiringEpisode` use hota hai, isliye episode tabhi add hota hai jab
  wo **air ho chuka** ho (future/unaired episodes nahi aate).
- Ek run fail ho to agla cron phir try karta hai; rows idempotent hain (dedupe built-in).

## Limits
- AniList/Jikan metadata par depend karta hai (kabhi kabhi 1-2 ghante ka lag).
- Agar AniList par title match nahi hota to collection skip hoti hai (reason response me dikhta hai) —
  aise anime ke liye Auto-Fetch panel se dobara add karo sahi naam se.
- 500+ episode wale shows (One Piece) cap ki wajah se multiple runs me complete hote hain.

## Files
| File | Kaam |
|---|---|
| `src/routes/api/anime-sync.ts` | Server: collections scan + AniList/Jikan diff + plan |
| `src/lib/animeEpisodeSync.ts` | Client: plan fetch, dedupe, insert helpers |
| `src/components/AnimeEpisodeSyncPanel.tsx` | Admin UI: check button + results + add button |
| `scripts/anime-sync.mjs` | Standalone cron script (service_role key se direct insert) |
| `scripts/anime-sync.test.mjs` | Offline logic tests |
| `.github/workflows/anime-episode-sync.yml` | Har 6 ghante ka cron |
