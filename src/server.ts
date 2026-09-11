import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { renderTvBootScriptTag, TV_BOOT_MARKER } from "./lib/tvBoot";

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

const TV_BOOT_TAG_PATTERN = new RegExp(`<script\\b[^>]*\\b${TV_BOOT_MARKER}(?:\\s*=|\\s|>)`, "i");

/**
 * Put the legacy-browser boot payload in every SSR HTML response. The root
 * shell also renders the tag, so the marker check is intentional: it keeps
 * this server wrapper safe when both paths participate in rendering and when
 * a response is passed through more than once.
 */
export async function injectTvBootScript(response: Response): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  const isHtmlContentType = /text\/html|application\/xhtml\+xml/i.test(contentType);
  // Read a clone so an already-correct response can be returned unchanged.
  // TanStack sets content-type, but the body sniff also covers adapters that
  // return an HTML Response without that header (or with text/plain).
  const html = await response.clone().text();
  const looksLikeHtml = /^\s*(?:<!doctype\s+html\b|<html\b|<body\b)/i.test(html);
  if (!isHtmlContentType && !looksLikeHtml) return response;
  if (TV_BOOT_TAG_PATTERN.test(html)) return response;

  const scriptTag = renderTvBootScriptTag();
  const bodyTag = /<body\b[^>]*>/i.exec(html);
  let injectedHtml: string;
  if (bodyTag) {
    const bodyEnd = bodyTag.index + bodyTag[0].length;
    injectedHtml = `${html.slice(0, bodyEnd)}\n${scriptTag}\n${html.slice(bodyEnd)}`;
  } else {
    // SSR routes normally have a body. A fragment/error response still gets
    // the polyfill before any markup so it remains boot-safe.
    injectedHtml = `${scriptTag}\n${html}`;
  }

  const headers = new Headers(response.headers);
  // The body grew and is no longer the original encoded representation.
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
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
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
      const normalized = await normalizeCatastrophicSsrResponse(response);
      return await injectTvBootScript(normalized);
    } catch (error) {
      console.error(error);
      return await injectTvBootScript(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
