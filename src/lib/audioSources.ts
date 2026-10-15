import type { AudioSource } from "../data";

/**
 * Extra audio languages for a title.
 *
 * Some anime sources publish one master playlist *per dub* instead of several
 * `#EXT-X-MEDIA` renditions inside one playlist — their own player switches by
 * loading a different URL. Whatever such a source hands out belongs together,
 * which is why a title stores a list of them.
 */

/** Readable names for the languages these sources actually ship. */
export const AUDIO_LANGUAGE_LABELS: Record<string, string> = {
  hi: "हिन्दी (Hindi)",
  ja: "日本語 (Japanese)",
  en: "English",
  ta: "தமிழ் (Tamil)",
  te: "తెలుగు (Telugu)",
  ml: "മലയാളം (Malayalam)",
  kn: "ಕನ್ನಡ (Kannada)",
  bn: "বাংলা (Bengali)",
  mr: "मराठी (Marathi)",
  pa: "ਪੰਜਾਬੀ (Punjabi)",
  ur: "اردو (Urdu)",
  ko: "한국어 (Korean)",
  zh: "中文 (Chinese)",
  es: "Español",
  pt: "Português",
  fr: "Français",
  de: "Deutsch",
  ar: "العربية",
  ru: "Русский",
  id: "Bahasa Indonesia",
  th: "ไทย",
  vi: "Tiếng Việt",
};

export function audioLanguageLabel(lang: string): string {
  const code = (lang || "").toLowerCase().split("-")[0];
  return AUDIO_LANGUAGE_LABELS[code] || lang || "Track";
}

/**
 * Normalise whatever the `audio_sources` column holds (a jsonb array, a JSON
 * string, or junk from an older/edited row) into usable entries. Returns
 * undefined when nothing usable is there, so the player never sees an empty
 * menu.
 */
export function normalizeAudioSources(value: unknown): AudioSource[] | undefined {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(raw)) return undefined;
  const out: AudioSource[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (!url || seen.has(url)) continue;
    const lang = typeof row.lang === "string" ? row.lang.trim().toLowerCase() : "";
    const label =
      typeof row.label === "string" && row.label.trim()
        ? row.label.trim()
        : audioLanguageLabel(lang);
    seen.add(url);
    out.push({ lang, label, url });
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Postgres/PostgREST wording for "that column isn't there". Supabase reports a
 * missing column either as 42703 ("column movies.audio_sources does not exist")
 * or as PGRST204 when its schema cache is stale, so match both. Used to keep the
 * app working on a database where the multi-audio column has not been added yet.
 */
export function isMissingAudioColumnError(error: unknown): boolean {
  const anyError = error as any;
  const text = [anyError?.message, anyError?.details, anyError?.error, anyError?.code, String(anyError ?? "")]
    .filter(Boolean)
    .join(" ");
  return /audio_sources/i.test(text) && /(does not exist|not find|unknown|schema cache|42703|PGRST204)/i.test(text);
}
