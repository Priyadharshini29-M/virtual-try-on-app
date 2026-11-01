<?php

declare(strict_types=1);

namespace TryFit\Middleware;

use TryFit\AppConfig;
use TryFit\Controllers\AdminAuthController;
use TryFit\Db\AdminSessionRepo;
use TryFit\Db\Database;

/**
 * Session gate for admin pages. Reads the fitfyce_sess cookie, resolves it
 * to a merchant row, and 302-redirects to /auth/login (or /auth/install
 * when `shop=` is on the URL) if the session is missing or expired.
 *
 * Returns the merged merchant row (same shape ApiKeyAuth returns) so
 * controllers can read merchant['id'], merchant['wallet_credits'], etc.
 */
class AdminSession
{
    public static function require(): array
    {
        $sid = (string)($_COOKIE[AdminAuthController::COOKIE_NAME] ?? '');
        $session = $sid !== '' ? (new AdminSessionRepo())->findActive($sid) : null;

        if ($session === null) {
            self::redirectToLogin();
        }

        // Load the merchant row so pages that already read $merchant['x'] keep working.
        $pdo  = Database::getInstance();
        $stmt = $pdo->prepare('SELECT * FROM merchants WHERE id = ? LIMIT 1');
        $stmt->execute([(int)$session['merchant_id']]);
        $merchant = $stmt->fetch();
        if ($merchant === false || (int)$merchant['is_active'] !== 1) {
            self::redirectToLogin();
        }

        // Attach session-only fields so controllers that need the current access
        // token or shop don't have to re-query.
        $merchant['_session_id']   = $session['id'];
        $merchant['_access_token'] = $session['access_token'];
        $merchant['_shop_domain']  = $session['shop_domain'];
        return $merchant;
    }

    private static function redirectToLogin(): void
    {
        $base = AppConfig::adminBaseUrl();
        $shop = strtolower(trim((string)($_GET['shop'] ?? '')));
        if ($shop !== '' && preg_match('/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i', $shop)) {
            header('Location: ' . $base . '/auth/install?shop=' . rawurlencode($shop), true, 302);
        } else {
            header('Location: ' . $base . '/auth/login', true, 302);
        }
        exit;
    }
}
