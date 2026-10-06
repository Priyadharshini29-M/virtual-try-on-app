// Brix-TryOn UI kit — small, dependency-free building blocks shared by the
// redesigned admin pages. Styling lives in app/fitsnap-ui.css (fs-* classes).
import PropTypes from "prop-types";
import { Link } from "react-router";

// ── Icons (24px stroke set) ──────────────────────────────────────────────────
const PATHS = {
  logo: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><circle cx="12" cy="9.5" r="2.5" /><path d="M8 17a4 4 0 0 1 8 0" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  sparkle: <><path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8z" /><path d="M19 15v4M17 17h4" /></>,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>,
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  chart: <><path d="M3 3v18h18" /><path d="M8 16v-4M13 16V8M18 16v-7" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  flame: <path d="M12 22c4.4 0 7.5-3 7.5-7.2 0-4-2.8-6.2-4.1-10.3-2.1 1.9-3.2 4-3.3 6.1-1-.9-1.9-2.3-2.1-4.1C7.7 8.8 4.5 11.6 4.5 15c0 4.1 3.2 7 7.5 7z" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />,
  trophy: <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" /></>,
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
  shirt: <path d="M8 3 3 6l2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z" />,
  bag: <><path d="M6 7h12l1 14H5z" /><path d="M9 7a3 3 0 0 1 6 0" /></>,
  cart: <><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6" /></>,
  trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  users: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>,
  store: <><path d="M3 9l1.5-5h15L21 9" /><path d="M4 9v11h16V9" /><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" /></>,
  message: <path d="M21 12a8 8 0 0 1-11.8 7L3 21l2-6A8 8 0 1 1 21 12z" />,
  download: <><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 20h16" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></>,
  pencil: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  refresh: <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  dots: <><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></>,
  arrowLeft: <path d="m15 6-6 6 6 6" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  monitor: <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  palette: <><circle cx="13.5" cy="6.5" r="1" /><circle cx="17.5" cy="10.5" r="1" /><circle cx="8.5" cy="7.5" r="1" /><path d="M12 2a10 10 0 0 0 0 20c1 0 2-.8 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A5.7 5.7 0 0 0 22 10c0-4.4-4.5-8-10-8z" /></>,
  type: <path d="M4 7V4h16v3M9 20h6M12 4v16" />,
  layout: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  crown: <path d="M3 18h18M4 8l4 4 4-7 4 7 4-4-2 10H6z" />,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  video: <><rect x="2" y="5" width="14" height="14" rx="2" /><path d="m16 10 6-3.5v11L16 14" /></>,
  ruler: <><path d="M3 16 16 3l5 5-13 13z" /><path d="m14.5 6.5 2 2M11 10l2 2M7.5 13.5l2 2" /></>,
};

export function FsIcon({ name, size = 18, filled = false, strokeWidth = 1.9, className, style }) {
  if (name === "hundred") {
    return <span className={className} style={{ fontSize: size * 0.62, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1, ...style }}>100</span>;
  }
  const isFill = filled || name === "flame";
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className} style={style}
      fill={isFill ? "currentColor" : "none"} stroke={isFill ? "none" : "currentColor"}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
    >
      {PATHS[name] ?? PATHS.sparkle}
    </svg>
  );
}

FsIcon.propTypes = {
  name: PropTypes.string.isRequired, size: PropTypes.number, filled: PropTypes.bool,
  strokeWidth: PropTypes.number, className: PropTypes.string, style: PropTypes.object,
};

// ── Layout ───────────────────────────────────────────────────────────────────

export function FsPage({ title, subtitle, actions, children }) {
  return (
    <main className="fs-page">
      {(title || actions) && (
        <div className="fs-page-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && <h2 className="fs-h1">{title}</h2>}
            {subtitle && <p className="fs-sub">{subtitle}</p>}
          </div>
          {actions && <div className="fs-page-actions">{actions}</div>}
        </div>
      )}
      {children}
    </main>
  );
}

FsPage.propTypes = { title: PropTypes.node, subtitle: PropTypes.node, actions: PropTypes.node, children: PropTypes.node };

export function FsCard({ title, subtitle, action, className = "", children, style, tone }) {
  return (
    <section className={`fs-card${tone ? ` fs-card--${tone}` : ""} ${className}`} style={style}>
      {(title || action) && (
        <div className="fs-card-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && <h3 className="fs-h3">{title}</h3>}
            {subtitle && <p className="fs-card-sub">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

FsCard.propTypes = {
  title: PropTypes.node, subtitle: PropTypes.node, action: PropTypes.node, className: PropTypes.string,
  children: PropTypes.node, style: PropTypes.object, tone: PropTypes.oneOf(["gold", "primary"]),
};

// ── Atoms ────────────────────────────────────────────────────────────────────

export function FsButton({ to, variant = "primary", size, icon, children, ...rest }) {
  const cls = `fs-btn fs-btn--${variant}${size === "sm" ? " fs-btn--sm" : ""}`;
  const inner = <>{icon && <FsIcon name={icon} size={size === "sm" ? 14 : 16} />}{children}</>;
  if (to) return <Link to={to} className={cls} {...rest}>{inner}</Link>;
  return <button type="button" className={cls} {...rest}>{inner}</button>;
}

FsButton.propTypes = {
  to: PropTypes.string, variant: PropTypes.oneOf(["primary", "dark", "ghost", "plain"]),
  size: PropTypes.oneOf(["sm"]), icon: PropTypes.string, children: PropTypes.node,
};

export function FsPill({ tone = "neutral", children, style }) {
  return <span className={`fs-pill fs-pill--${tone}`} style={style}>{children}</span>;
}

FsPill.propTypes = {
  tone: PropTypes.oneOf(["neutral", "primary", "success", "warning", "gold", "dark"]),
  children: PropTypes.node, style: PropTypes.object,
};

export function FsProgress({ value, tone = "primary", height = 8 }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={`fs-progress fs-progress--${tone}`} style={{ height }} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

FsProgress.propTypes = { value: PropTypes.number, tone: PropTypes.oneOf(["primary", "gold", "success"]), height: PropTypes.number };

export function FsRing({ value, size = 68, stroke = 6, tone = "gold", children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const color = { gold: "var(--fs-gold)", primary: "var(--fs-primary)", success: "var(--fs-success)" }[tone];
  const track = { gold: "var(--fs-gold-track)", primary: "var(--fs-primary-soft)", success: "var(--fs-success-soft)" }[tone];
  return (
    <div className="fs-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="fs-ring-center">{children}</div>
    </div>
  );
}

FsRing.propTypes = { value: PropTypes.number, size: PropTypes.number, stroke: PropTypes.number, tone: PropTypes.string, children: PropTypes.node };

export function FsSparkline({ data, width = 112, height = 40 }) {
  const vals = Array.isArray(data) && data.length > 1 ? data.map((v) => Number(v) || 0) : [0, 0];
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const pts = vals.map((v, i) => [
    ((i * width) / (vals.length - 1)).toFixed(1),
    (height - 3 - ((v - mn) / (mx - mn || 1)) * (height - 8)).toFixed(1),
  ]);
  const line = pts.map((p) => p.join(",")).join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="fs-spark"
      style={{ width: "100%", height, display: "block" }}
    >
      <path d={`M0,${height} L${pts.map((p) => p.join(",")).join(" L")} L${width},${height} Z`} fill="var(--fs-primary)" fillOpacity="0.08" />
      <polyline points={line} fill="none" stroke="var(--fs-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

FsSparkline.propTypes = { data: PropTypes.array, width: PropTypes.number, height: PropTypes.number };

/** Friendly empty state: illustration, one line, one action. */
export function FsEmpty({ icon = "sparkle", text, cta, to, onClick }) {
  return (
    <div className="fs-empty">
      <div className="fs-empty-art" aria-hidden="true">
        <span className="fs-empty-back" />
        <span className="fs-empty-front"><FsIcon name={icon} size={26} /></span>
      </div>
      <p>{text}</p>
      {cta && (to ? <FsButton to={to} size="sm">{cta}</FsButton> : <FsButton size="sm" onClick={onClick}>{cta}</FsButton>)}
    </div>
  );
}

FsEmpty.propTypes = { icon: PropTypes.string, text: PropTypes.node.isRequired, cta: PropTypes.string, to: PropTypes.string, onClick: PropTypes.func };
