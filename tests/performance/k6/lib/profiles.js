import { MAX_VUS, DUR_SCALE, RATE_SCALE, SOAK_MIN, QUOTA_N } from './config.js';

const cap = (n) => Math.min(Math.max(1, Math.round(n)), MAX_VUS);
const d = (sec) => `${Math.max(1, Math.round(sec * DUR_SCALE))}s`;
const r = (perMin) => Math.max(1, Math.round(perMin * RATE_SCALE));

// shopper page-load traffic (closed model, think time inside the function)
const widget = (stages) => ({ executor: 'ramping-vus', exec: 'widget', startVUs: 0, gracefulRampDown: '10s',
  stages: stages.map(([s, t]) => ({ duration: d(s), target: cap(t) })) });
// try-on journeys (open model: shoppers arrive independently of how fast the backend answers)
const journey = (stages, pre = 5) => ({ executor: 'ramping-arrival-rate', exec: 'journey', timeUnit: '1m',
  startRate: r(stages[0][1]), preAllocatedVUs: cap(pre), maxVUs: MAX_VUS, gracefulStop: '200s',
  stages: stages.map(([s, t]) => ({ duration: d(s), target: r(t) })) });
const upload = (vus, iters) => ({ executor: 'per-vu-iterations', exec: 'upload', vus: cap(vus), iterations: iters, maxDuration: '5m' });
const admin  = (stages) => ({ executor: 'ramping-vus', exec: 'admin', startVUs: 0, gracefulRampDown: '10s',
  stages: stages.map(([s, t]) => ({ duration: d(s), target: cap(t) })) });


// ramping upload traffic (uses the same valid/oversize/non-image trio per iteration)
const uploadRamp = (stages) => ({ executor: 'ramping-vus', exec: 'upload', startVUs: 0, gracefulRampDown: '10s',
  stages: stages.map(([s, t]) => ({ duration: d(s), target: cap(t) })) });

export const PROFILES = {
  // 1-5 VUs: prove the harness and the endpoints work. One real try-on end to end.
  smoke: {
    widget: widget([[10, 1], [20, 1]]),
    journey: { executor: 'per-vu-iterations', exec: 'journey', vus: 1, iterations: 1, maxDuration: '4m' },
    upload: upload(1, 1),
    admin: admin([[5, 1], [15, 1]]),
  },
  baseline: {
    widget: widget([[30, 5], [120, 5], [10, 0]]),
    journey: journey([[30, 2], [150, 2]], 3),
    upload: upload(2, 3),
    admin: admin([[20, 2], [100, 2]]),
  },
  load: {
    widget: widget([[60, 25], [180, 50], [240, 50], [20, 0]]),
    journey: journey([[60, 2], [180, 8], [240, 8]], 8),
    upload: upload(5, 5),
    admin: admin([[60, 2], [420, 5]]),
  },
  stress: { // authorised, monitored runs only; stops itself via abortOnFail thresholds
    widget: widget([[60, 25], [120, 50], [120, 100], [120, 200], [120, 300]]),
    journey: journey([[120, 4], [120, 8], [120, 16], [120, 32], [120, 64]], 10),
  },
  // stress_heavy: like stress but ALSO drives the admin routes (analytics/products queries) and uploads,
  // which are the heavier PHP/DB paths. Use this one to look for the real breaking point.
  stress_heavy: {
    widget: widget([[60, 25], [120, 50], [120, 100], [120, 150]]),
    journey: journey([[60, 4], [120, 8], [120, 16], [120, 24]], 10),
    admin: admin([[60, 5], [120, 10], [120, 20], [120, 40]]),
    upload: uploadRamp([[60, 2], [120, 5], [120, 10], [120, 20]]),
  },
  spike: {
    widget: widget([[30, 5], [10, 150], [120, 150], [10, 5], [60, 5]]),
    journey: journey([[30, 2], [10, 40], [120, 40], [10, 2], [60, 2]], 10),
  },
  soak: {
    widget: widget([[60, 25], [SOAK_MIN * 60, 25], [30, 0]]),
    journey: journey([[SOAK_MIN * 60, 4]], 5),
    admin: admin([[SOAK_MIN * 60, 2]]),
  },
  recovery: { // run right after spike/stress: is latency back to the baseline level?
    widget: widget([[300, 2]]),
    journey: journey([[300, 2]], 3),
  },
  // Correctness probes (small, deterministic)
  quota: { quota: { executor: 'shared-iterations', exec: 'quota', vus: Math.min(QUOTA_N, MAX_VUS), iterations: QUOTA_N, maxDuration: '5m' } },
  idempotency: { idem: { executor: 'per-vu-iterations', exec: 'idem', vus: 1, iterations: 3, maxDuration: '5m' } },
};
