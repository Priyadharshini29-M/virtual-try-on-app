<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Admin\View;
use TryFit\Db\Database;
use TryFit\Middleware\AdminSession;

/**
 * Products admin: lists every synced product from the local `products`
 * table, lets the merchant toggle try-on per product or in bulk by
 * collection, and links to the variant-mapping page per product. No
 * Shopify API calls — the storefront sync job keeps the local table
 * in step with Shopify.
 *
 * Supports two views: `grouped` (collection cards, each with its own
 * bulk toggle) and `list` (flat searchable table).
 */
class AdminProductsController
{
    private const PAGE_SIZE = 50;

    public function show(): void
    {
        $merchant = AdminSession::require();
        $pdo      = Database::getInstance();
        $id       = (int)$merchant['id'];

        $q           = trim((string)($_GET['q']      ?? ''));
        $filter      = (string)($_GET['filter'] ?? '');       // '', 'enabled', 'off'
        $view        = (string)($_GET['view']   ?? 'list');   // 'list' | 'grouped'
        $view        = in_array($view, ['list', 'grouped'], true) ? $view : 'list';
        $page        = max(1, (int)($_GET['page'] ?? 1));
        $colFilter   = trim((string)($_GET['col'] ?? ''));    // scope to one collection
        $colSearch   = trim((string)($_GET['cq']  ?? ''));    // search collections list

        // ── Catalog-wide counts (shown in the hero regardless of filter) ────
        $totalsStmt = $pdo->prepare(
            'SELECT COUNT(*) AS total, SUM(is_tryon_enabled) AS enabled
               FROM products WHERE merchant_id = ?'
        );
        $totalsStmt->execute([$id]);
        $totals = $totalsStmt->fetch() ?: ['total' => 0, 'enabled' => 0];

        // ── Products matching the current search + filter ──────────────────
        $where = ['merchant_id = ?'];
        $args  = [$id];
        if ($q !== '') {
            $where[] = '(title LIKE ? OR handle LIKE ? OR collection_title LIKE ?)';
            $args[]  = '%' . $q . '%';
            $args[]  = '%' . $q . '%';
            $args[]  = '%' . $q . '%';
        }
        if ($filter === 'enabled') $where[] = 'is_tryon_enabled = 1';
        if ($filter === 'off')     $where[] = 'is_tryon_enabled = 0';
        if ($colFilter !== '')     { $where[] = 'collection_title = ?'; $args[] = $colFilter; }

        $countStmt = $pdo->prepare('SELECT COUNT(*) FROM products WHERE ' . implode(' AND ', $where));
        $countStmt->execute($args);
        $filteredTotal = (int)$countStmt->fetchColumn();

        $pageCount = max(1, (int)ceil($filteredTotal / self::PAGE_SIZE));
        $page      = min($page, $pageCount);
        $offset    = ($page - 1) * self::PAGE_SIZE;

        $sql = 'SELECT id, shopify_product_id, title, handle, is_tryon_enabled,
                       collection_id, collection_title, collection_handle
                  FROM products WHERE ' . implode(' AND ', $where)
             . ' ORDER BY is_tryon_enabled DESC, collection_title ASC, title ASC'
             . ' LIMIT ' . (int)self::PAGE_SIZE . ' OFFSET ' . (int)$offset;
        $stmt = $pdo->prepare($sql);
        $stmt->execute($args);
        $products = $stmt->fetchAll();

        // ── Variant counts per product (for the "has variants" badge) ──────
        $variantCounts = [];
        if (!empty($products)) {
            $ids = array_column($products, 'id');
            $in  = implode(',', array_fill(0, count($ids), '?'));
            try {
                $vStmt = $pdo->prepare(
                    'SELECT product_id, COUNT(*) AS n
                       FROM variant_image_mappings
                      WHERE product_id IN (' . $in . ') AND merchant_id = ?
                      GROUP BY product_id'
                );
                $vStmt->execute([...$ids, $id]);
                foreach ($vStmt->fetchAll() as $r) {
                    $variantCounts[(int)$r['product_id']] = (int)$r['n'];
                }
            } catch (\Throwable $e) { /* table missing on older installs */ }
        }

        // ── Collection roll-up (always, for the top Collections panel) ─────
        $colSql  = 'SELECT collection_title, collection_handle,
                           COUNT(*) AS total, SUM(is_tryon_enabled) AS enabled
                      FROM products
                     WHERE merchant_id = ? AND collection_title IS NOT NULL AND collection_title <> \'\'';
        $colArgs = [$id];
        if ($colSearch !== '') {
            $colSql  .= ' AND collection_title LIKE ?';
            $colArgs[] = '%' . $colSearch . '%';
        }
        $colSql .= ' GROUP BY collection_title, collection_handle ORDER BY total DESC, collection_title ASC';
        $colStmt = $pdo->prepare($colSql);
        $colStmt->execute($colArgs);
        $collections = $colStmt->fetchAll();

        // ── Products grouped by collection (only when grouped view) ────────
        $grouped = [];
        if ($view === 'grouped') {
            foreach ($products as $p) {
                $key = (string)($p['collection_title'] ?? '') ?: '(No collection)';
                $grouped[$key][] = $p;
            }
            ksort($grouped);
        }

        View::render('products', [
            'merchant'       => $merchant,
            'products'       => $products,
            'variant_counts' => $variantCounts,
            'grouped'        => $grouped,
            'collections'    => $collections,
            'q'              => $q,
            'filter'         => $filter,
            'col_filter'     => $colFilter,
            'col_search'     => $colSearch,
            'view_mode'      => $view,
            'page'           => $page,
            'page_count'     => $pageCount,
            'page_size'      => self::PAGE_SIZE,
            'filtered_total' => $filteredTotal,
            'total_products' => (int)$totals['total'],
            'enabled'        => (int)$totals['enabled'],
            'flash'          => $_GET['saved'] ?? null,
        ], 'products', 'Products · Brix-TryOn');
    }

    public function toggle(): void
    {
        $merchant  = AdminSession::require();
        $productId = (int)($_POST['product_id'] ?? 0);
        $enabled   = (int)!empty($_POST['enabled']);

        if ($productId > 0) {
            Database::getInstance()
                ->prepare('UPDATE products SET is_tryon_enabled = ? WHERE id = ? AND merchant_id = ?')
                ->execute([$enabled, $productId, (int)$merchant['id']]);
        }
        $this->redirectBack('1');
    }

    public function bulkToggle(): void
    {
        $merchant = AdminSession::require();
        $pdo      = Database::getInstance();
        $enabled  = (int)!empty($_POST['enabled']);
        $scope    = (string)($_POST['scope'] ?? 'all');

        if ($scope === 'all') {
            $pdo->prepare('UPDATE products SET is_tryon_enabled = ? WHERE merchant_id = ?')
                ->execute([$enabled, (int)$merchant['id']]);
        } elseif ($scope === 'collection') {
            $col = trim((string)($_POST['collection'] ?? ''));
            if ($col !== '') {
                $pdo->prepare('UPDATE products SET is_tryon_enabled = ? WHERE merchant_id = ? AND collection_title = ?')
                    ->execute([$enabled, (int)$merchant['id'], $col]);
            }
        } elseif ($scope === 'selected') {
            $ids = array_filter(array_map('intval', (array)($_POST['ids'] ?? [])));
            if (!empty($ids)) {
                $in = implode(',', array_fill(0, count($ids), '?'));
                $pdo->prepare('UPDATE products SET is_tryon_enabled = ? WHERE merchant_id = ? AND id IN (' . $in . ')')
                    ->execute([$enabled, (int)$merchant['id'], ...$ids]);
            }
        }
        $this->redirectBack('bulk');
    }

    private function redirectBack(string $savedFlag): void
    {
        $qs = [];
        if (!empty($_POST['q']))      $qs[] = 'q=' . rawurlencode((string)$_POST['q']);
        if (!empty($_POST['filter'])) $qs[] = 'filter=' . rawurlencode((string)$_POST['filter']);
        if (!empty($_POST['view']))   $qs[] = 'view=' . rawurlencode((string)$_POST['view']);
        if (!empty($_POST['page']))   $qs[] = 'page=' . (int)$_POST['page'];
        $qs[] = 'saved=' . rawurlencode($savedFlag);
        header('Location: ' . \TryFit\AppConfig::adminBaseUrl() . '/admin/products?' . implode('&', $qs), true, 303);
        exit;
    }
}
