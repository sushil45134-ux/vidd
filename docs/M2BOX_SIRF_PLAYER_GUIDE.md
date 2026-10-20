# M2Box "Sirf Player" Crop — poori guide (kisi bhi website ke liye)

M2Box (m2box.org / MovieBox) ke watch page ko apni website ke andar is
tarah dikhana ki screen par **bas video player + episode wali list**
bache — site ka logo, search, menu, sidebar, title, rating… sab kata
hua. Ye wahi tareeka hai jo is project (Vidd) me chala hua hai aur
asli screenshots par pixel-naap karke pakka kiya gaya hai.

**Turant chahiye?** `docs/m2box-sirf-player.html` ek hi file me poora
ready demo hai — browser me khol kar test karo, phir uska CSS + HTML
dabbe + `<script>` apni website me copy kar lo.

Contents:

1. [Chal kya hai (ek nazar me)](#1-chal-kya-hai-ek-nazar-me)
2. [Saare number ek table me](#2-saare-number-ek-table-me)
3. [Copy-paste: HTML + CSS + JS (kisi bhi site ke liye)](#3-copy-paste-html--css--js-kisi-bhi-site-ke-liye)
4. [Copy-paste: React version (hamara asal code)](#4-copy-paste-react-version-hamara-asal-code)
5. [Watch-page URL kaise banta hai](#5-watch-page-url-kaise-banta-hai)
6. [sandbox / allow — kyun zaroori hai](#6-sandbox--allow--kyun-zaroori-hai)
7. [Mobile wala hisaab alag kyun hai](#7-mobile-wala-hisaab-alag-kyun-hai)
8. [Fullscreen ke 3 usool](#8-fullscreen-ke-3-usool)
9. [Jin galtiyon me hum khud phase (inhe mat dohrana)](#9-jin-galtiyon-me-hum-khud-phase-inhe-mat-dohrana)
10. [Site layout badle to khud naapne ka tareeka](#10-site-layout-badle-to-khud-naapne-ka-tareeka)
11. [Hadein (limits)](#11-hadein-limits)

---

## 1. Chal kya hai (ek nazar me)

M2Box koi official embed nahi deta. Lekin uska poora watch page ek
`<iframe>` me khul jata hai (site abhi framing rokti nahi hai). To
hum poora page load karke uska **sirf player wala hissa "kaat" kar**
dikhate hain — teen dabbon se:

```
┌─ Bahari dabba (outer) ───────────────────────────────┐
│  PAKKI height wali jagah (jaise 100dvh wala page     │
│  ya fullscreen overlay). Size naapne ke kaam aata    │
│  hai. Iske andar beech me dikhta hai:                │
│                                                      │
│   ┌─ Dikhne wala dabba (box, overflow:hidden) ──┐    │
│   │  Chaudai = poori, unchai = player ke just   │    │
│   │  neeche khatm. Iske bahar = sab kata hua.   │    │
│   │                                             │    │
│   │  ┌─ Stage (fixed 1416 chaudi, scale hoti) ─┐│    │
│   │  │   iframe asli me 1536 chauda hai, use   ││    │
│   │  │   upar −117 aur baayein −120 dhakela    ││    │
│   │  │   hai — header aur baayein hissa dabbe  ││    │
│   │  │   ke bahar, sirf player wala hissa andar││    │
│   │  └─────────────────────────────────────────┘│    │
│   └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

Teen khaas batein:

1. **Iframe hamesha fixed 1536px chaudai par render hota hai**
   ("stage"). Site ka layout is ek chaudai par hamesha waisa hi
   rehta hai, isliye saare kaat ke number hamesha pakke rehte hain.
   Phir poori stage ko `transform: scale()` se screen ke hisaab se
   bada/chhota kar dete hain. Isiliye kaat har screen par **bilkul
   ek jagah** padta hai — chhota laptop ho ya badi monitor.
2. **1536 hi kyun?** Is chaudai par site ka layout bilkul waisa
   hota hai jaisa khud m2box.org par dikhta hai — episode wale
   button **5 column me chhote** bante hain. Kam chaudai (jaise 1280) par button 4 column ke **bade** bante hain; zyada episodes
   (26+) ho to episode wala panel player se lamba ho jata hai,
   site player ko kheench deti hai (upar kala band) aur controls
   hamari window ke bahar dhakel jaate hain. Ye galti hum kar
   chuke hain — section 9 dekho.
3. **Scroll band** (`scrolling="no"`, desktop par): dabba khud
   chhota hai, lekin iframe ke andar ka page lamba hai. Scroll
   khula rakha to user scroll karke wahi title/menu phir dekh lega
   jo kaata tha. Band rakho to kata hua hissa kahin se nahi aata.

## 2. Saare number ek table me

Ye number asli site ke screenshot ko pixel-naap karke nikale gaye
hain (Demon Slayer [Hindi], 26 episodes, 20 Oct 2026). Saare number
**stage ke hisaab me (CSS px, jab iframe 1536 chauda ho)** hain:

| Cheez                           | Stage par jagah | Matlab                                  |
| ------------------------------- | --------------- | --------------------------------------- |
| Header + menu ka neeche kinara  | page-y ≈ 120    | Isse upar ka sab kaatna hai             |
| Player + episode panel ki top   | page-y ≈ 120    | Player yahin se shuru hota hai          |
| Player ka baayein kinara        | page-x ≈ 129    | Play button isse 26 aage, time 112 aage |
| Controls (play/time/gear) khatm | page-y ≈ 640    | Video par overlay hote hain             |
| Player/panel ka neeche kinara   | page-y ≈ 654    | Window iske just neeche khatm ho        |
| Title/rating ki patti shuru     | page-y ≈ 682    | Ye bilkul nahi dikhni chahiye           |

Inse bane **chaar constants** (site layout badle to bas yehi
badalne hain):

| Constant         | Value | Kaise nikla                                                    |
| ---------------- | ----- | -------------------------------------------------------------- |
| `STAGE_WIDTH`    | 1536  | Asli site jaisa layout (5-col guide)                           |
| `CROP_TOP`       | 117   | Player top (120) se 3 upar, halki saans                        |
| `CROP_LEFT`      | 120   | Player left (129) se 9 pehle                                   |
| `VISIBLE_HEIGHT` | 545   | Window page-y 117 → 662 (player ke 8 neeche, title se 20 upar) |

Dikhne wali stage-chaudai = 1536 − 120 = **1416**.
Scale = `bahari dabbe ki chaudai / 1416`.
Dabbe ki screen-unchai = `545 × scale`, lekin bahari dabbe ki
unchai se zyada kabhi nahi (chhoti screen par cap).

> ⚠️ Sabse badi seekh: ye number **iframe ke andar liye gaye
> screenshot** se naape hain. Browser tab me khuli site se mat
> naapna — wahan site ki left sidebar khuli hoti hai (tumhari saved
> preference), iframe ke andar wo default **band** padti hai.
> Tab se naapne par hamara left wala kaat 236 ban gaya tha aur
> player ke play/sound button kat gaye the. Iframe ke andar
> player 129 se shuru hota hai, tab me 245 se.

## 3. Copy-paste: HTML + CSS + JS (kisi bhi site ke liye)

Poori ready file: **`docs/m2box-sirf-player.html`**. Uska asli
hissa ye hai — teen dabbe + ek script:

**CSS**

```css
.m2outer {
  /* naapne wala dabba — PAKKI height wali jagah me rakho */
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.m2box {
  /* dikhne wala dabba — width/height JS dega */
  position: relative;
  overflow: hidden;
  background: #000;
  flex: 0 0 auto;
}
.m2stage {
  position: relative;
  transform-origin: top left;
}
.m2frame {
  position: absolute;
  border: 0;
} /* top/left/width/height JS dega */
```

**HTML**

```html
<div class="m2outer" id="m2outer">
  <div class="m2box" id="m2box">
    <div class="m2stage" id="m2stage">
      <iframe
        id="m2frame"
        class="m2frame"
        title="M2Box player"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
        allowfullscreen
        referrerpolicy="no-referrer-when-downgrade"
        sandbox="allow-downloads allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts"
      ></iframe>
    </div>
  </div>
</div>
```

**JS** (poora logic — React wale asal code ka seedha tarjuma)

```js
var STAGE_WIDTH = 1536,
  CROP_TOP = 117,
  CROP_LEFT = 120,
  VISIBLE_HEIGHT = 545;

function getCrop(outerW, outerH) {
  var w = outerW > 0 ? outerW : 1416;
  if (w >= 900) {
    // desktop: fixed stage + scale
    var visibleW = STAGE_WIDTH - CROP_LEFT;
    var scale = w / visibleW;
    var wanted = VISIBLE_HEIGHT * scale;
    return {
      stacked: false,
      frameWidth: Math.round(w),
      height: Math.round(outerH > 0 ? Math.min(wanted, outerH) : wanted),
      stageWidth: STAGE_WIDTH,
      stageVisibleWidth: visibleW,
      stageVisibleHeight: VISIBLE_HEIGHT,
      cropTop: CROP_TOP,
      cropLeft: CROP_LEFT,
      scale: scale,
    };
  }
  // mobile: episode list player ke neeche hoti hai (section 7)
  var cropTop = w >= 768 ? 112 : w >= 480 ? 108 : 104;
  var wantedM = (Math.max(0, w - 24) * 9) / 16 + 16 + 320;
  return {
    stacked: true,
    frameWidth: Math.round(w),
    height: Math.round(outerH > 0 ? Math.min(wantedM, outerH) : wantedM),
    stageWidth: Math.round(w),
    stageVisibleWidth: Math.round(w),
    stageVisibleHeight: Math.round(wantedM),
    cropTop: cropTop,
    cropLeft: 0,
    scale: 1,
  };
}

function apply() {
  var r = outer.getBoundingClientRect();
  var crop = getCrop(r.width, r.height);
  if (document.fullscreenElement) {
    // fullscreen me crop bilkul hata do
    box.style.width = box.style.height = "100%";
    stage.style.width = stage.style.height = "100%";
    stage.style.transform = "";
    frame.style.cssText += ";top:0;left:0;width:100%;height:100%";
  } else {
    box.style.width = crop.frameWidth + "px";
    box.style.height = crop.height + "px";
    stage.style.width = crop.stageVisibleWidth + "px";
    stage.style.height = crop.stageVisibleHeight + "px";
    stage.style.transform = crop.scale !== 1 ? "scale(" + crop.scale + ")" : "";
    frame.style.top = -crop.cropTop + "px";
    frame.style.left = -crop.cropLeft + "px";
    frame.style.width = crop.stageWidth + "px";
    frame.style.height = crop.stageVisibleHeight + crop.cropTop + "px";
  }
  // desktop par andar scroll hamesha band; mobile par khula (episodes ke liye)
  if (crop.stacked) frame.removeAttribute("scrolling");
  else frame.setAttribute("scrolling", "no");
}

new ResizeObserver(apply).observe(outer);
window.addEventListener("resize", apply);
document.addEventListener("fullscreenchange", function () {
  apply();
  requestAnimationFrame(apply);
  setTimeout(apply, 80);
  setTimeout(apply, 250);
});
frame.src = watchUrl; // section 5 wala canonical URL
apply();
```

Dhyan dene wali baatein:

- **Bahari dabbe (outer) ki height PAKKI ho** — jaise `height:
100dvh` wala page ya fullscreen overlay. Agar outer ki height
  uske andar ke dabbe se banti hai (auto / min-height), to crop
  apni hi unchai naapne lagega aur controls kat jayenge (section
  9, galti #1).
- Player band karne ke liye apna ek chhota sa **X button** (gol,
  halka transparent) frame ke upar-left rakh sakte ho. Bina uske,
  khaaskar mobile par, user phans jayega. Esc key se band karna
  ho to `keydown` par listener alag se.

## 4. Copy-paste: React version (hamara asal code)

Isi project ke do file hain — logic bilkul upar wala hi hai:

- **`src/lib/moviebox.ts`** — constants + `getMovieboxCrop()`
  (upar wale JS ka TypeScript roop; `MOVIEBOX_STAGE_*` naam se).
- **`src/components/MovieboxCroppedFrame.tsx`** — component.
  Core hissa itna sa hai:

```tsx
<div
  ref={outerRef}
  className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden"
>
  <div
    className="relative overflow-hidden bg-black shrink-0"
    style={
      isFullscreen
        ? { width: "100%", height: "100%" }
        : { width: crop.frameWidth, height: crop.height }
    }
  >
    <div
      className="relative"
      style={
        isFullscreen
          ? { width: "100%", height: "100%" }
          : {
              width: crop.stageVisibleWidth,
              height: crop.stageVisibleHeight,
              transform: crop.scale !== 1 ? `scale(${crop.scale})` : undefined,
              transformOrigin: "top left",
            }
      }
    >
      <iframe
        src={src}
        className="absolute border-0"
        style={
          isFullscreen
            ? { top: 0, left: 0, width: "100%", height: "100%" }
            : {
                top: -crop.cropTop,
                left: -crop.cropLeft,
                width: crop.stageWidth,
                height: crop.stageVisibleHeight + crop.cropTop,
              }
        }
        {...(crop.stacked ? {} : { scrolling: "no" })}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen; web-share"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
        sandbox={SANDBOX}
      />
    </div>
  </div>
</div>
```

Size naapna `ResizeObserver` + `window resize` se, fullscreen
state har naap me sync, aur `fullscreenchange` par rAF + 80ms +
250ms par dobara naap — bilkul upar wale JS jaise.

## 5. Watch-page URL kaise banta hai

Har M2Box title ka canonical watch-page URL aisa hota hai:

```
https://m2box.org/movies/{slug}?id={subjectId}&type=/movie/detail&detailSe={season}&detailEp={episode}&lang=en
```

Example: `https://m2box.org/movies/my-demon-hindi-SfaaEeePcfa?id=8598850449111924848&type=/movie/detail&detailSe=&detailEp=&lang=en`

- `slug` = URL ke path wala hissa (`my-demon-hindi-SfaaEeePcfa`),
  `subjectId` = `?id=` wala lamba number. Dono kisi bhi m2box /
  moviebox mirror ke link se nikaal sakte ho (`/movies/...` ya
  `/spa/videoPlayPage/movies/...` dono chalte hain).
- `detailSe` / `detailEp` khali chhodo to site khud pehla episode
  kholti hai. Kisi khaas episode se shuru karna ho to number bharo.
- **Har dub ek alag title hai** — Hindi dub ka apna slug + apna
  subjectId hota hai. Link hamesha usi dub ke page se lo jo
  dikhana hai.
- Link paste karne wale input ke liye chhota sa parser demo file
  (`docs/m2box-sirf-player.html`) me `parseLink()` / `watchUrl()`
  naam se hai. `&amp;` ko `&` me badalna mat bhoolna (chat/HTML se
  copy kiye link me aksar hota hai).

Apni library me title jodna ho to bas ye URL row me save kar do
aur play dabane par isi cropped frame me kholo. Poster/title
auto-lane ka server-side tareeka (khud ka resolver API) is guide
me nahi hai — wo `docs/MOVIEBOX_EMBED.md` me hai.

## 6. sandbox / allow — kyun zaroori hai

```html
sandbox="allow-downloads allow-forms allow-modals allow-popups allow-presentation allow-same-origin
allow-scripts"
```

- `allow-scripts` + `allow-same-origin` — bina inke site ka
  player/episode list chalegi hi nahi.
- **`allow-top-navigation` KABHI MAT DENA.** Ye diya to site (ya
  uski ads) tumhari poori tab ko kisi aur site par bhej sakti hai.
  Yahi ek line tumhare page ko hijack hone se bachati hai.
- `allow` attribute me `fullscreen` + `autoplay` +
  `encrypted-media` + `picture-in-picture` zaroor rakho, warna
  player ke ye button kaam nahi karenge. `allowfullscreen` bhi lagao.
- `referrerpolicy="no-referrer-when-downgrade"` — site ko aam
  browser jaisa mahaul milta hai.

## 7. Mobile wala hisaab alag kyun hai

900px se kam chaudai par site apna layout badal deti hai: episode
list player ke **side ki jagah neeche** aa jati hai. Isliye mobile
par stage/scale nahi chalta:

- Iframe screen ki asal chaudai par khulta hai (scale = 1).
- Upar ka kaat thoda kam: 112 / 108 / 104 (chaudai 768+ / 480+ /
  usse kam par).
- Unchai = player (chaudai × 9/16) + 16 (saans) + 320 (episode
  grid ki jagah), bahari dabbe ki unchai se zyada kabhi nahi.
- **Scroll khula rehta hai** — warna user episode list tak pahuncha
  hi nahi payega. Matlab mobile par scroll karke neeche ka hissa
  dikh sakta hai; ye jaan-boojh kar chhoda gaya samjhota hai.

## 8. Fullscreen ke 3 usool

1. **Fullscreen hote hi crop/scale poora hata do** — teeno dabbe
   100% × 100%, iframe top/left 0. Warna scale hua stage
   fullscreen me kata-bigda dikhega.
2. **`scrolling="no"` fullscreen me bhi mat hatao** (desktop).
   Hataya to lautne par andar ka page khiska hua mil sakta hai
   aur kata hua title dikhne lagta hai.
3. **Fullscreen se lautne par dobara naapo** — `fullscreenchange`
   par turant + `requestAnimationFrame` + 80ms + 250ms par.
   Fullscreen ke dauran viewport bada ho jata hai; purana size
   chipak jaye to dabbe ki unchai badh jati hai aur neeche title
   jhaankne lagta hai (ye bug humne khud jhela hai).

## 9. Jin galtiyon me hum khud phase (inhe mat dohrana)

Har galti ke saath lakshan (kaisa dikhega) aur ilaaj:

1. **Parent ki height auto / min-height rakhi** → _Lakshan:_
   controls aadhe kate hue; fullscreen se lautne par achanak
   title dikhne lagta hai. _Ilaaj:_ bahari dabbe ko **pakki**
   height do (100dvh wala page, fixed overlay). Dabba apni unchai
   apne bachon se naape to "cap" khud par hi lag jata hai aur
   fullscreen use upar ratchet kar deta hai. **Ye sabse chhupi
   hui galti hai.**
2. **Chaudai ke hisaab se seedha hisaab (proportional crop)** →
   _Lakshan:_ har screen size par kaat alag jagah padta hai,
   kahin controls kate, kahin title dikha. _Ilaaj:_ fixed stage +
   CSS scale hi pakka rasta hai.
3. **Stage sanka rakha (1280)** → _Lakshan:_ kam episodes par sab
   theek, lekin 26 episodes wale series me video ke upar kala
   band aur controls gayab. _Ilaaj:_ stage 1536 rakho taaki
   episode guide 5-column chhota bane aur panel player ke saath
   hi khatm ho.
4. **Browser tab se naapa** → _Lakshan:_ play/sound wale button
   left se kate hue. _Ilaaj:_ naap hamesha **iframe ke andar**
   liye gaye screenshot se lo. Tab me sidebar khula hota hai
   (player 245 se), iframe me band (player 129 se).
5. **Andar scroll khula chhoda (desktop)** → _Lakshan:_ user
   scroll karke kata hua menu/title phir dekh leta hai; kabhi
   page khiska hua milta hai. _Ilaaj:_ `scrolling="no"` hamesha
   (fullscreen me bhi).
6. **Fullscreen ke baad purana size chipka raha** → _Lakshan:_
   fullscreen se lautne par dabba lamba, title dikhne laga.
   _Ilaaj:_ section 8 ka usool #3.
7. **Galti se `allow-top-navigation` de diya** → _Lakshan:_ ad/
   click par tumhari poori tab dusri site par chali jati hai.
   _Ilaaj:_ section 6 — ye token kabhi mat do.

## 10. Site layout badle to khud naapne ka tareeka

M2Box kal ko apna design badle to chaar number phir se naapne
honge. Tareeka wahi hai jo humne use kiya:

1. Pehle purane numberon se frame chalao aur **iframe wale page
   ka screenshot** lo (apni site par khule player ka — browser
   tab me khuli m2box.org ka NAHI).
2. Screenshot me ye jagahen (pixel me) dhundo:
   - Player/panel ki **top** (jahan se kaala player dabba shuru)
   - Player ka **left** kinara (time-text se 112 peeche — time
     dhundhna asaan hota hai)
   - Player/panel ki **bottom** (controls ke baad jahan kaala
     dabba khatm)
   - **Title** ki pehli line ki top
     Ye kaam kisi image editor ke ruler se, ya chhote script se
     (rang ke band naap kar) ho jata hai.
3. Screenshot pixel ko stage pixel me badlo:

   ```
   stagePx = screenshotPx × (1416 / screenshot me frame ki kul chaudai px me)
   ```

   (Upar-neeche ke naap me screenshot ka wo hissa ghatao jo frame
   se upar hai — jaise browser ki patti — phir wahi hisaab.)

4. Naye constants rakho:
   - `CROP_TOP` = player top − 3
   - `CROP_LEFT` = player left − 9
   - `VISIBLE_HEIGHT` = (player bottom + 8) − `CROP_TOP`, aur
     pakka karo ki `CROP_TOP + VISIBLE_HEIGHT` title ki top se
     kam se kam 15–20 upar rahe.
5. Do-teen alag titles (movie, chhota series, 26+ episode wala
   series) par test karo — khaaskar lambe series par, wahi sabse
   pehle tootta hai.

## 11. Hadein (limits)

- **Bahut lambe episode wale series (40–50+):** episode panel
  player se lamba ho jata hai aur neeche wale number window ke
  bahar rehte hain (scroll band hai). Ilaaj ke taur par apne
  player me ek chhota sa "Poora Page" wala rasta rakh sakte ho
  (bina crop ke poora page), ya lambe titles ko Direct Video
  (resolver) se chalao.
- **Framing kabhi bhi band ho sakti hai:** ye poora tareeka is
  baat par khada hai ki m2box.org abhi iframe me khulne deta hai.
  Jis din unhone `X-Frame-Options` / CSP `frame-ancestors` laga
  diya, frame blank aane lagega. Us din ke ilaaj: (a) apne server
  se HTML proxy karke headers saaf karo, ya (b) seedha stream
  nikaal kar apne player me chalao — dono ka tareeka
  `docs/MOVIEBOX_EMBED.md` me hai (`/api/moviebox` resolver +
  `/api/moviebox-frame` proxy isi project me bane hue hain).
- **Quality/resume wagera site ke haath me hai:** crop sirf
  dikhne wala hissa kaatta hai; andar poori site chalti hai,
  isliye quality, subtitles, episode badalna sab waisa hi rehta
  hai jaisa m2box.org par.
