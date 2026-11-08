export type AnalyticsEvent = 'tv_search' | 'tv_result_click' | 'affiliate_click' | 'compatibility_view';
export type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;
export type AnalyticsConsent = 'unknown' | 'granted' | 'denied';

const EVENTS = new Set<AnalyticsEvent>(['tv_search', 'tv_result_click', 'affiliate_click', 'compatibility_view']);
const PARAMS = new Set(['tv_id', 'stand_id', 'status', 'manufacturer', 'query_length', 'result_count', 'match', 'destination_host']);

export const CONSENT_STORAGE_KEY = 'tv-stand:analytics-consent';

export function validMeasurementId(value: string): boolean {
  return /^G-[A-Z0-9]+$/.test(value);
}

/** An allowlist prevents accidental transmission of entered search text or full URLs. */
export function sanitizeAnalyticsParams(params: AnalyticsParams): AnalyticsParams {
  return Object.fromEntries(Object.entries(params).filter(([key, value]) =>
    PARAMS.has(key) && value !== undefined && value !== null
    && (typeof value !== 'number' || Number.isFinite(value)))
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 100) : value]));
}

interface ControllerOptions {
  measurementId: string;
  doNotTrack?: boolean;
  initialConsent?: AnalyticsConsent;
  load: (measurementId: string) => void;
  send: (event: AnalyticsEvent, params: AnalyticsParams) => void;
  enable?: () => void;
  disable?: () => void;
}

export function createAnalyticsController(options: ControllerOptions) {
  const enabled = validMeasurementId(options.measurementId) && !options.doNotTrack;
  let consent: AnalyticsConsent = 'unknown';
  let loaded = false;

  function setConsent(value: AnalyticsConsent) {
    consent = value;
    if (!enabled) return;
    if (consent === 'granted') {
      options.enable?.();
      if (!loaded) {
        options.load(options.measurementId);
        loaded = true;
      }
    } else {
      if (loaded) options.disable?.();
    }
  }

  function track(event: AnalyticsEvent, params: AnalyticsParams = {}) {
    if (!enabled || !EVENTS.has(event) || consent !== 'granted') return;
    const safeParams = sanitizeAnalyticsParams(params);
    options.send(event, safeParams);
  }

  setConsent(options.initialConsent ?? 'unknown');
  return { enabled, setConsent, track, getConsent: () => consent };
}

/** Keep visibility separate from consent: historical views are never replayed. */
export function createCompatibilityViewTracker<T>(canTrack: () => boolean, report: (section: T) => void) {
  const visible = new Set<T>();
  const reported = new Set<T>();

  function reportVisible() {
    if (!canTrack()) return;
    for (const section of visible) {
      if (!reported.has(section)) {
        report(section);
        reported.add(section);
      }
    }
  }

  function updateVisibility(updates: Iterable<readonly [T, boolean]>) {
    for (const [section, isVisible] of updates) {
      if (isVisible) visible.add(section);
      else visible.delete(section);
    }
    reportVisible();
  }

  function setVisible(section: T, isVisible: boolean) {
    updateVisibility([[section, isVisible]]);
  }

  function replaceVisible(sections: Iterable<T>) {
    visible.clear();
    for (const section of sections) visible.add(section);
    reportVisible();
  }

  return { setVisible, updateVisibility, replaceVisible, reportVisible };
}

type AnalyticsController = ReturnType<typeof createAnalyticsController>;
let activeController: AnalyticsController | undefined;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    doNotTrack?: string;
  }
}

export function initializeAnalytics(measurementId: string, initialConsent: AnalyticsConsent = 'unknown') {
  if (typeof window === 'undefined') return undefined;
  activeController = createAnalyticsController({
    measurementId, initialConsent,
    doNotTrack: navigator.doNotTrack === '1' || window.doNotTrack === '1',
    load(id) {
      window.dataLayer = window.dataLayer ?? [];
      window.gtag = function (..._args: unknown[]) { window.dataLayer?.push(arguments); };
      window.gtag('consent', 'default', {
        analytics_storage: 'granted', ad_storage: 'denied',
        ad_user_data: 'denied', ad_personalization: 'denied',
      });
      window.gtag('js', new Date());
      let referrer = '';
      try { const url = new URL(document.referrer); referrer = url.origin + url.pathname; } catch { /* no referrer */ }
      window.gtag('config', id, {
        allow_google_signals: false, allow_ad_personalization_signals: false,
        page_location: window.location.origin + window.location.pathname,
        page_referrer: referrer,
      });
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
      document.head.append(script);
    },
    send(event, params) { window.gtag?.('event', event, params); },
    enable() {
      (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = false;
      window.gtag?.('consent', 'update', { analytics_storage: 'granted' });
    },
    disable() {
      (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = true;
      window.gtag?.('consent', 'update', { analytics_storage: 'denied' });
    },
  });
  return activeController;
}

export function trackEvent(name: AnalyticsEvent, params: AnalyticsParams = {}) {
  activeController?.track(name, params);
}
