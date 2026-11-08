import { describe, expect, it, vi } from 'vitest';
import { createAnalyticsController, createCompatibilityViewTracker, sanitizeAnalyticsParams, validMeasurementId } from '../src/lib/analytics';

function setup(measurementId = 'G-FIXTURE123', doNotTrack = false) {
  const load = vi.fn();
  const send = vi.fn();
  const enable = vi.fn();
  const disable = vi.fn();
  const controller = createAnalyticsController({ measurementId, doNotTrack, load, send, enable, disable });
  return { controller, load, send, enable, disable };
}

describe('optional GA4 and consent', () => {
  it.each(['', 'G-fixture', 'G-X<script>', 'https://example.invalid'])('never loads or sends for an invalid ID: %s', id => {
    const { controller, load, send } = setup(id);
    controller.setConsent('granted');
    controller.track('tv_search', { query_length: 8 });
    expect(controller.enabled).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('honors Do Not Track even after consent', () => {
    const { controller, load, send } = setup('G-FIXTURE123', true);
    controller.setConsent('granted');
    controller.track('affiliate_click', { stand_id: 'fixture-stand' });
    expect(load).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('waits for consent without replaying events collected before the choice', () => {
    const { controller, load, send } = setup();
    controller.track('tv_search', { query_length: 8 });
    controller.track('compatibility_view', { tv_id: 'fixture-tv', status: 'candidate' });
    expect(load).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    controller.setConsent('granted');
    expect(load).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    controller.track('compatibility_view', { tv_id: 'fixture-tv', status: 'candidate' });
    expect(send).toHaveBeenCalledExactlyOnceWith('compatibility_view', { tv_id: 'fixture-tv', status: 'candidate' });
    controller.track('tv_result_click', { tv_id: 'fixture-tv', match: 'exact' });
    expect(send).toHaveBeenLastCalledWith('tv_result_click', { tv_id: 'fixture-tv', match: 'exact' });
  });

  it('blocks rejected and revoked events, and can grant again', () => {
    const { controller, load, send, enable, disable } = setup();
    controller.track('compatibility_view', { tv_id: 'fixture-tv' });
    controller.setConsent('denied');
    controller.setConsent('granted');
    expect(send).not.toHaveBeenCalled();
    controller.setConsent('denied');
    controller.track('affiliate_click', { stand_id: 'fixture-stand' });
    expect(disable).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    controller.setConsent('granted');
    controller.track('tv_search', { query_length: 1 });
    expect(enable).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it('validates IDs and removes raw query strings, full URLs, and nonfinite numbers', () => {
    expect(validMeasurementId('G-FIXTURE123')).toBe(true);
    expect(sanitizeAnalyticsParams({
      query: 'someone@example.invalid', product_url: 'https://example.invalid/?secret=x',
      query_length: 12, result_count: Number.NaN, tv_id: 'fixture-tv', unused: undefined,
    })).toEqual({ query_length: 12, tv_id: 'fixture-tv' });
  });
});

describe('compatibility sections and consent timing', () => {
  it('reports a still-visible section after consent exactly once, without replaying scrolled-away sections', () => {
    const { controller, send } = setup();
    const tracker = createCompatibilityViewTracker<string>(
      () => controller.enabled && controller.getConsent() === 'granted',
      section => controller.track('compatibility_view', { tv_id: 'fixture-tv', status: section }),
    );
    tracker.setVisible('confirmed', true);
    tracker.setVisible('confirmed', false);
    tracker.setVisible('candidate', true);
    expect(send).not.toHaveBeenCalled();
    controller.setConsent('granted');
    tracker.reportVisible();
    expect(send).toHaveBeenCalledExactlyOnceWith('compatibility_view', { tv_id: 'fixture-tv', status: 'candidate' });
    tracker.setVisible('candidate', false);
    tracker.setVisible('candidate', true);
    tracker.reportVisible();
    expect(send).toHaveBeenCalledOnce();
    tracker.setVisible('confirmed', true);
    expect(send).toHaveBeenLastCalledWith('compatibility_view', { tv_id: 'fixture-tv', status: 'confirmed' });
  });

  it('never replays sections viewed only while denied, or marks an unconsented section as reported', () => {
    const { controller, send } = setup();
    const tracker = createCompatibilityViewTracker<string>(
      () => controller.enabled && controller.getConsent() === 'granted',
      section => controller.track('compatibility_view', { tv_id: 'fixture-tv', status: section }),
    );
    controller.setConsent('denied');
    tracker.setVisible('unknown', true);
    tracker.setVisible('unknown', false);
    controller.setConsent('granted');
    tracker.reportVisible();
    expect(send).not.toHaveBeenCalled();
    tracker.setVisible('unknown', true);
    expect(send).toHaveBeenCalledOnce();
  });

  it('keeps hidden-tab views unreported until the tab becomes visible', () => {
    const report = vi.fn();
    let tabVisible = false;
    const tracker = createCompatibilityViewTracker(() => tabVisible, report);
    tracker.setVisible('fixture-section', true);
    tracker.reportVisible();
    expect(report).not.toHaveBeenCalled();
    tabVisible = true;
    tracker.reportVisible();
    expect(report).toHaveBeenCalledExactlyOnceWith('fixture-section');
  });

  it('refreshes viewport positions atomically when consent arrives', () => {
    const report = vi.fn();
    let consent = false;
    const tracker = createCompatibilityViewTracker(() => consent, report);
    tracker.setVisible('formerly-visible', true);
    consent = true;
    tracker.replaceVisible(['currently-visible']);
    expect(report).toHaveBeenCalledExactlyOnceWith('currently-visible');
  });
});
