# Nxsha Fullscreen Bot — turant Nxsha ka fullscreen, bina extra click

## Problem (purana behaviour)

Episode kholte hi auto-fullscreen **Vidd ke player container** pe lagta tha —
matlab "Vidd ka fullscreen" dikhta tha, Nxsha player ka apna fullscreen nahi.
Mobile pe screen portrait hi rehti thi aur Nxsha ke fullscreen button pe ek
extra click karna padta tha.

## Naya system — `src/lib/nxshaFullscreenBot.ts`

Nxsha embed mount hote hi bot chalu ho jaata hai:

1. **Turant attempt** — episode kholne wale click ki user-activation abhi
   zinda hoti hai, isliye bot **seedha Nxsha IFRAME element** ko native
   fullscreen me daal deta hai. Screen pe sirf Nxsha player hota hai
   (Vidd ka koi chrome nahi) — exactly waisa jaise Nxsha ka apna fullscreen
   button dabaya ho.
2. **Landscape lock** — fullscreen milte hi phones pe screen best-effort
   landscape lock hoti hai (Nxsha ka button bhi yahi karta hai). Desktop pe
   lock silently reject hota hai, koi farak nahi.
3. **Retry bot** — agar browser ne turant wala attempt block kiya (activation
   expire), to bot capture-phase listeners arm kar deta hai: user ka **sabse
   pehla** tap/click/keypress hi Nxsha fullscreen trigger kar deta hai —
   fullscreen button dhundhna nahi padta.
4. **Fallback** — iframe request reject ho jaye to container fullscreen
   (purana behaviour) as backup.
5. **User ki respect** — Esc / back se user fullscreen se nikle to bot dobara
   force nahi karta; orientation unlock ho jaati hai.

## Kyun click simulate nahi kiya?

Nxsha ka player **cross-origin iframe** hai — parent page uske andar ke
fullscreen button ko programmatically click NAHI kar sakta (browser security).
Iframe element ko khud fullscreen karna hi parent se possible equivalent hai,
aur result wahi hai: poori screen pe sirf Nxsha player.

## Files

| File | Kaam |
|---|---|
| `src/lib/nxshaFullscreenBot.ts` | Bot: iframe-first fullscreen + landscape lock + first-interaction retry |
| `src/components/EmbedPlayer.tsx` | Nxsha URLs bot use karte hain; baaki embeds/videos pe purana container fullscreen jyon-ka-tyon |

Dailymotion, YouTube, uploaded videos — sab ka behaviour unchanged.
