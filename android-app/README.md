# Android App — vid (Website → App Wrapper)

Ye aapki **vid website ka official Android app** hai. App ke andar aapki poori
website chalti hai — movies, search, video player, My List — sab kuch same.

## Sabse Aasan Tarika — APK Download Karo (Bina Android Studio)

1. Is repo ko GitHub par push karo (ye branch: `arena/01a0869b-vidd`)
2. GitHub par repo kholo → **Actions** tab → **Build Android APK** → latest run
3. Neeche **Artifacts** me `vid-app-debug-apk` milega → **Download** karo
4. ZIP kholo → `app-debug.apk` milegi → phone me bhejo (WhatsApp/Drive se)
5. Phone me APK kholo → **Install** dabao → app taiyaar! 🎉

> Note: Pehli baar phone bolega "Unknown app" — **Install anyway / Settings →
> Allow from this source** kar dena. Ye normal hai kyunki app Play Store se
> nahi aayi.

## STEP 0 (Sabse Zaruri!) — Apni Website Ka Link Lagao

App ko batana padega ki kaunsi website kholni hai. Sirf **1 line** badalni hai:

**File:** `android-app/app/src/main/res/values/strings.xml`

```xml
<string name="site_url">https://APKI-WEBSITE-KA-LINK-YAHA-LIKHO</string>
```

Yahaan apni live website ka link likho, jaise:

```xml
<string name="site_url">https://vidd.lovable.app</string>
```

Link lagane ke baad dobara push karo → naya APK ban jayega.

## Android Studio Se Khud Build Karna Ho To

1. **Android Studio** install karo (google se free milta hai)
2. **Open** → `android-app` folder select karo
3. Upar **Run ▶** dabao (emulator ya apne phone par)
4. APK file chahiye to: **Build → Build App Bundle(s)/APK(s) → Build APK(s)**
5. APK milegi: `android-app/app/build/outputs/apk/debug/app-debug.apk`

## App Me Kya-Kya Hai

- ✅ Poori website app ke andar (same look, same features)
- ✅ Video fullscreen support (YouTube + direct videos)
- ✅ Pull-to-refresh (neeche kheench kar reload)
- ✅ Back button website me peeche jata hai
- ✅ Splash screen (app kholte hi logo)
- ✅ No-Internet page + Retry button
- ✅ File upload support (thumbnail/photo chunna)
- ✅ Bahar ke links (tel:, mailto:, share) browser/app me khulenge
- ✅ Admin login nahi hai app me → sabko sirf dekhne wala (viewer) mode milega

## Play Store Par Dalna Ho To (Baad Me)

Debug APK sirf direct install ke liye hai. Play Store ke liye **signed AAB**
chahiye hogi — jab ready ho, bol dena, main release signing + AAB build ka
setup bhi karke de dunga.

## Sawaal-Jawaab (Problems Aaye To)

**Q: Android Studio bol raha "gradle-wrapper.jar missing"?**
A: Koi tension nahi — Android Studio me **File → Settings → Build Tools →
Gradle** me jaakar **Gradle JDK = 17** select karo aur **Sync** dabao. Ya
Terminal me `gradle wrapper` chalakar wapas Sync karo. (GitHub Actions wali
build ko iski zarurat nahi — wo apne aap Gradle download karti hai.)

**Q: App khul rahi hai par "Internet nahi lag raha" dikha raha?**
A: 99% chance `site_url` abhi bhi placeholder hai ya link galat hai.
`strings.xml` me apni live website ka sahi link (https samet) lagao.

**Q: Video fullscreen nahi ho raha?**
A: Player ke fullscreen button se hoga. Bahut purane phone (Android 7 ya
neeche) me app install nahi hogi — Android 8.0+ chahiye.

**Q: Website update karunga to app me bhi dikhega?**
A: Haan! App website ko live kholti hai, isliye website par jo badloge wo
app me turant dikhega — naya APK banane ki zarurat nahi.

## Files Ka Map

```
android-app/
├── settings.gradle              → project settings
├── build.gradle                 → top-level build config
├── gradle.properties            → gradle options
├── gradlew / gradlew.bat        → gradle wrapper scripts
├── gradle/wrapper/              → wrapper version (8.7)
├── app/
│   ├── build.gradle             → app name, version, SDK versions
│   └── src/main/
│       ├── AndroidManifest.xml  → permissions + activity
│       ├── java/com/vidd/app/MainActivity.kt  → ⭐ poora app logic
│       └── res/                 → icon, colors, theme, layouts
└── README.md                    → ye file
```
