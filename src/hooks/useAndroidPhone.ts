import { useEffect, useState } from "react";

/** Android handset only (not Android TV). Kept separate from the generic mobile
 * breakpoint so phone-specific artwork changes never alter iPhone, desktop or TV. */
export function useAndroidPhone() {
  const [isAndroidPhone, setIsAndroidPhone] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    setIsAndroidPhone(/Android/i.test(ua) && !/Android TV|SMART-TV|TV;/i.test(ua));
  }, []);

  return isAndroidPhone;
}
