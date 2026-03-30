import { useLoaderData, useSubmit, useNavigate, useNavigation } from "react-router";
import {
  Page,
  Layout,
  ResourceList,
  ResourceItem,
  Avatar,
  Text,
  Badge,
  Button,
  InlineStack,
  BlockStack,
  Card,
  Thumbnail,
  Spinner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import phpApiClient from "../lib/php-api.server";
import { ensureMerchant } from "../lib/merchant.server";

const PRODUCTS_QUERY = `#graphql
  query GetProducts($first: Int!) {
    products(first: $first) {
      edges {
        node {
          id
          title
          handle
          featuredImage { url altText }
          variants(first: 100) {
            edges {
              node { id title image { url } }
            }
          }
        }
      }
    }
  }
`;

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const apiKey = await ensureMerchant(session);

  const gqlRes  = await admin.graphql(PRODUCTS_QUERY, { variables: { first: 50 } });
  const gqlData = await gqlRes.json();

  const shopifyProducts = (gqlData.data?.products?.edges ?? []).map((e) => e.node);

  const api    = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");
  const phpRes = await api.getProducts();
  const phpList = phpRes.ok ? phpRes.data ?? [] : [];

  const phpMap = {};
  for (const p of phpList) {
    phpMap[String(p.shopify_product_id)] = p;
  }

  const products = shopifyProducts.map((p) => {
    const numericId = p.id.replace("gid://shopify/Product/", "");
    const phpRow    = phpMap[numericId] ?? null;
    return {
      ...p,
      numericId,
      isTryonEnabled: phpRow ? Boolean(phpRow.is_tryon_enabled) : false,
    };
  });

  return { products };
}

export async function action({ request }) {
  const { admin, session }  = await authenticate.admin(request);
  const apiKey  = await ensureMerchant(session);
  const formData   = await request.formData();
  const intent     = formData.get("intent");

  const api = phpApiClient(apiKey, process.env.PHP_API_URL ?? "");

  if (intent === "toggle") {
    const shopifyProductId  = formData.get("shopify_product_id");
    const shopifyProductGid = formData.get("shopify_product_gid");
    const title             = formData.get("title");
    const handle            = formData.get("handle");
    const enabled           = formData.get("enabled") === "true";

    await api.syncProduct({
      shopify_product_id:  shopifyProductId,
      shopify_product_gid: shopifyProductGid,
      title,
      handle,
      is_tryon_enabled: enabled ? 1 : 0,
    });

    await admin.graphql(
      `#graphql
        mutation SetTryonMetafield($input: ProductInput!) {
          productUpdate(input: $input) { product { id } }
        }
      `,
      {
        variables: {
          input: {
            id: shopifyProductGid,
            metafields: [
              {
                namespace: "tryfit",
                key: "tryon_enabled",
                value: enabled ? "true" : "false",
                type: "single_line_text_field",
              },
            ],
          },
        },
      }
    );

    return { ok: true };
  }

  return { ok: false };
}

export default function Products() {
  const { products }  = useLoaderData();
  const submit        = useSubmit();
  const navigate      = useNavigate();
  const navigation    = useNavigation();
  const isSubmitting  = navigation.state === "submitting";

  const handleToggle = (product) => {
    const fd = new FormData();
    fd.set("intent",              "toggle");
    fd.set("shopify_product_id",  product.numericId);
    fd.set("shopify_product_gid", product.id);
    fd.set("title",               product.title);
    fd.set("handle",              product.handle);
    fd.set("enabled",             String(!product.isTryonEnabled));
    submit(fd, { method: "post" });
  };

  return (
    <Page
      title="Products"
      subtitle="Enable virtual try-on per product and map variant images."
      primaryAction={isSubmitting ? { content: <Spinner size="small" /> } : undefined}
    >
      <Layout>
        <Layout.Section>
          <Card padding="0">
            <ResourceList
              resourceName={{ singular: "product", plural: "products" }}
              items={products}
              renderItem={(product) => (
                <ResourceItem
                  id={product.id}
                  media={
                    product.featuredImage?.url ? (
                      <Thumbnail
                        source={product.featuredImage.url}
                        alt={product.featuredImage.altText ?? product.title}
                        size="small"
                      />
                    ) : (
                      <Avatar customer size="md" name={product.title} />
                    )
                  }
                >
                  <BlockStack gap="100">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="bodyMd" fontWeight="semibold">
                        {product.title}
                      </Text>
                      <InlineStack gap="200" blockAlign="center">
                        <Badge tone={product.isTryonEnabled ? "success" : "attention"}>
                          {product.isTryonEnabled ? "Try-on ON" : "Try-on OFF"}
                        </Badge>
                        <Button
                          size="slim"
                          onClick={() => handleToggle(product)}
                          disabled={isSubmitting}
                        >
                          {product.isTryonEnabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          size="slim"
                          onClick={() =>
                            navigate(
                              `/app/variants?product_id=${product.numericId}&product_gid=${encodeURIComponent(product.id)}&title=${encodeURIComponent(product.title)}`
                            )
                          }
                        >
                          Map Variants
                        </Button>
                      </InlineStack>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">{product.handle}</Text>
                  </BlockStack>
                </ResourceItem>
              )}
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
