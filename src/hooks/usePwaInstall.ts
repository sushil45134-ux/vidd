import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Captures the browser's `beforeinstallprompt` event so the app can offer a
 * one-tap "Install app" button (Android Chrome / Edge / desktop Chromium).
 * Returns nothing on browsers that don't support installation (iOS Safari —
 * users install via Share → Add to Home Screen instead).
 */
export function usePwaInstall() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // keep our own button in control
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    // Already installed (running as standalone app)?
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    ) {
      setInstalled(true);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installEvent) return false;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setInstallEvent(null); // the event can only be used once
    return outcome === "accepted";
  }, [installEvent]);

  return { canInstall: !!installEvent && !installed, installed, promptInstall };
}
