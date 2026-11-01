<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Admin\View;
use TryFit\AppConfig;
use TryFit\Db\Database;
use TryFit\Middleware\AdminSession;

/**
 * Lumped home for the smaller admin pages — Variants (variant→image mapping),
 * Size Chart, Complete Look pairings, and the Onboarding overlay JSON. One
 * controller to keep file count sane; split out if any grow.
 */
class AdminMiscController
{
    // ── Variants ───────────────────────────────────────────────────────────

    /**
     * Variants is a nested view under Products: /admin/variants?product_id=X
     * is reached by clicking a product's "N mapped" / "Add mapping" link on
     * the Products page. The sidebar active-nav stays on Products so the
     * nesting is visible to the merchant.
     *
     * When product_id is missing we render a lightweight "pick a product"
     * screen with a search so merchants arriving via a bookmark can still
     * get in. Primary flow is always via the Products table.
     */
    public function variants(): void
    {
        $merchant = AdminSession::require();
        $pdo      = Database::getInstance();
        $id       = (int)$merchant['id'];

        $productId = (int)($_GET['product_id'] ?? 0);
        $q         = trim((string)($_GET['q'] ?? ''));

        // Index of all products (for the pick-a-product fallback screen).
        $sql  = 'SELECT id, title, handle, is_tryon_enabled, collection_title FROM products WHERE merchant_id = ?';
        $args = [$id];
        if ($q !== '') {
            $sql .= ' AND (title LIKE ? OR handle LIKE ?)';
            $args[] = '%' . $q . '%';
            $args[] = '%' . $q . '%';
        }
        $sql .= ' ORDER BY title ASC LIMIT 100';
        $pStmt = $pdo->prepare($sql);
        $pStmt->execute($args);
        $productList = $pStmt->fetchAll();

        // Current product + its mappings when drilled in.
        $product   = null;
        $mappings  = [];
        $otherCount = 0;
        if ($productId > 0) {
            $pOne = $pdo->prepare(
                'SELECT id, title, handle, is_tryon_enabled, collection_title
                   FROM products WHERE id = ? AND merchant_id = ? LIMIT 1'
            );
            $pOne->execute([$productId, $id]);
            $product = $pOne->fetch() ?: null;

            if ($product !== null) {
                $stmt = $pdo->prepare(
                    'SELECT * FROM variant_image_mappings
                      WHERE product_id = ? AND merchant_id = ?
                      ORDER BY id ASC'
                );
                $stmt->execute([$productId, $id]);
                $mappings = $stmt->fetchAll();
            }
        }

        // Previous/next product so merchants can walk the catalog without
        // bouncing back to the Products list.
        $prevNext = ['prev' => null, 'next' => null];
        if ($product !== null) {
            $prev = $pdo->prepare(
                'SELECT id, title FROM products
                  WHERE merchant_id = ? AND title < ?
                  ORDER BY title DESC LIMIT 1'
            );
            $prev->execute([$id, $product['title']]);
            $prevNext['prev'] = $prev->fetch() ?: null;

            $next = $pdo->prepare(
                'SELECT id, title FROM products
                  WHERE merchant_id = ? AND title > ?
                  ORDER BY title ASC LIMIT 1'
            );
            $next->execute([$id, $product['title']]);
            $prevNext['next'] = $next->fetch() ?: null;
        }

        View::render('variants', [
            'merchant'    => $merchant,
            'products'    => $productList,
            'product_id'  => $productId,
            'product'     => $product,
            'mappings'    => $mappings,
            'prev_next'   => $prevNext,
            'q'           => $q,
            'flash'       => $_GET['saved'] ?? null,
        ], 'products', 'Variants · Brix-TryOn');
    }

    public function saveVariant(): void
    {
        $merchant = AdminSession::require();
        $pdo      = Database::getInstance();
        $id       = (int)$merchant['id'];
        $mappingId = (int)($_POST['mapping_id'] ?? 0);

        $fields = [
            'tryon_image_url'  => (string)($_POST['tryon_image_url'] ?? ''),
            'image_type'       => in_array($_POST['image_type'] ?? '', ['flat_lay','ghost_mannequin','on_model'], true) ? $_POST['image_type'] : 'flat_lay',
            'avatar_sex'       => in_array($_POST['avatar_sex'] ?? '', ['male','female'], true) ? $_POST['avatar_sex'] : null,
            'clothing_prompt'  => (string)($_POST['clothing_prompt'] ?? ''),
        ];
        if ($mappingId > 0) {
            $pdo->prepare(
                'UPDATE variant_image_mappings
                    SET tryon_image_url = ?, image_type = ?, avatar_sex = ?, clothing_prompt = ?
                  WHERE id = ? AND merchant_id = ?'
            )->execute([
                $fields['tryon_image_url'], $fields['image_type'], $fields['avatar_sex'], $fields['clothing_prompt'],
                $mappingId, $id,
            ]);
        }
        $qs = isset($_POST['product_id']) ? '&product_id=' . (int)$_POST['product_id'] : '';
        header('Location: ' . AppConfig::adminBaseUrl() . '/admin/variants?saved=1' . $qs, true, 303);
        exit;
    }

    // ── Size Chart (locked — coming soon) ──────────────────────────────────

    public function sizeChart(): void
    {
        AdminSession::require();
        View::render('coming-soon', [
            'nav'      => 'size-chart',
            'title'    => 'Size Chart',
            'icon'     => 'ruler',
            'sub'      => 'Size recommendations without the guesswork.',
            'body'     => 'Shoppers tell us their size, we match it to your chart, and the right variant is pre-selected on the product page. Launching soon.',
            'features' => [
                'Per-category size charts (tops, bottoms, dresses, footwear)',
                'Smart recommendation based on height and build',
                'Fit confidence meter shown next to the try-on button',
                'Chart assignment per product or per collection',
            ],
        ], 'size-chart', 'Size Chart (soon) · Brix-TryOn');
    }

    public function sizeChartSave(): void
    {
        AdminSession::require();
        header('Location: ' . AppConfig::adminBaseUrl() . '/admin/size-chart', true, 303);
        exit;
    }

    // ── Complete Look (locked — coming soon) ───────────────────────────────

    public function completeLook(): void
    {
        AdminSession::require();
        View::render('coming-soon', [
            'nav'      => 'complete-look',
            'title'    => 'Complete Look',
            'icon'     => 'shirt',
            'sub'      => 'Pair products so shoppers see suggested matches.',
            'body'     => 'Pick up to 12 pairings per product. Shoppers see them as a "complete your look" rail on every product page and in the try-on result. Launching soon.',
            'features' => [
                'Per-product pairings (manual + auto-suggested)',
                'Try-on-combined composite image across pairings',
                'Attribution: track orders that include a paired product',
                'Collection-wide pairing rules',
            ],
        ], 'complete-look', 'Complete Look (soon) · Brix-TryOn');
    }

    public function completeLookSave(): void
    {
        AdminSession::require();
        header('Location: ' . AppConfig::adminBaseUrl() . '/admin/complete-look', true, 303);
        exit;
    }

    // ── Onboarding overlay data ────────────────────────────────────────────
    // The dashboard template reads these to decide whether to pop the overlay.
    // Progress is stored on the merchants.onboarding_json column (if present),
    // or in session cookie as a fallback.

    public function onboardingSave(): void
    {
        $merchant = AdminSession::require();
        $pdo      = Database::getInstance();
        $raw      = file_get_contents('php://input');
        $data     = json_decode((string)$raw, true);
        if (!is_array($data)) {
            respondJson(['ok' => false, 'error' => 'Invalid payload'], 400);
        }
        try {
            $pdo->prepare('UPDATE merchants SET onboarding_json = ? WHERE id = ?')
                ->execute([json_encode($data), (int)$merchant['id']]);
        } catch (\Throwable $e) {
            // Column may not exist yet; swallow so the client never sees a
            // 500 for a cosmetic feature.
        }
        respondJson(['ok' => true]);
    }
}
