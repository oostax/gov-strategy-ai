"use client";

import { useEffect, useState } from "react";
import { OnboardingScreen } from "./onboarding-screen";

const STORAGE_KEY = "gov-strategy-ai-onboarded";

/**
 * Показывает onboarding при первом визите.
 * После завершения сохраняет флаг в localStorage.
 */
export function OnboardingGate() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      const timer = window.setTimeout(() => setShow(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  if (!show) return null;

  return (
    <OnboardingScreen
      onComplete={() => {
        localStorage.setItem(STORAGE_KEY, "1");
        setShow(false);
      }}
    />
  );
}
