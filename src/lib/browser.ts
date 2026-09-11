/**
 * Samsung Tizen 5.x exposes an older Chromium browser without the pointer,
 * CSS and YouTube IFrame API behaviour we get on desktop browsers. Keep the
 * check in one place so the layout and player make the same decision.
 */
export function isSamsungTvBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /SMART-TV|Tizen|SamsungBrowser|TV Safari/i.test(navigator.userAgent);
}
