import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { isTvBrowser } from "../lib/browser";
import { TV_BOOT_SCRIPT } from "../lib/tvBoot";
import { initSpatialNavigation } from "../lib/spatialNav";
import { Analytics } from "@vercel/analytics/react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function BrowserAnalytics() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // TV browsers do not need Web Analytics. Avoid adding another third-party
    // classic script to an already fragile legacy engine; a failed or modern
    // response can surface as `Unexpected token 'export'` on the TV.
    if (isTvBrowser() || document.documentElement.classList.contains("tv-layout")) return;
    setEnabled(true);
  }, []);

  return enabled ? <Analytics /> : null;
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const [tvRecovery, setTvRecovery] = useState(false);

  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  useEffect(() => {
    // A TV can reach this boundary when a deferred chunk or a provider-side
    // script fails after SSR has already painted the catalogue. Retrying the
    // same modern bundle just recreates the white error page, so hand the TV
    // to the dependency-free SSR mode instead. Keep the first render stable
    // for SSR/hydration, then redirect only after the client has identified a
    // TV. Desktop/mobile error handling stays exactly as before.
    const isTv = isTvBrowser() || document.documentElement.classList.contains("tv-layout");
    if (!isTv) return;
    setTvRecovery(true);

    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("tv") === "1") return;
      url.searchParams.set("tv", "1");
      window.location.replace(url.toString());
    } catch {
      // The visible Simple TV mode link below remains available if navigation
      // is blocked by the TV shell.
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {tvRecovery
            ? "The TV browser is opening the simple mode so the library stays usable."
            : "Something went wrong on our end. You can try refreshing or head back home."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
          {tvRecovery && (
            <a
              href="/?tv=1"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Open simple TV mode
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lovable App" },
      { name: "description", content: "Lovable Generated Project" },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Lovable App" },
      { property: "og:description", content: "Lovable Generated Project" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "theme-color", content: "#0b0b0f" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
      { name: "apple-mobile-web-app-title", content: "vid" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "preconnect", href: "https://img.youtube.com" },
      { rel: "preconnect", href: "https://i.ytimg.com" },
      { rel: "preconnect", href: "https://image.tmdb.org" },
      { rel: "preconnect", href: "https://yjakihgnxntjfjvarxmt.supabase.co" },
      { rel: "dns-prefetch", href: "https://s4.anilist.co" },
      { rel: "dns-prefetch", href: "https://m.media-amazon.com" },
      { rel: "dns-prefetch", href: "https://static.tvmaze.com" },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      {
        rel: "apple-touch-icon",
        href: "/icons/apple-touch-icon.png",
        sizes: "180x180",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  // The TV boot script adds tv-layout before hydration so legacy CSS is
  // active on the first frame. React should not treat that intentional
  // pre-hydration class as a broken server/client render.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {/* Must run BEFORE the app bundle: an inline classic script executes
            before any deferred module script, so globalThis & friends exist
            on Chromium 69 (Tizen 5.5) before the Supabase client evaluates.
            src/server.ts also injects this tag for SSR responses that do not
            come through this shell; the marker keeps those paths idempotent. */}
        <script data-tv-boot="1" dangerouslySetInnerHTML={{ __html: TV_BOOT_SCRIPT }} />
        {/* Fallback for very old TVs (Chrome <61) that don't support type=module.
            The SSR HTML will still be visible, but we show a helpful banner
            and keep D-pad focus working via the boot script's early polyfills. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var ua=navigator.userAgent||"";var isTv=/SMART-TV|SMARTTV|Tizen|Web0S|webOS|NetCast|BRAVIA|Viera|HbbTV|GoogleTV|Android TV|TV Safari/i.test(ua);if(!isTv)return;var supportsModule='noModule' in document.createElement('script');if(!supportsModule){document.addEventListener('DOMContentLoaded',function(){try{var b=document.createElement('div');b.setAttribute('data-tv-old-banner','1');b.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:2147483646;background:#ff6a00;color:#000;padding:14px 18px;text-align:center;font:600 14px/1.4 Arial,sans-serif;';b.textContent='Aapka TV browser purana hai — library neeche dikhegi. Best experience ke liye TV software update karein ya Fire TV Stick / Chromecast use karein.';document.body.appendChild(b);}catch(e){}});}}catch(e){}})();`,
          }}
        />
        {children}
        {/* Web Analytics runs only after the browser is confirmed non-TV. */}
        <BrowserAnalytics />
        <Scripts />
        {/* If module scripts failed to load (old TV), ensure at least first focusable gets focus */}
        <script
          dangerouslySetInnerHTML={{
            __html: `setTimeout(function(){try{var ae=document.activeElement;if(ae&&ae!==document.body)return;var f=document.querySelector('button, a[href], [tabindex="0"]');if(f)f.focus();}catch(e){}},2000);`,
          }}
        />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  useEffect(() => {
    // Tizen 5.5 does not support several desktop-only hover/CSS behaviours.
    // Expose one stable class for TV-specific layout rules without changing
    // the desktop/mobile experience. The boot script already adds tv-layout
    // early, but we toggle here as well for SPA navigations and for browsers
    // where the boot script ran before <html> existed.
    const isTv = isTvBrowser();
    document.documentElement.classList.toggle("tv-layout", isTv);

    if (isTv) {
      // TV browsers frequently report a small fixed viewport (some Tizen
      // sets expose 960x540 CSS px). Pin the layout viewport to 1280 so the
      // UI scales out and looks exactly like the desktop site on a laptop.
      // Always pin on TV — not just when innerWidth < 1200 — because some
      // Tizen sets report 1920 but still need the TV layout.
      try {
        const meta = document.querySelector('meta[name="viewport"]');
        if (meta) {
          meta.setAttribute("content", "width=1280, initial-scale=1");
        }
      } catch (_) {
        /* ignore */
      }

      // D-pad arrows + remote BACK key support.
      const cleanupNav = initSpatialNavigation();

      // On TV, set initial focus to the first focusable element so the
      // remote immediately works without an extra click. Delay a bit so
      // the hero and rows have mounted.
      const focusTimer = window.setTimeout(() => {
        try {
          const firstFocusable = document.querySelector<HTMLElement>(
            'button, a[href], [tabindex="0"]',
          );
          if (firstFocusable && document.activeElement === document.body) {
            firstFocusable.focus({ preventScroll: true } as any);
          }
        } catch (_) {
          /* ignore */
        }
      }, 800);

      return () => {
        window.clearTimeout(focusTimer);
        cleanupNav();
      };
    }

    // Register the PWA service worker (installable app on Android/desktop).
    // Never on TV — Tizen's service worker implementation is buggy and can
    // cache a broken shell, plus it adds unnecessary CPU overhead.
    if (!isTv && "serviceWorker" in navigator) {
      const register = () => {
        navigator.serviceWorker.register("/sw.js").catch(() => {
          /* not fatal — app still works without offline support */
        });
      };
      if (document.readyState === "complete") register();
      else {
        window.addEventListener("load", register, { once: true });
        return () => window.removeEventListener("load", register);
      }
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
