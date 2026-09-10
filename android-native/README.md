# vid — Native Android App (Kotlin + Jetpack Compose) 🚀

> **v2.0.2** — video player (IFrame API, sahi size) + HD thumbnails (maxres) + 16:9 cards.
> **v2.0.1** — startup crash fixed + stable signature (ab har update seedha install hoga).

Ye aapki website ka **proper native app** hai — 100% Kotlin me likha hua,
Netflix-style premium UI ke saath. Data wahi Supabase se aata hai jo website
use karti hai, isliye website par jo video add karoge wo app me bhi dikhega.

## Features (Full Package 📦)

- ✅ **Premium UI** — hero carousel (auto-slide), rows, bottom tabs
- ✅ **Home / Browse / Search / My List / Downloads** — 5 tabs
- ✅ **In-app video player** — YouTube + direct video + embeds, fullscreen,
  next/prev episode, Up Next list
- ✅ **Series support** — seasons + episodes (website jaisa)
- ✅ **⬇️ Offline download** — direct videos (mp4/webm) download karke bina
  internet ke dekho
- ✅ **🔔 Notifications** — naya video aate hi khabar (har 6 ghante me check)
- ✅ **My List + Likes** — phone me save rehta hai
- ✅ **Share** button, pull... (refresh button), dark Netflix theme

## 2 Zaruri Baatein (Sach-Sach)

1. **YouTube videos download NAHI hote** — ye YouTube ke rules ke khilaaf hai
   aur technically possible nahi. Sirf direct mp4/webm wale videos download
   honge. YouTube wale internet par chalenge.
2. **Notifications thodi late ho sakti hain** — Android battery bachane ke liye
   background check ko delay kar deta hai (6 ghante ±). Phone ki Settings →
   Apps → vid → Battery → **Unrestricted** karne se time par aayengi.

## APK Download (Bina Android Studio)

1. GitHub repo → **Actions** tab → **Build Native App APK** → latest run
2. Neeche **Artifacts** → `vid-native-apk` → Download
3. ZIP kholo → `app-debug.apk` → phone me bhejo → **Install**
4. Purani wrapper app installed hai to ye uske **upar update** ho jayegi
   (same package ID, version 2.0) — alag se uninstall karne ki zarurat nahi.

> Pehli baar "Unknown app" bole to **Install anyway** kar dena.

## Android Studio Se Build

1. Android Studio me **Open** → `android-native` folder
2. Sync hone do → **Run ▶** ya **Build → Build APK(s)**
3. APK: `android-native/app/build/outputs/apk/debug/app-debug.apk`

## Code Ka Map

```
android-native/app/src/main/java/com/vidd/app/
├── MainActivity.kt      → app ka entry point + notification permission
├── ViddApp.kt           → startup: channels + background check schedule
├── data/
│   ├── Supa.kt          → Supabase connection (Retrofit)
│   ├── Models.kt        → Movie/Season/Row + JSON parsing + grouping
│   ├── Repo.kt          → poori library ka state (sab screens yahi se)
│   ├── Store.kt         → My List, Likes, Downloads, hisaab (DataStore)
│   ├── Down.kt          → DownloadManager helper (offline videos)
│   ├── Notify.kt        → notifications
│   └── DownloadReceiver.kt → download poora hone ki khabar
├── work/
│   └── RefreshWorker.kt → har 6 ghante me naye videos check
└── ui/
    ├── Theme.kt         → Netflix dark theme
    ├── Comps.kt         → cards, rows, image, buttons (reusable)
    ├── Nav.kt           → bottom tabs + navigation
    ├── Home.kt          → hero carousel + rows
    ├── Browse.kt        → Movies/Anime/Cartoon/TV/New tabs
    ├── Search.kt        → search
    ├── Details.kt       → details + episodes + download
    ├── Player.kt        → ExoPlayer + YouTube + embed player
    ├── MyList.kt        → saved list
    └── Downloads.kt     → offline videos
```
