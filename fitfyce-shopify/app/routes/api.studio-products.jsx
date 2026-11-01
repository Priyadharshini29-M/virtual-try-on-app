/**
 * api.studio-products.jsx — Shopify product lookup for AI Studio's
 * infographic fields (auto-fill from real product details).
 *
 *   GET ?q=shirt        → { products: [{ id, title, vendor, image }] }   (search, newest first)
 *   GET ?id=<gid>       → { product: { id, title, description, vendor, productType,
 *                                      tags, options, price, images } }
 *
 * A resource route (not the studio page's action) so searching doesn't
 * re-run the studio page's loaders on every keystroke.
 */

import { authenticate } from "../shopify.server";

const SEARCH_QUERY = `#graphql
  query StudioProductSearch($q: String) {
    products(first: 20, query: $q, sortKey: UPDATED_AT, reverse: true) {
      edges { node { id title vendor featuredImage { url } } }
    }
  }
`;

const DETAILS_QUERY = `#graphql
  query StudioProductDetails($id: ID!) {
    product(id: $id) {
      id
      title
      description
      vendor
      productType
      tags
      options { name values }
      priceRange {
        minVariantPrice { amount currencyCode }
        maxVariantPrice { amount currencyCode }
      }
      images(first: 8) { edges { node { url altText } } }
    }
  }
`;

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  try {
    if (id) {
      if (!id.startsWith("gid://shopify/Product/")) {
        return Response.json({ error: "Invalid product id" }, { status: 400 });
      }
      const res = await admin.graphql(DETAILS_QUERY, { variables: { id } });
      const p = (await res.json()).data?.product;
      if (!p) return Response.json({ error: "Product not found" }, { status: 404 });
      const min = p.priceRange?.minVariantPrice;
      const max = p.priceRange?.maxVariantPrice;
      return Response.json({
        product: {
          id: p.id,
          numericId: p.id.replace("gid://shopify/Product/", ""),
          title: p.title,
          description: p.description ?? "",
          vendor: p.vendor ?? "",
          productType: p.productType ?? "",
          tags: p.tags ?? [],
          // Shopify's placeholder option for single-variant products carries no information.
          options: (p.options ?? []).filter((o) => !(o.name === "Title" && o.values?.length === 1 && o.values[0] === "Default Title")),
          price: min ? { min: min.amount, max: max?.amount ?? min.amount, currency: min.currencyCode } : null,
          images: (p.images?.edges ?? []).map((e) => ({ url: e.node.url, alt: e.node.altText ?? "" })),
        },
      });
    }

    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const res = await admin.graphql(SEARCH_QUERY, { variables: { q: q || null } });
    const edges = (await res.json()).data?.products?.edges ?? [];
    return Response.json({
      products: edges.map(({ node }) => ({
        id: node.id,
        title: node.title,
        vendor: node.vendor ?? "",
        image: node.featuredImage?.url ?? null,
      })),
    });
  } catch (e) {
    return Response.json({ error: e?.message ?? "Shopify lookup failed" }, { status: 502 });
  }
};
