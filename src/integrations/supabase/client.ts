import { createClient } from "@supabase/supabase-js";
import { safeLocalStorage } from "../../lib/safe-storage";

// External Supabase project (BYO). Publishable/anon keys are safe in client code.
const SUPABASE_URL = "https://yjakihgnxntjfjvarxmt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_9wUFNHVE1Lm1doB1IkeaZA_kYLeHald";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYWtpaGdueG50amZqdmFyeG10Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MjIwMjQsImV4cCI6MjEwMDE5ODAyNH0.swnTt5ubxf04lkRvaulAhXExdYSAXsRjPuEY1Iv63Do";

// Prefer the new-format publishable key when available; fall back to the JWT anon key.
const apiKey = SUPABASE_PUBLISHABLE_KEY || SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, apiKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Smart TV browsers (Tizen) throw on direct localStorage access in
    // private mode — the safe wrapper falls back to memory storage instead
    // of crashing the module (and the whole app) at import time.
    storage: typeof window !== "undefined" ? safeLocalStorage : undefined,
  },
});

export { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_ANON_KEY };
