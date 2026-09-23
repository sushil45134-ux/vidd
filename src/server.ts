import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { renderTvBootScriptTag, TV_BOOT_MARKER } from "./lib/tvBoot";
import { applyTvDocumentTweaks, isTvUserAgent } from "./lib/tvDocument";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// The pattern is intentionally built from a string because the marker is
// shared with the inline boot tag. Keep the escapes at the RegExp level (one
// backslash in the resulting expression); four backslashes here would look
// for the literal characters "\\b" and would inject the boot payload twice.
const TV_BOOT_TAG_PATTERN = new RegExp(
  String.raw`<script\b[^>]*\b${TV_BOOT_MARKER}(?:\s*=|\s|>)`,
  "i",
);

/**
 * Put the legacy-browser boot payload in every SSR HTML response and apply the
 * TV document fixes (see src/lib/tvDocument.ts).
 *
 * The boot tag is normally rendered by the root shell, so the two concerns are
 * deliberately separate here:
 *
 *   • the boot tag is only injected when it is missing (that marker check is
 *     what makes this wrapper safe for retried/streamed responses), while
 *   • the TV tweaks are always evaluated, because the shell-rendered document
 *     is exactly the one a Tizen TV receives.
 *
 * Returning the original response untouched when nothing changed keeps the
 * desktop/mobile body byte-for-byte identical (no re-encoding, no dropped
 * headers).
 */
export async function injectTvBootScript(response: Response, request?: Request): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  const isHtmlContentType = /text\/html|application\/xhtml\+xml/i.test(contentType);
  // Read a clone so an already-correct response can be returned unchanged.
  // TanStack sets content-type, but the body sniff also covers adapters that
  // return an HTML Response without that header (or with text/plain).
  const html = await response.clone().text();
  const looksLikeHtml = /^\s*(?:<!doctype\s+html\b|<html\b|<body\b)/i.test(html);
  if (!isHtmlContentType && !looksLikeHtml) return response;

  const userAgent = request?.headers.get("user-agent") ?? "";
  const forceStatic = request ? new URL(request.url).searchParams.get("tv") === "1" : false;
  const tvRecovery = wantsTvRecovery(request);

  // TanStack Start's middleware can return the friendly 500 HTML directly,
  // rather than throwing for the outer normalizer to catch. On a TV that page
  // must still offer the static recovery path instead of trapping the user in
  // the same white error screen.
  let injectedHtml =
    response.status >= 500 && tvRecovery && /This page didn't load/i.test(html)
      ? renderErrorPage({ tv: true })
      : html;
  if (!TV_BOOT_TAG_PATTERN.test(html)) {
    const scriptTag = renderTvBootScriptTag();
    const bodyTag = /<body\b[^>]*>/i.exec(html);
    if (bodyTag) {
      const bodyEnd = bodyTag.index + bodyTag[0].length;
      injectedHtml = `${html.slice(0, bodyEnd)}\n${scriptTag}\n${html.slice(bodyEnd)}`;
    } else {
      // SSR routes normally have a body. A fragment/error response still gets
      // the polyfill before any markup so it remains boot-safe.
      injectedHtml = `${scriptTag}\n${html}`;
    }
  }

  injectedHtml = applyTvDocumentTweaks(injectedHtml, { userAgent, forceStatic });
  if (injectedHtml === html) return response;

  const headers = new Headers(response.headers);
  // The body changed and is no longer the original encoded representation.
  headers.delete("content-length");
  headers.delete("content-encoding");
  if (!isHtmlContentType) headers.set("content-type", "text/html; charset=utf-8");

  return new Response(injectedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
function wantsTvRecovery(request?: Request): boolean {
  if (!request) return false;
  if (isTvUserAgent(request.headers.get("user-agent"))) return true;
  try {
    return new URL(request.url).searchParams.get("tv") === "1";
  } catch {
    return false;
  }
}

async function normalizeCatastrophicSsrResponse(
  response: Response,
  request?: Request,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage({ tv: wantsTvRecovery(request) }), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response, request);
      return await injectTvBootScript(normalized, request);
    } catch (error) {
      console.error(error);
      return await injectTvBootScript(
        new Response(renderErrorPage({ tv: wantsTvRecovery(request) }), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        request,
      );
    }
  },
};
