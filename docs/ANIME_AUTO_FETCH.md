# Anime Auto-Fetch — Nxsha topology + AniList/Jikan metadata

## Source-of-truth rule

Anime ke **seasons aur episode numbers sirf Nxsha title response** se aate hain.
AniList/Jikan topology decide nahi karte.

- Nxsha response → available seasons
- Nxsha response → har season ki episode list
- AniList/Jikan → title, synopsis, poster, banner, thumbnail, genres, studio
- Nxsha me missing episode → website par card nahi
- AniList relation me extra sequel/OVA → website par fake season nahi

## Backend flow

`GET /api/anime-auto?title=...&imdbId=...`

1. IMDb/TMDB ID resolve hota hai.
2. `web.nxsha.app/tv/{id}` (fallback `nxsha.space/tv/{id}`) ka server-rendered response fetch hota hai.
3. Response ke `/watch/tv/{id}/{season}/{episode}` links aur serialized
   `season_number`/`episode_count` fields se exact topology banti hai.
4. AniList/Jikan se metadata fetch hota hai.
5. Metadata ko Nxsha topology par map kiya jata hai. Metadata ka koi extra season/episode drop ho jata hai.
6. Nxsha unavailable/not-found ho to request fail-closed hoti hai; guessed cards create nahi hote.

`/api/nxsha-catalog` existing website library ko bhi isi provider topology se verify karta hai.
Isliye purane Supabase rows me galat AniList seasons hon tab bhi UI unhe render nahi karti.
Provider response me jo episode DB me missing ho, UI same collection metadata se deterministic card banati hai.

## Admin usage

1. Add Movie → **Anime** tab.
2. Anime name aur IMDb ID dalo. IMDb blank ho to resolver try karega.
3. Default player provider **Nxsha** hai.
4. Fetch ke baad sirf Nxsha-verified seasons preview honge.
5. Add karne par exact season/episode numbers ke embed URLs Supabase me save honge.

## Automatic sync

Admin `/api/anime-sync` flow aur `scripts/anime-sync.mjs` cron dono Nxsha collections ke
liye provider topology ka diff nikalte hain. AniList/Jikan sirf naye cards ko enrich karte hain.
Legacy non-Nxsha collections purana aired-episode flow use kar sakti hain.

## Main files

- `src/lib/nxshaCatalog.ts` — response parser, fetcher, runtime reconciliation
- `src/routes/api/nxsha-catalog.ts` — batch catalogue endpoint
- `src/routes/api/anime-auto.ts` — Nxsha topology + metadata enrichment
- `src/lib/animeAutoFetch.ts` — result to `Movie[]`
- `src/components/AnimeAutoFetchPanel.tsx` — admin UI
- `src/App.tsx` — all existing Nxsha anime collections ka fail-closed reconciliation
- `src/routes/api/anime-sync.ts` — admin sync
- `scripts/anime-sync.mjs` — cron sync
