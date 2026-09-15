/**
 * Samsung Tizen 5.x exposes an older Chromium browser without the pointer,
 * CSS and YouTube IFrame API behaviour we get on desktop browsers. Keep the
 * check in one place so the layout and player make the same decision.
 */
export function isSamsungTvBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /SMART-TV|Tizen|SamsungBrowser|TV Safari/i.test(navigator.userAgent);
}

/**
 * Broader "TV-like browser" check (Samsung Tizen, LG webOS, Panasonic,
 * Sony/Bravia, generic SMART-TV UA strings). Used to switch on the fixed
 * TV layout, D-pad navigation and the simple YouTube embed. Samsung models
 * such as the UA32T4410 (Tizen 5.5 / Chromium 69) all match.
 */
export function isTvBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /SMART-TV|SMARTTV|Tizen|Web0S|webOS|NetCast|BRAVIA|Viera|HbbTV|GoogleTV|Android TV|TV Safari|HbbTV|Maple|NetFront|Opera TV|TV.*Safari/i.test(
    navigator.userAgent,
  );
}

/**
 * True when the TV layout class is active on <html>. Safe to call from
 * non-React modules (the class is applied once on the client — now also
 * early via tvBoot).
 */
export function isTvLayoutActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("tv-layout");
}

/**
 * Detect old Chromium (<80) which lacks many modern APIs. Used to force
 * simpler rendering paths even on non-TV old browsers (old Android, iOS).
 */
export function isOldChromium(): boolean {
  if (typeof navigator === "undefined") return false;
  var ua = navigator.userAgent;
  var match = ua.match(/Chrome\/(\d+)/);
  if (!match) return false;
  var version = parseInt(match[1], 10);
  return version > 0 && version < 80;
}

/**
 * True for any environment that should use TV-safe fallbacks (TV or old Chromium).
 */
export function shouldUseTvFallbacks(): boolean {
  return isTvBrowser() || isOldChromium() || isTvLayoutActive();
}
