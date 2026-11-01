// Guided tour steps for every admin module (see components/GuidedTour.jsx).
// `target` is a CSS selector; steps whose element isn't on screen are skipped,
// so a list can cover every state of a page. Keep copy short, and no em dashes.

export const TOURS = {
  dashboard: {
    id: "dashboard",
    steps: [
      { target: ".fs-welcome", title: "Welcome to Brix-TryOn", body: "This is your home base. It always shows the next best step to get more from virtual try-on." },
      { target: ".fs-storefront", title: "Turn try-on on or off", body: "Switch the try-on button on your storefront on or off at any time. Your settings are kept either way." },
      { target: '[data-tour="dash-checklist"]', title: "Setup checklist", body: "Work through these steps to go live. Each one links straight to the page where you do it." },
      { target: '[data-tour="dash-credits"]', title: "Try-on credits", body: "See how many try-ons you have left this month on your current plan." },
      { target: '[data-tour="dash-kpis"]', title: "This week's performance", body: "Try-ons, shoppers and sales influenced by try-on over the last 7 days." },
      { target: ".fs-grid-5", title: "Quick actions", body: "Jump to the things you do most: products, widget settings, AI Studio and more." },
      { target: '[data-tour="dash-howto"]', title: "How to use it", body: "A short visual guide to setting up try-on. Come back here any time you need a refresher." },
    ],
  },

  products: {
    id: "products",
    steps: [
      { target: '[data-tour="prod-collections"]', title: "Collections", body: "Switch on a whole collection at once, and every product in it gets the try-on button." },
      { target: ".fs-col-main", title: "Open a collection", body: "Click a collection to see its products and turn try-on on or off for each one." },
      { target: '[data-tour="prod-filters"]', title: "Find products", body: "Search by name or vendor, and filter by try-on status or collection." },
      { target: '[data-tour="prod-table"]', title: "Your products", body: "Use the switch on each row to turn try-on on or off. Tick several rows to change them in bulk." },
      { target: ".fs-tryon-photo-btn", title: "Try-on photos", body: "Choose which photo the AI dresses shoppers in for each color or size, plus the garment type and photo style." },
    ],
  },

  settings: {
    id: "settings",
    steps: [
      { target: ".fs-settings-layout > :first-child", title: "All widget settings", body: "Everything about the try-on button and window is grouped into sections. Open one to edit it." },
      { target: ".fs-acc-head", title: "Sections", body: "Text fields have a sparkle button that writes the copy for you with AI." },
      { target: ".fs-preview-stage", title: "Live preview", body: "See your changes instantly, exactly as shoppers will see them." },
      { target: ".fs-live-controls", title: "Preview and save", body: "Switch between desktop and mobile, then save when you're happy." },
      { target: ".fs-card:has(.fs-score-row)", title: "Conversion boosters", body: "Tick off these quick tweaks to get more shoppers trying on and buying." },
    ],
  },

  analytics: {
    id: "analytics",
    steps: [
      { target: ".fs-page-actions", title: "Date range", body: "Pick a quick range or a custom period. Every number on the page updates." },
      { target: ".fs-grid-4", title: "Key numbers", body: "Try-ons, shoppers, conversion and revenue for the selected period." },
      { target: ".fs-span-8", title: "Conversion funnel", body: "See where shoppers drop off, from opening try-on to placing an order." },
      { target: ".fs-span-4", title: "Device split", body: "How try-ons split between mobile and desktop." },
      { target: ".fs-span-12", title: "Top products", body: "Your most tried-on products in this period." },
    ],
  },

  studio: {
    id: "studio",
    steps: [
      { target: ".fs-wf-grid", title: "Start a workflow", body: "Pick what you have: a flat lay, a mannequin shot, an accessory or a product photo. We guide you step by step." },
      { target: ".fs-page-actions", title: "Create new asset", body: "Start a new AI photo or infographic from here at any time." },
      { target: ".fs-lib-tabs", title: "Your library", body: "Saved assets, drafts and models all live here." },
      { target: ".fs-lib-tab:nth-child(2)", title: "Drafts", body: "Images you generated but haven't saved or downloaded are kept here automatically, so nothing gets lost." },
      { target: ".fs-lib-toolbar", title: "Search and filter", body: "Find an asset by type, and sort by newest or oldest." },
    ],
  },

  studioCreate: {
    id: "studio-create",
    steps: [
      { target: ".cr-sel-hero", title: "Create something new", body: "Choose the workflow that matches the photo you have." },
      { target: ".fs-wf-grid", title: "Pick a workflow", body: "Each card shows what goes in and what you get out. Hover a card to see more." },
      { target: ".cr-page-hdr", title: "Step by step", body: "Your progress through the workflow is shown here. You can go back at any time." },
      { target: ".cr-zone", title: "Upload your photo", body: "Drop an image or click to browse. Use Change or Remove to swap it later." },
      { target: ".cr-nav", title: "Move between steps", body: "Use Next to continue. Required fields must be filled in first." },
    ],
  },

  variants: {
    id: "variants",
    steps: [
      { target: ".fs-page .fs-card", title: "Progress", body: "How many variants already have a try-on photo. Variants without one use the main product image." },
      { target: ".fs-pick-grid", title: "Pick the try-on photo", body: "Choose the photo the AI dresses shoppers in for this variant, or paste an image link." },
      { target: ".fs-option-grid", title: "Garment type", body: "Tell the AI whether this is top wear, bottom wear or a full-body garment." },
      { target: ".fs-seg", title: "Photo style", body: "Flat lay, ghost mannequin or on a model. This helps the AI read the photo correctly." },
    ],
  },

  sizeChart: {
    id: "size-chart",
    steps: [
      { target: ".fs-page-head .fs-switch", title: "Turn Size Chart on", body: "Show a size chart button on your product pages." },
      { target: '[data-tour="size-charts"]', title: "Your charts", body: "Build one or more charts with your own sizes and measurements." },
      { target: '[data-tour="size-assign"]', title: "Assign to products", body: "Pick which chart shows on each product's page." },
    ],
  },

  completeLook: {
    id: "complete-look",
    steps: [
      { target: ".fs-page-head .fs-switch", title: "Turn Complete Your Look on", body: "Show a styling ideas rail on your product pages." },
      { target: '[data-tour="look-products"]', title: "Pick pairings", body: "Choose up to 12 products to show alongside each product. You decide every match." },
    ],
  },

  plans: {
    id: "plans",
    steps: [
      { target: ".fs-plan-grid", title: "Pick a credit pack", body: "Buy credits whenever you need them. 1 credit = 1 try-on or AI generation." },
    ],
  },
};
