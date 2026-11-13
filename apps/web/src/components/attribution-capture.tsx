"use client";

import { useEffect } from "react";
import { captureAttribution } from "../lib/attribution";

/**
 * Client component that captures UTM parameters and referrer on page load.
 * Stores first-touch (never overwritten) and last-touch (updated on each UTM visit).
 */
export function AttributionCapture() {
  useEffect(() => {
    captureAttribution();
  }, []);

  return null;
}
