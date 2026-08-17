import "@shopify/polaris/build/esm/styles.css";
import "../app/tailwind.css";
import "../app/vto-design.css";

import * as React from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import PreviewAnalytics from "./PreviewAnalytics";

const router = createMemoryRouter([
  { path: "/", element: <PreviewAnalytics /> },
  { path: "/app", element: <div style={{ padding: 24 }}>(Dashboard - not part of this preview)</div> },
]);

createRoot(document.getElementById("root")).render(
  <PolarisAppProvider i18n={enTranslations}>
    <RouterProvider router={router} />
  </PolarisAppProvider>
);
