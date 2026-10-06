// Setup checklist — derived entirely from real store signals so it always
// matches what actually happened in the store. Pure functions: safe on both
// server and client. No points/XP/levels/badges — just done/todo status.

const DEFAULT_BUTTON_COLOR = "#111827";
const DEFAULT_WIDGET_TITLE = "Try On This Look";

export function isWidgetCustomized(settings) {
  if (!settings) return false;
  const color = String(settings.button_color ?? "").toLowerCase();
  const title = settings.widget_title ?? "";
  return (
    (color !== "" && color !== DEFAULT_BUTTON_COLOR.toLowerCase()) ||
    (title !== "" && title !== DEFAULT_WIDGET_TITLE)
  );
}

/**
 * @param {object} s
 * @param {number} s.enabledProducts  products with try-on switched on
 * @param {boolean} s.widgetCustomized
 * @param {number} s.assets           AI Studio results saved to the library
 * @param {number} s.tryons           all-time try-ons
 * @param {number} s.orders           all-time try-on attributed orders
 */
export function computeChecklist(s) {
  const enabledProducts = Number(s.enabledProducts) || 0;
  const assets = Number(s.assets) || 0;
  const tryons = Number(s.tryons) || 0;
  const orders = Number(s.orders) || 0;

  const checklist = [
    {
      key: "products",
      title: "Enable try-on on products",
      done: enabledProducts > 0,
      doneText: `${enabledProducts} product${enabledProducts === 1 ? "" : "s"} live with the try-on button`,
      todoText: "Pick the products shoppers can try on",
      cta: "Enable",
      to: "/app/products",
    },
    {
      key: "widget",
      title: "Customize your try-on button",
      done: !!s.widgetCustomized,
      doneText: "Your button matches your brand",
      todoText: "Match your brand colors — takes about 2 minutes",
      cta: "Customize",
      to: "/app/settings",
    },
    {
      key: "asset",
      title: "Create your first AI asset",
      done: assets > 0,
      doneText: `${assets} asset${assets === 1 ? "" : "s"} in your library`,
      todoText: "Turn a product photo into an on-model image",
      cta: "Create",
      to: "/app/studio/create",
    },
    {
      key: "tryon",
      title: "Get your first try-on",
      done: tryons > 0,
      doneText: `${tryons.toLocaleString()} try-ons so far`,
      todoText: "Preview your store and try a product yourself",
      cta: "Preview",
      to: "/app/products",
    },
    {
      key: "order",
      title: "Get your first attributed order",
      done: orders > 0,
      doneText: `${orders.toLocaleString()} order${orders === 1 ? "" : "s"} after a try-on`,
      todoText: "Usually happens within a week of going live",
      cta: null,
      to: null,
    },
  ];

  const doneCount = checklist.filter((c) => c.done).length;

  return {
    checklist,
    checklistPct: Math.round((doneCount / checklist.length) * 100),
    checklistDone: doneCount,
  };
}
