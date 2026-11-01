/**
 * GuidedTour — step-by-step product tour: dims the page, spotlights one
 * element at a time and shows a card ("3 of 7", title, text, Skip / Back /
 * Next) next to it.
 *
 * Each tour runs once automatically on a merchant's first visit (remembered
 * per browser) and can be replayed from the floating "Take a tour" button.
 * Steps point at elements with a CSS selector; a step whose element isn't on
 * the page right now (collapsed panel, empty state…) is skipped, so one step
 * list can cover a page in all its states.
 *
 * Self-contained on purpose (no fs-ui import): fs-ui's FsPage renders it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";

const START_EVENT = "fs-tour:start";
const seenKey = (id) => `fs-tour-seen:${id}`;
const PAD = 6;      // spotlight padding around the target
const GAP = 12;     // space between target and card
const CARD_W = 340;

function hasSeen(id) {
  try { return window.localStorage.getItem(seenKey(id)) === "1"; } catch { return false; }
}
function markSeen(id) {
  try { window.localStorage.setItem(seenKey(id), "1"); } catch { /* private mode: tour may show again */ }
}

/** Replays a tour from anywhere (e.g. a help link). */
export function startTour(id) {
  window.dispatchEvent(new CustomEvent(START_EVENT, { detail: { id } }));
}

function findTarget(selector) {
  if (!selector) return null;
  let el = null;
  try { el = document.querySelector(selector); } catch { return null; }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

export function GuidedTour({ id, steps, autoStart = true }) {
  const [active, setActive] = useState(null); // steps available when the tour started
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [cardH, setCardH] = useState(180);
  const cardRef = useRef(null);
  const nextRef = useRef(null);

  const open = useCallback(() => {
    const available = steps.filter((s) => !s.target || findTarget(s.target));
    if (!available.length) return;
    setActive(available);
    setIndex(0);
  }, [steps]);

  const close = useCallback(() => {
    markSeen(id);
    setActive(null);
    setRect(null);
  }, [id]);

  // First visit: start once the page has laid out. Replay: via startTour(id).
  useEffect(() => {
    let t;
    if (autoStart && !hasSeen(id)) t = setTimeout(open, 900);
    const onStart = (e) => { if (e.detail?.id === id) open(); };
    window.addEventListener(START_EVENT, onStart);
    return () => { clearTimeout(t); window.removeEventListener(START_EVENT, onStart); };
  }, [id, autoStart, open]);

  const step = active?.[index] ?? null;

  // Bring the target into view, then track its position while scrolling/resizing.
  useEffect(() => {
    if (!step) return undefined;
    const el = findTarget(step.target);
    if (!el) { setRect(null); return undefined; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    measure();
    const settle = setTimeout(measure, 450); // after smooth scroll
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(settle);
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [step]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [step, rect]);

  useEffect(() => {
    if (!step) return undefined;
    nextRef.current?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, active.length - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, active, close]);

  if (!step || typeof document === "undefined") return null;

  const isLast = index === active.length - 1;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(CARD_W, vw - 32);

  // Card below the target when it fits, otherwise above; centred when there's no target.
  let cardStyle;
  let arrow = null;
  if (rect) {
    const spaceBelow = vh - (rect.top + rect.height + PAD);
    const below = spaceBelow >= cardH + GAP || rect.top < cardH + GAP;
    const top = below
      ? Math.min(rect.top + rect.height + PAD + GAP, vh - cardH - 16)
      : Math.max(16, rect.top - PAD - GAP - cardH);
    const left = Math.max(16, Math.min(rect.left + rect.width / 2 - cardW / 2, vw - cardW - 16));
    cardStyle = { top, left, width: cardW };
    const arrowX = Math.max(18, Math.min(rect.left + rect.width / 2 - left, cardW - 18));
    arrow = { side: below ? "top" : "bottom", x: arrowX };
  } else {
    cardStyle = { top: Math.max(16, vh / 2 - cardH / 2), left: vw / 2 - cardW / 2, width: cardW };
  }

  return createPortal(
    <div className="fs-tour" role="presentation">
      {/* Covers the page so it can't be clicked while the tour runs. */}
      <div className="fs-tour-blocker" />
      {rect ? (
        <div
          className="fs-tour-spot"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
        />
      ) : (
        <div className="fs-tour-dim" />
      )}
      <div ref={cardRef} className="fs-tour-card" role="dialog" aria-modal="true" aria-labelledby={`fs-tour-title-${id}`} style={cardStyle}>
        {arrow && <span className={`fs-tour-arrow fs-tour-arrow--${arrow.side}`} style={{ left: arrow.x }} />}
        <div className="fs-tour-top">
          <span className="fs-tour-count">{index + 1} of {active.length}</span>
          <button type="button" className="fs-tour-x" aria-label="Close tour" onClick={close}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <h3 id={`fs-tour-title-${id}`} className="fs-tour-title">{step.title}</h3>
        <p className="fs-tour-body">{step.body}</p>
        <div className="fs-tour-foot">
          <button type="button" className="fs-tour-skip" onClick={close}>{isLast ? "Close" : "Skip"}</button>
          <div style={{ display: "flex", gap: 8 }}>
            {index > 0 && (
              <button type="button" className="fs-tour-back" onClick={() => setIndex(index - 1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
                Back
              </button>
            )}
            <button ref={nextRef} type="button" className="fs-tour-next" onClick={() => (isLast ? close() : setIndex(index + 1))}>
              {isLast ? "Done" : "Next"}
              {!isLast && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

GuidedTour.propTypes = {
  id: PropTypes.string.isRequired,
  steps: PropTypes.arrayOf(PropTypes.shape({
    target: PropTypes.string,
    title: PropTypes.string.isRequired,
    body: PropTypes.string.isRequired,
  })).isRequired,
  autoStart: PropTypes.bool,
};

/** Tour plus the floating "Take a tour" button that replays it. */
export function PageTour({ id, steps }) {
  return (
    <>
      <GuidedTour id={id} steps={steps} />
      <button type="button" className="fs-tour-launch" onClick={() => startTour(id)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" /></svg>
        Take a tour
      </button>
    </>
  );
}

PageTour.propTypes = { id: PropTypes.string.isRequired, steps: PropTypes.array.isRequired };
