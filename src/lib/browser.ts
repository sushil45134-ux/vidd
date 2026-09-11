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
  return /SMART-TV|SMARTTV|Tizen|Web0S|webOS|NetCast|BRAVIA|Viera|HbbTV|GoogleTV|Android TV|TV Safari/i.test(
    navigator.userAgent,
  );
}

/**
 * True when the TV layout class is active on <html>. Safe to call from
 * non-React modules (the class is applied once on the client).
 */
export function isTvLayoutActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("tv-layout");
}
