# FitFyce / TryFit Shopify App

## Overview

FitFyce is a Shopify app built as a virtual try-on solution for apparel and clothing brands. It combines a storefront widget, admin dashboard, product-level variant mapping, and AI-powered image processing to give customers a realistic preview of how apparel looks on their own photo.

The app is implemented as a Remix + React-based Shopify app with a theme extension for a storefront try-on button and modal overlay. The actual AI processing is proxied through a backend PHP service so merchant storefronts never directly expose the image-processing endpoint.

## Core App Features

### 1. Storefront Virtual Try-On Widget

- **Branded Try-On Button**: Adds a customizable button on product pages that matches the merchant's brand styling.
- **Responsive Modal Overlay**: Displays a full-screen overlay modal with privacy notice, photo upload interface, processing progress, and result screen. The modal is designed to work seamlessly on desktop and mobile devices, with adaptive sizing and positioning.
- **Automatic Injection**: Uses Shopify theme extension code to automatically inject the widget on supported product pages, reducing manual setup for merchants.
- **Collection Page Icons**: Optional mini try-on icons on product cards in collection pages, positioned in corners (top-left, top-right, bottom-left, bottom-right) to surface try-on availability.
- **Theme Compatibility**: Robust positioning and overlay handling to work across different Shopify themes, including those with complex layouts or transforms.

### 2. Privacy & Trust Controls

- **Privacy Notice Screen**: Mandatory consent screen before photo upload, explaining how the image will be used and processed.
- **Clear Data Handling Messaging**: Explicitly states that customer photos are processed by AI and never stored on servers after completion, building trust and compliance with privacy regulations.
- **GDPR-Friendly Design**: Helps merchants meet privacy expectations for image upload experiences, reducing legal risks.

### 3. Product Variant Support

- **Variant Mapping System**: Uses Shopify metafields (`product.metafields.tryfit.variant_mappings`) to map specific product variants to corresponding try-on imagery, ensuring accurate color and size representation.
- **Dynamic Variant Selection**: Allows customers to select the correct variant in the modal, with fallback to page-selected variants or the first available option.
- **Multi-Variant Handling**: Supports products with multiple colors, sizes, or styles by mapping each variant to its appropriate try-on image URL.
- **Admin Variant Management**: Dedicated UI (`/app/variants`) for merchants to upload and assign try-on images to each product variant.

### 4. Admin Dashboard & Product Management

- **Dashboard Overview** (`/app`): Displays key performance indicators (KPIs) such as try-on initiations, conversions, and a 7-day trend chart for quick insights.
- **Product Enablement** (`/app/products`): List view of all products with toggle switches to enable/disable try-on per product, including bulk actions and search/filtering.
- **Variant Mapping Interface** (`/app/variants`): Per-product page to upload try-on images and map them to specific variants, with drag-and-drop support and image previews.
- **Widget Settings** (`/app/settings`): Comprehensive configuration panel with tabs for button design, typography, collection icons, and feature toggles, featuring a live preview.
- **Analytics Dashboard** (`/app/analytics`): Detailed metrics including summary stats, top-performing products by conversion, device split (mobile vs. desktop), and date-range filtering.

### 5. Appearance & Widget Customization

- **Button Design Controls**: Customize label, subtitle, background color, text color, hover effects, border radius, width, height, padding, and margin.
- **Typography Options**: Adjust title and subtitle font size, weight, font family (with Google Fonts integration), and language selection for multi-lingual support.
- **Icon Customization**: Choose from predefined icons (eye, sparkles, camera, shopping bag), set icon color, size, background color, border radius, and opacity.
- **Collection Icon Positioning**: Toggle visibility and position mini icons on collection pages, with customizable backgrounds and styling.
- **Live Preview**: Real-time preview in the settings interface to see changes instantly without saving.

### 6. Customer Experience Enhancements

- **Photo Upload**: Secure file upload from customer devices, with support for JPEG, PNG, and WebP formats up to 5MB.
- **Processing Feedback**: Animated progress bar and status messages during AI processing, with a 35-second timeout for reliability.
- **Result Sharing**: Options to save the try-on result image to the device or share via WhatsApp, encouraging social sharing and retention.
- **Cart Integration**: Direct "Add to Cart" and "Buy Now" buttons from the result screen, with variant selection and session tracking for conversion attribution.
- **Error Handling & Retry**: Graceful error states with retry options, ensuring a smooth user experience even with network issues.

### 7. Backend & Data Flow

- **API Proxy Architecture**: Remix server acts as a secure proxy to the PHP backend, preventing direct exposure of AI processing endpoints to the storefront.
- **Try-On Processing** (`api.tryon.jsx`): Handles image uploads, variant mapping, and AI processing with timeout handling and error responses.
- **Temporary Storage** (`api.upload.jsx`): Supports Cloudflare R2 or PHP-based temp storage for uploaded images, with automatic cleanup.
- **Event Tracking** (`api.track.jsx`): Beacon-based tracking for try-on actions, cart additions, and conversions, with session correlation.
- **Webhook Integration**: Automatic handling of `orders/paid` for conversion tracking and `app/uninstalled` for merchant lifecycle management.

## Architecture Summary

### Frontend

- Remix/React admin app for merchant interface.
- Theme extension block for Shopify storefront injection.
- Vanilla JS widget (`tryon-widget.js`) for storefront modal behavior.
- CSS module (`tryon-modal.css`) for widget styling.

### Backend

- Remix server acts as proxy and storefront-safe API.
- PHP server handles actual image processing and session tracking.
- Optional Cloudflare R2 integration for temporary upload storage.
- Prisma and Shopify session storage for merchant data.

## Unique Strengths of FitFyce

### Built for Shopify with theme flexibility

- Shopify theme extension injects widget code and modal markup directly into the storefront.
- Supports both direct product page button blocks and body-embedded app injects.
- Configurable through the Shopify Theme Editor and app settings.

### Privacy-first design

- Explicit privacy notice before uploading customer photos.
- Clear messaging that photos are not retained after processing.

### Product & variant intelligence

- Variant mappings ensure the right try-on image is shown for each SKU.
- Stores mapping metadata in Shopify fields for compatibility.
- Can map multiple variant images to the same underlying try-on engine.

### Conversion-oriented behavior

- Tracks try-on actions and conversion events.
- Handles cart add and checkout flows directly from the try-on result.
- Sends cart session metadata so orders can be associated with try-on sessions.

### Merchant control and style customization

- Rich button design options allow the try-on CTA to match brand styling.
- Collection page icons help surface try-on availability in product listings.
- Live preview in the settings interface makes configuration easier.

## Competitor Analysis

The virtual try-on space generally has several competing product categories:

1. "Pure" virtual try-on SaaS providers
2. Shopify-specific VTO theme apps
3. Product image preview / AR preview tools
4. Custom-built brand-specific solutions

### Common competitor limitations

- Many competitors provide fixed widget styling with limited customization.
- Few support product variant-level image mapping and accurate SKU matching.
- WhatsApp sharing and save-image flows are often missing.
- Privacy notices and upload consent flows are frequently absent.
- Most solutions expose the processing endpoint directly or require heavy custom integration.

### FitFyce vs typical competitors

| Feature                            | FitFyce | Typical Shopify VTO Competitor | Notes                                                                              |
| ---------------------------------- | ------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| Shopify theme extension support    | Yes     | Sometimes                      | FitFyce injects button and modal cleanly into product templates and body sections. |
| Variant image mapping              | Yes     | Rare                           | Critical for apparel with multiple colors/sizes.                                   |
| Privacy consent notice             | Yes     | Often no                       | Boosts trust and legal compliance.                                                 |
| Save result image                  | Yes     | Often no                       | Good for social sharing and retention.                                             |
| WhatsApp sharing                   | Yes     | Rare                           | Useful for mobile-first stores in markets where WhatsApp is dominant.              |
| Add to cart / checkout from result | Yes     | Some                           | Converts try-on engagement into sales.                                             |
| Analytics dashboard                | Yes     | Varies                         | FitFyce includes merchant-facing try-on metrics.                                   |
| Backend proxy architecture         | Yes     | Rare                           | Protects API keys and hides the image processing service from the storefront.      |
| Flexible button styling            | Yes     | Often limited                  | Includes typography, color, padding, margin, icon, and size controls.              |

### Competitive advantages for merchants

- faster store integration through Shopify app + theme block
- superior product mapping for multi-variant apparel
- better customer trust with explicit privacy presentation
- stronger conversion path from try-on to cart/checkout
- richer merchant settings and analytics than basic overlay widgets

### Potential competitor threats or gaps to watch

- Large enterprise AR/3D try-on platforms may offer more advanced body-fit rendering.
- Some apps focus on broader product visualization rather than apparel-specific try-on.
- Competitors that integrate natively with Shopify hydrogen or headless storefronts may offer deeper customization for certain brands.

## Recommended Messaging for FitFyce

- "AI-powered virtual try-on built for Shopify apparel stores"
- "Variant-aware try-on that matches product color and SKU"
- "Privacy-first photo uploads: no customer images are stored"
- "Customizable try-on CTA with live preview, WhatsApp sharing, and save-image support"
- "Track try-on engagement, add-to-cart conversions, and top performing products"

## Next Improvements to Consider

1. Add a dedicated product card badge outside of collection pages for better discoverability.
2. Add pre-built mobile-friendly onboarding copy for the widget modal.
3. Provide a merchant-facing conversion report for try-on-to-order revenue.
4. Add optional AI-generated outfit recommendations or size guidance.
5. Add A/B test support for button copy and placement.

## File Locations for the Implementation

- Storefront widget: `extensions/tryon-widget/assets/tryon-widget.js`
- Modal styles: `extensions/tryon-widget/assets/tryon-modal.css`
- Theme blocks: `extensions/tryon-widget/blocks/tryon-button.liquid`, `extensions/tryon-widget/blocks/tryon-embed.liquid`
- Admin settings and analytics: `app/routes/app.settings.jsx`, `app/routes/app.analytics.jsx`, `app/routes/app.products.jsx`, `app/routes/app.variants.jsx`
- Try-on proxy: `app/routes/api.tryon.jsx`, `app/routes/api.upload.jsx`, `app/routes/api.track.jsx`
- README and setup: `fitfyce-shopify/README.md`
