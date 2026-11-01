// Wallet-based credit model. No fixed plans anymore — a shop pays per use
// and holds a credit balance. The helpers here used to translate between
// plan tiers for the plans page; kept as no-op shims so legacy callers that
// still import them keep compiling until they're migrated.

export const PLAN_ORDER = [];
export const PLAN_LABELS = {};
export const PLAN_PRICES = {};
export const PLAN_TRYONS = {};

/** Legacy gate helper — every feature is unlocked under the wallet model. */
export function planAtLeast() {
  return true;
}

/** Legacy translator — kept so stale imports don't crash. */
export function phpPlanToUi(v) { return v ?? ''; }
export function uiPlanToPhp(v) { return v ?? ''; }
