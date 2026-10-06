import { createContext, useCallback, useContext, useEffect, useState } from "react";
import PropTypes from "prop-types";
import { FsIcon } from "./fs-ui";

// ── Celebration toasts ───────────────────────────────────────────────────────

const CelebrateContext = createContext(() => {});

/** Pages call celebrate({ title, body }) to pop a confirmation toast. */
export function useCelebrate() {
  return useContext(CelebrateContext);
}

const CONFETTI = [
  { l: 6, t: -18, w: 8, h: 4, c: "var(--fs-gold)", r: 25 },
  { l: 18, t: -26, w: 6, h: 6, c: "var(--fs-primary)", r: 0, round: true },
  { l: 34, t: -14, w: 9, h: 4, c: "var(--fs-success)", r: -30 },
  { l: 50, t: -30, w: 7, h: 4, c: "var(--fs-gold)", r: 60 },
  { l: 64, t: -16, w: 5, h: 5, c: "var(--fs-ink)", r: 0, round: true },
  { l: 78, t: -24, w: 9, h: 4, c: "var(--fs-primary)", r: 15 },
  { l: 92, t: -12, w: 6, h: 6, c: "var(--fs-gold)", r: 0, round: true },
];

function CelebrationToast({ toast, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);
  return (
    <div className="fs-toast-wrap">
      {CONFETTI.map((p, i) => (
        <span
          key={i}
          className="fs-confetti"
          style={{
            left: `${p.l}%`, top: p.t, width: p.w, height: p.h, background: p.c,
            borderRadius: p.round ? "50%" : 1, "--r": `${p.r}deg`, animationDelay: `${i * 40}ms`,
          }}
        />
      ))}
      <div className="fs-toast" role="status">
        <span className="fs-toast-icon"><FsIcon name="star" size={20} filled /></span>
        <div style={{ flex: 1 }}>
          <div className="fs-toast-title">{toast.title}</div>
          {toast.body && <div className="fs-toast-body">{toast.body}</div>}
        </div>
        <button type="button" className="fs-toast-close" aria-label="Dismiss" onClick={onDismiss}>
          <FsIcon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}

CelebrationToast.propTypes = {
  toast: PropTypes.shape({ title: PropTypes.string, body: PropTypes.string }).isRequired,
  onDismiss: PropTypes.func.isRequired,
};

// ── Shell ────────────────────────────────────────────────────────────────────

export default function AppShell({ children }) {
  const [toast, setToast] = useState(null);
  const celebrate = useCallback((t) => setToast({ ...t, id: Date.now() }), []);
  const dismiss = useCallback(() => setToast(null), []);

  return (
    <CelebrateContext.Provider value={celebrate}>
      <div className="fs-app">
        <div className="fs-content">{children}</div>
        {toast && <CelebrationToast key={toast.id} toast={toast} onDismiss={dismiss} />}
      </div>
    </CelebrateContext.Provider>
  );
}

AppShell.propTypes = {
  children: PropTypes.node,
};
