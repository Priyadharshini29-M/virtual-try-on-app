import PropTypes from "prop-types";

/**
 * Legacy feature-gate component. With the wallet credit model every feature
 * is unlocked for every merchant — paying per use replaces tier-based gating.
 * This stays as a no-op passthrough so existing call sites keep compiling
 * until they're removed.
 */
export default function PlanGate({ children }) {
  return children ?? null;
}

PlanGate.propTypes = {
  currentPlan: PropTypes.string,
  requiredPlan: PropTypes.string,
  featureName: PropTypes.string,
  children: PropTypes.node,
  mode: PropTypes.oneOf(["replace", "overlay"]),
};
