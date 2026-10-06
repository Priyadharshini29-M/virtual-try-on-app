// Five AI Studio workflow cards (before → after art, time, steps, credits).
// Shared by the AI Studio library page (links) and the create wizard (onSelect).
import PropTypes from "prop-types";
import { Link } from "react-router";
import { FsIcon } from "./fs-ui";

export const WORKFLOW_CARDS = [
  { id: "model-generation", title: "AI Model Generation", desc: "Put your garment on a realistic AI model.", time: "~45 sec", steps: 5, before: "shirt", after: "model", tone: "#7E9A7A", popular: true },
  { id: "flat-lay", title: "Flat Lay to Model", desc: "Turn a flat product photo into an on-model shot.", time: "~60 sec", steps: 5, before: "flat", after: "model", tone: "#B4234A", popular: true },
  { id: "mannequin", title: "Ghost Mannequin to Model", desc: "Swap the invisible mannequin for a real model.", time: "~50 sec", steps: 5, before: "ghost", after: "model", tone: "#2F3A56" },
  { id: "accessories", title: "Accessories Try-On", desc: "Watches, jewellery and bags on a model.", time: "~40 sec", steps: 5, before: "bag", after: "model", tone: "#8A6F52" },
  { id: "infographic", title: "Marketing Infographic", desc: "Feature callouts ready for ads and product pages.", time: "~90 sec", steps: 4, before: "model", after: "info", tone: "#4B5563" },
];

const SHAPES = {
  shirt: "M8 3 3 6l2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z",
  flat: "M4 7l4-3h8l4 3-2 3-2-1v11H8V9l-2 1z",
  ghost: "M8 4h8l4 3-2 4-2-1v10H8V10l-2 1-2-4z",
  bag: "M6 8h12l-1.5 12h-9zM9 8V6a3 3 0 0 1 6 0v2",
};

function Art({ kind, tone }) {
  if (kind === "model") {
    return (
      <svg viewBox="0 0 120 160" style={{ width: "88%", alignSelf: "flex-end", display: "block" }} aria-hidden="true">
        <circle cx="60" cy="46" r="19" fill="#E4D5C7" />
        <path d="M41 44a19 19 0 0 1 38 0c-4-7-11-10-19-10s-15 3-19 10z" fill="#3B2F2A" />
        <path d="M24 160c1-44 15-86 36-86s35 42 36 86z" fill={tone} />
      </svg>
    );
  }
  if (kind === "info") {
    return (
      <div style={{ position: "absolute", inset: 8, display: "flex", flexDirection: "column", gap: 5 }}>
        <span style={{ height: 6, width: "70%", borderRadius: 2, background: "var(--fs-ink)" }} />
        <span style={{ flex: 1, borderRadius: 4, background: tone }} />
        <span style={{ display: "flex", gap: 3 }}>
          <span style={{ flex: 1, height: 10, borderRadius: 2, background: "#FFFFFF" }} />
          <span style={{ flex: 1, height: 10, borderRadius: 2, background: "#FFFFFF" }} />
        </span>
      </div>
    );
  }
  const outline = kind === "bag";
  return (
    <svg width="46" height="46" viewBox="0 0 24 24" aria-hidden="true">
      <path d={SHAPES[kind]} fill={outline ? "none" : tone} stroke={outline ? tone : "none"} strokeWidth="1.8" strokeLinejoin="round" />
      {kind === "ghost" && <ellipse cx="12" cy="4.5" rx="3" ry="1" fill="#FFFFFF" stroke="#D4D4D8" strokeWidth=".6" />}
    </svg>
  );
}

Art.propTypes = { kind: PropTypes.string, tone: PropTypes.string };

function CardInner({ w }) {
  return (
    <>
      {w.popular && <span className="fs-pill fs-pill--dark fs-wf-popular">Popular</span>}
      <div className="fs-wf-art">
        <div className="fs-wf-frame fs-wf-before"><Art kind={w.before} tone={w.tone} /></div>
        <FsIcon name="arrowRight" size={18} style={{ color: "#9CA3AF", flexShrink: 0 }} />
        <div className="fs-wf-frame" style={{ background: w.after === "info" ? "var(--fs-primary-tint)" : "#F3F1EC" }}><Art kind={w.after} tone={w.tone} /></div>
      </div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{w.title}</div>
        <div style={{ fontSize: 11, color: "var(--fs-muted)", marginTop: 3, lineHeight: 1.4 }}>{w.desc}</div>
      </div>
      <div className="fs-wf-meta">
        <span><FsIcon name="clock" size={12} />{w.time}</span>
        <span>{w.steps} steps</span>
      </div>
    </>
  );
}

CardInner.propTypes = { w: PropTypes.object.isRequired };

export default function WorkflowCards({ onSelect }) {
  return (
    <div className="fs-wf-grid">
      {WORKFLOW_CARDS.map((w) =>
        onSelect ? (
          <button key={w.id} type="button" className="fs-card fs-wf-card" onClick={() => onSelect(w.id)}>
            <CardInner w={w} />
          </button>
        ) : (
          <Link key={w.id} to={`/app/studio/create?workflow=${w.id}`} className="fs-card fs-wf-card">
            <CardInner w={w} />
          </Link>
        ),
      )}
    </div>
  );
}

WorkflowCards.propTypes = { onSelect: PropTypes.func };
