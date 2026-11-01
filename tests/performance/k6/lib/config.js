// All settings are env-configurable:  k6 run -e BASE_URL=... -e PROFILE=smoke main.js
// No real credentials live here. API_KEY below is a SYNTHETIC key seeded only into the local test DB.
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

export const BASE        = (__ENV.BASE_URL || 'http://app:80').replace(/\/$/, '');
export const SHOP        = __ENV.SHOP || 'perf-test.myshopify.com';
export const QUOTA_SHOP  = __ENV.QUOTA_SHOP || 'perf-quota.myshopify.com';
export const API_KEY     = __ENV.API_KEY || 'tf_perf_test_key_0001';
export const PROFILE     = __ENV.PROFILE || 'smoke';
export const OUT_DIR     = __ENV.OUT_DIR || '/work/../../reports/results/adhoc';

// Workload knobs
export const POLL_MS      = num(__ENV.POLL_MS, 2500);       // widget polls every 2.5 s (tryon-widget.js)
export const DEADLINE_MS  = num(__ENV.DEADLINE_MS, 190000); // widget gives up after 190 s
export const MAX_VUS      = num(__ENV.MAX_VUS, 50);         // hard safety cap on virtual users
export const DUR_SCALE    = num(__ENV.DUR_SCALE, 1);        // multiply every stage duration (e.g. 0.25 = quick run)
export const RATE_SCALE   = num(__ENV.RATE_SCALE, 1);       // multiply journey arrival rates
export const SOAK_MIN     = num(__ENV.SOAK_MIN, 30);
export const EXTRA_POLLS  = num(__ENV.EXTRA_POLLS, 0);      // polls AFTER completion (idempotency test)
export const QUOTA_N      = num(__ENV.QUOTA_N, 20);

// Acceptance thresholds = PROPOSED targets (configurable), not verified facts about capacity.
export const T = {
  API_P95_MS:    num(__ENV.API_P95_MS, 800),
  API_ERR:       num(__ENV.API_ERR, 0.01),
  SUBMIT_P95_MS: num(__ENV.SUBMIT_P95_MS, 5000),
  STATUS_P95_MS: num(__ENV.STATUS_P95_MS, 1000),
  E2E_P95_MS:    num(__ENV.E2E_P95_MS, 90000),
  AI_SUCCESS:    num(__ENV.AI_SUCCESS, 0.95),
};
