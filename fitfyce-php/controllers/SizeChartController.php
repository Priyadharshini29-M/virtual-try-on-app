<?php

declare(strict_types=1);

namespace TryFit\Controllers;

use TryFit\Db\SizeChartRepo;
use TryFit\Db\MerchantRepo;
use TryFit\Middleware\ApiKeyAuth;

/**
 * Size Chart module — admin CRUD (API-key authenticated) plus a public
 * storefront lookup by shop domain + product id, mirroring the trust model
 * WidgetController already uses for the try-on widget's own public routes.
 */
class SizeChartController
{
    /** GET /size-chart — charts + per-product assignments + module enabled flag. */
    public function list(): void
    {
        $merchant = ApiKeyAuth::handle();
        $repo     = new SizeChartRepo();

        respondJson([
            'enabled'     => (bool)($merchant['size_chart_enabled'] ?? false),
            'charts'      => $repo->listForMerchant((int)$merchant['id']),
            'assignments' => $repo->getAssignments((int)$merchant['id']),
        ]);
    }

    /** POST /size-chart — create a chart. Body: {name, unit, columns:[...], rows:[[...]]} */
    public function create(): void
    {
        $merchant = ApiKeyAuth::handle();
        $data     = $this->sanitizeChart($this->body());

        if ($data === null) {
            respondJson(['error' => 'name, unit, columns and rows are required'], 400);
            return;
        }

        $id = (new SizeChartRepo())->create((int)$merchant['id'], $data);
        respondJson(['id' => $id]);
    }

    /** PATCH /size-chart — update a chart. Body: {id, name, unit, columns, rows} */
    public function update(): void
    {
        $merchant = ApiKeyAuth::handle();
        $body     = $this->body();
        $id       = (int)($body['id'] ?? 0);
        $data     = $this->sanitizeChart($body);

        if ($id <= 0 || $data === null) {
            respondJson(['error' => 'id, name, unit, columns and rows are required'], 400);
            return;
        }

        (new SizeChartRepo())->update((int)$merchant['id'], $id, $data);
        respondJson(['ok' => true]);
    }

    /** DELETE /size-chart — body: {id} */
    public function delete(): void
    {
        $merchant = ApiKeyAuth::handle();
        $id       = (int)($this->body()['id'] ?? 0);

        if ($id <= 0) {
            respondJson(['error' => 'id is required'], 400);
            return;
        }

        (new SizeChartRepo())->delete((int)$merchant['id'], $id);
        respondJson(['ok' => true]);
    }

    /** POST /size-chart/assign — body: {shopify_product_id, chart_id} */
    public function assign(): void
    {
        $merchant  = ApiKeyAuth::handle();
        $body      = $this->body();
        $productId = (int)($body['shopify_product_id'] ?? 0);
        $chartId   = (int)($body['chart_id'] ?? 0);

        if ($productId <= 0 || $chartId <= 0) {
            respondJson(['error' => 'shopify_product_id and chart_id are required'], 400);
            return;
        }

        (new SizeChartRepo())->assignToProduct((int)$merchant['id'], $productId, $chartId);
        respondJson(['ok' => true]);
    }

    /** DELETE /size-chart/assign — body: {shopify_product_id} */
    public function unassign(): void
    {
        $merchant  = ApiKeyAuth::handle();
        $productId = (int)($this->body()['shopify_product_id'] ?? 0);

        if ($productId <= 0) {
            respondJson(['error' => 'shopify_product_id is required'], 400);
            return;
        }

        (new SizeChartRepo())->unassignFromProduct((int)$merchant['id'], $productId);
        respondJson(['ok' => true]);
    }

    /** POST /size-chart/enabled — body: {enabled} */
    public function setEnabled(): void
    {
        $merchant = ApiKeyAuth::handle();
        $enabled  = (bool)($this->body()['enabled'] ?? false);

        (new MerchantRepo())->setSizeChartEnabled((int)$merchant['id'], $enabled);
        respondJson(['ok' => true]);
    }

    /**
     * GET /api/size-chart?shop=...&product_id=...
     * Public — no API key, scoped by shop domain like WidgetController::publicGet().
     */
    public function publicGet(): void
    {
        header('Cache-Control: no-store, must-revalidate');

        $shop      = rtrim(preg_replace('#^https?://#i', '', trim((string)($_GET['shop'] ?? ''))), '/');
        $productId = (int)($_GET['product_id'] ?? 0);

        if ($shop === '' || $productId <= 0) {
            respondJson(['chart' => null]);
            return;
        }

        $mRepo    = new MerchantRepo();
        $merchant = $mRepo->findByDomain($shop) ?? $mRepo->findByDomainLike($shop);

        if ($merchant === null || !($merchant['size_chart_enabled'] ?? false)) {
            respondJson(['chart' => null]);
            return;
        }

        $chart = (new SizeChartRepo())->findByShopDomainAndProduct($shop, $productId);
        respondJson(['chart' => $chart]);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private function body(): array
    {
        return (array)(json_decode((string)file_get_contents('php://input'), true) ?? []);
    }

    /** @return array{name:string, unit:string, columns:array, rows:array}|null */
    private function sanitizeChart(array $body): ?array
    {
        $name    = trim((string)($body['name'] ?? ''));
        $unit    = ($body['unit'] ?? '') === 'cm' ? 'cm' : 'in';
        $columns = is_array($body['columns'] ?? null) ? array_values($body['columns']) : null;
        $rows    = is_array($body['rows'] ?? null) ? array_values($body['rows']) : null;

        if ($name === '' || $columns === null || count($columns) === 0 || $rows === null) {
            return null;
        }

        $columns = array_map(fn($c) => substr(trim((string)$c), 0, 40), $columns);
        $rows    = array_map(
            fn($row) => is_array($row) ? array_map(fn($cell) => substr(trim((string)$cell), 0, 40), array_values($row)) : [],
            $rows
        );

        $rules = is_array($body['rules'] ?? null) ? array_map([$this, 'sanitizeRule'], array_values($body['rules'])) : [];

        return ['name' => substr($name, 0, 120), 'unit' => $unit, 'columns' => $columns, 'rows' => $rows, 'rules' => $rules];
    }

    /**
     * One row's optional matching rule for the storefront quiz. Every bound
     * is nullable — an unset min/max means "no constraint on that side", so
     * a merchant can rule on height only, weight only, age only, or a mix.
     */
    private function sanitizeRule(mixed $rule): array
    {
        $rule = is_array($rule) ? $rule : [];
        $num  = function ($v) {
            if ($v === null || $v === '') return null;
            return is_numeric($v) ? (float)$v : null;
        };

        return [
            'ageMin'    => $num($rule['ageMin']    ?? null),
            'ageMax'    => $num($rule['ageMax']    ?? null),
            'heightMin' => $num($rule['heightMin'] ?? null),
            'heightMax' => $num($rule['heightMax'] ?? null),
            'weightMin' => $num($rule['weightMin'] ?? null),
            'weightMax' => $num($rule['weightMax'] ?? null),
        ];
    }
}
