import {
  CONSENT_STORAGE_KEY, createCompatibilityViewTracker, initializeAnalytics, trackEvent,
  type AnalyticsConsent,
} from '../lib/analytics';

const measurementId = document.querySelector<HTMLMetaElement>('meta[name="ga4-measurement-id"]')?.content ?? '';
let initialConsent: AnalyticsConsent = 'unknown';
try {
  const saved = localStorage.getItem(CONSENT_STORAGE_KEY);
  if (saved === 'granted' || saved === 'denied') initialConsent = saved;
} catch { /* Browsers can disable storage; the current-page choice still works. */ }

const analytics = initializeAnalytics(measurementId, initialConsent);
const banners = document.querySelectorAll<HTMLElement>('[data-analytics-consent-banner]');
function updateBanners() {
  banners.forEach(banner => { banner.hidden = !analytics?.enabled || analytics.getConsent() !== 'unknown'; });
}
updateBanners();

document.querySelectorAll<HTMLButtonElement>('[data-analytics-consent]').forEach(button => {
  button.addEventListener('click', () => {
    const choice: AnalyticsConsent = button.dataset.analyticsConsent === 'allow' ? 'granted' : 'denied';
    try { localStorage.setItem(CONSENT_STORAGE_KEY, choice); } catch { /* current-page choice */ }
    analytics?.setConsent(choice);
    updateBanners();
    // A section may have entered the viewport before the visitor chose consent.
    // Read its current position instead of replaying an earlier observation.
    reportVisibleSections();
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-analytics-settings]').forEach(button => {
  button.addEventListener('click', () => {
    analytics?.setConsent('unknown');
    updateBanners();
  });
});

document.addEventListener('click', event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const resultLink = target.closest<HTMLAnchorElement>('a[data-tv-result-link]');
  if (resultLink) {
    trackEvent('tv_result_click', {
      tv_id: resultLink.dataset.tvId, manufacturer: resultLink.dataset.manufacturer, match: 'selection',
    });
  }
  const mallLink = target.closest<HTMLAnchorElement>('a[data-mall-link]');
  if (mallLink) {
    trackEvent('mall_click', {
      tv_id: mallLink.dataset.tvId, stand_id: mallLink.dataset.standId, status: mallLink.dataset.status, mall: mallLink.dataset.mallLink,
    });
    return;
  }
  const link = target.closest<HTMLAnchorElement>('a[data-affiliate-link]');
  if (!link) return;
  trackEvent('affiliate_click', {
    tv_id: link.dataset.tvId, stand_id: link.dataset.standId, status: link.dataset.status,
    destination_host: new URL(link.href).hostname,
  });
});

const sections = document.querySelectorAll<HTMLElement>('[data-compatibility-view]');
const viewTracker = createCompatibilityViewTracker<HTMLElement>(
  () => !!analytics?.enabled && analytics.getConsent() === 'granted' && !document.hidden,
  section => trackEvent('compatibility_view', { tv_id: section.dataset.tvId, status: section.dataset.status }),
);
function reportVisibleSections() {
  const visible: HTMLElement[] = [];
  sections.forEach(section => {
    const rect = section.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.top < window.innerHeight
      && rect.right > 0 && rect.left < window.innerWidth) visible.push(section);
  });
  viewTracker.replaceVisible(visible);
}
if (typeof IntersectionObserver === 'function') {
  const observer = new IntersectionObserver(entries => {
    viewTracker.updateVisibility(entries.map(entry =>
      [entry.target as HTMLElement, entry.isIntersecting && entry.intersectionRatio > 0] as const));
  }, { threshold: [0, 0.15] });
  sections.forEach(section => observer.observe(section));
} else {
  let scheduled = false;
  const scheduleScan = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; reportVisibleSections(); });
  };
  window.addEventListener('scroll', scheduleScan, { passive: true });
  window.addEventListener('resize', scheduleScan);
}
document.addEventListener('visibilitychange', reportVisibleSections);
reportVisibleSections();
