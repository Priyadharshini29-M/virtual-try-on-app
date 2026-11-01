<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

/**
 * Browser-session storage for the PHP admin UI. The cookie carries only the
 * opaque session id (CHAR(64)); the row holds the merchant_id + stored
 * Shopify access token so pages can call the admin API without re-OAuth.
 *
 * This replaces Prisma Session from the retired fitfyce-shopify Remix app.
 */
class AdminSessionRepo
{
    private const SESSION_TTL_DAYS = 30;

    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public function create(int $merchantId, string $shopDomain, string $accessToken, ?string $scope = null): string
    {
        $id      = bin2hex(random_bytes(32));
        $expires = date('Y-m-d H:i:s', time() + self::SESSION_TTL_DAYS * 86400);
        $stmt    = $this->db->prepare(
            'INSERT INTO admin_sessions
               (id, merchant_id, shop_domain, access_token, scope, expires_at)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$id, $merchantId, $shopDomain, $accessToken, $scope, $expires]);
        return $id;
    }

    public function findActive(string $sessionId): ?array
    {
        if ($sessionId === '' || !preg_match('/^[a-f0-9]{64}$/', $sessionId)) {
            return null;
        }
        $stmt = $this->db->prepare(
            'SELECT * FROM admin_sessions
              WHERE id = ? AND (expires_at IS NULL OR expires_at > NOW())
              LIMIT 1'
        );
        $stmt->execute([$sessionId]);
        $row = $stmt->fetch();
        if ($row === false) {
            return null;
        }
        // Touch last_seen_at so active sessions roll forward.
        $touch = $this->db->prepare('UPDATE admin_sessions SET last_seen_at = NOW() WHERE id = ?');
        $touch->execute([$sessionId]);
        return $row;
    }

    public function destroy(string $sessionId): void
    {
        $stmt = $this->db->prepare('DELETE FROM admin_sessions WHERE id = ?');
        $stmt->execute([$sessionId]);
    }

    // ── OAuth state (CSRF guard) ───────────────────────────────────────────

    public function createOauthState(string $shopDomain): string
    {
        $state = bin2hex(random_bytes(32));
        $stmt  = $this->db->prepare(
            'INSERT INTO admin_oauth_states (state, shop_domain) VALUES (?, ?)'
        );
        $stmt->execute([$state, $shopDomain]);
        return $state;
    }

    /** Returns the shop domain the state was created for, or null if unknown/expired. */
    public function consumeOauthState(string $state): ?string
    {
        if ($state === '' || !preg_match('/^[a-f0-9]{64}$/', $state)) {
            return null;
        }
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                'SELECT shop_domain FROM admin_oauth_states
                  WHERE state = ? AND created_at > (NOW() - INTERVAL 10 MINUTE)
                  FOR UPDATE'
            );
            $stmt->execute([$state]);
            $row = $stmt->fetch();
            if ($row === false) {
                $this->db->rollBack();
                return null;
            }
            $del = $this->db->prepare('DELETE FROM admin_oauth_states WHERE state = ?');
            $del->execute([$state]);
            $this->db->commit();
            return (string)$row['shop_domain'];
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
    }
}
