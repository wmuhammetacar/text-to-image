"use client";

export type ProductEventName =
  | "first_generation_created"
  | "first_public_share"
  | "first_remix"
  | "first_upscale"
  | "first_favorite"
  | "gallery_opened"
  | "share_page_opened"
  | "remix_cta_clicked"
  | "starter_prompt_used"
  | "share_clicked"
  | "remix_started"
  | "remix_completed"
  | "suggestion_used"
  | "return_session_started"
  | "creator_viewed"
  | "experiment_exposed"
  | "paywall_shown"
  | "checkout_started"
  | "checkout_redirected"
  | "checkout_failed"
  | "funnel_generate_submitted"
  | "funnel_generate_completed"
  | "funnel_share_completed"
  | "funnel_remix_completed";

export interface ProductEventPayload {
  [key: string]: string | number | boolean | null | undefined;
}

interface ProductEventSink {
  capture: (eventName: ProductEventName, payload: ProductEventPayload) => void;
}

interface ProductEventStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

interface BrowserWithPosthog extends Window {
  posthog?: {
    capture?: (eventName: string, payload?: Record<string, unknown>) => void;
  };
}

function createBrowserSink(): ProductEventSink {
  return {
    capture: (eventName, payload) => {
      if (typeof window === "undefined") {
        return;
      }

      const browser = window as BrowserWithPosthog;
      browser.posthog?.capture?.(eventName, payload);
      window.dispatchEvent(
        new CustomEvent("pixora:product-event", {
          detail: {
            event: eventName,
            payload,
          },
        }),
      );
    },
  };
}

function createBrowserStore(): ProductEventStore | null {
  if (typeof window === "undefined") {
    return null;
  }

  return {
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => {
      window.localStorage.setItem(key, value);
    },
  };
}

export function createProductEventTracker(params: {
  sink: ProductEventSink;
  store: ProductEventStore | null;
  keyPrefix?: string;
}) {
  const prefix = params.keyPrefix ?? "pixora:event_once:";

  const track = (eventName: ProductEventName, payload: ProductEventPayload = {}): void => {
    params.sink.capture(eventName, payload);
  };

  const trackOnce = (eventName: ProductEventName, payload: ProductEventPayload = {}): void => {
    if (params.store === null) {
      track(eventName, payload);
      return;
    }

    const key = `${prefix}${eventName}`;
    if (params.store.getItem(key) === "1") {
      return;
    }

    params.store.setItem(key, "1");
    track(eventName, payload);
  };

  return {
    track,
    trackOnce,
  };
}

const browserTracker = createProductEventTracker({
  sink: createBrowserSink(),
  store: createBrowserStore(),
});

export function trackProductEvent(
  eventName: ProductEventName,
  payload: ProductEventPayload = {},
): void {
  browserTracker.track(eventName, payload);
}

export function trackProductEventOnce(
  eventName: ProductEventName,
  payload: ProductEventPayload = {},
): void {
  browserTracker.trackOnce(eventName, payload);
}
