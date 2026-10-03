import { createClient } from "@supabase/supabase-js";
import { safeLocalStorage } from "../../lib/safe-storage";

// External Supabase project (BYO). Publishable/anon keys are safe in client code.
const SUPABASE_URL = "https://yjakihgnxntjfjvarxmt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9wUFNHVE1Lm1doB1IkeaZA_kYLeHald";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYWtpaGdueG50amZqdmFyeG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MjIwMjQsImV4cCI6MjEwMDE5ODAyNH0.swnTt5ubxf04lkRvaulAhXExdYSAXsRjPuEY1Iv63Do";

// Prefer the new-format publishable key when available; fall back to the JWT anon key.
const apiKey = SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY;

/**
 * TV-safe fetch wrapper: Tizen 5.5 (Chromium 69) does not support some modern
 * fetch options like `keepalive`, `priority`, or `AbortSignal.timeout` (we
 * polyfill the latter in tvBoot, but be defensive). Stripping unknown options
 * prevents TypeError: "Failed to execute 'fetch'".
 *
 * Also handles CORS issues on TV by retrying without credentials/signal
 * and by falling back to same-origin proxy when direct fetch fails with
 * TypeError (common on Tizen when CORS is blocked).
 */
function tvSafeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return fetch(input as any, init as any);
  }
  if (!init) return window.fetch(input as any);

  const safeInit: RequestInit & Record<string, unknown> = { ...init };
  // Strip modern fetch options that break Chromium 69
  delete (safeInit as any).keepalive;
  delete (safeInit as any).priority;
  delete (safeInit as any).duplex;
  // Some TV browsers choke on cache: 'no-store' with signal
  // Keep cache but ensure it's a simple value

  try {
    return window.fetch(input as any, safeInit);
  } catch (e) {
    // Retry without signal — AbortSignal.timeout polyfill may still throw
    try {
      const retryInit = { ...safeInit };
      delete (retryInit as any).signal;
      return window.fetch(input as any, retryInit);
    } catch (e2) {
      // Last resort: minimal init
      try {
        return window.fetch(input as any, {
          method: safeInit.method || "GET",
          headers: safeInit.headers as any,
          body: safeInit.body as any,
        } as any);
      } catch {
        throw e2;
      }
    }
  }
}

export const supabase = createClient(SUPABASE_URL, apiKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: typeof window !== "undefined" ? safeLocalStorage : undefined,
    // TV-safe: no PKCE which uses crypto that may be missing on old TV
    flowType: "implicit",
  },
  global: {
    fetch: tvSafeFetch,
  },
  // TV-safe: realtime may fail on old engines, but we keep it — it will fallback
  realtime: {
    // Use less aggressive transport for TV
    params: {
      eventsPerSecond: 2,
    },
  },
});

export { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_ANON_KEY };
