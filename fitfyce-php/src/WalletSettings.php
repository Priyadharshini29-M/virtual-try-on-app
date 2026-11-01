<?php

declare(strict_types=1);

namespace TryFit\Src;

use TryFit\Controllers\WalletController;
use TryFit\Db\Database;
use TryFit\Middleware\WalletCheck;

/**
 * Wallet rules: the credit packs merchants can buy and how many credits each
 * billable action costs. Edited from the VTO platform admin (see
 * PlatformController) and stored in `platform_settings`; read fresh on every
 * request so a change applies to the very next page view or try-on.
 *
 * WalletController::PACKS and WalletCheck::COST_* remain the defaults used
 * until an admin has saved anything.
 */
final class WalletSettings
{
    public const ACTIONS = ['tryon', 'studio', 'infographic'];

    /** @var array<string, mixed>|null per-request cache */
    private static ?array $rows = null;

    /** @return array<string, array{credits:int, amount_minor:int, currency:string, label:string, popular?:bool}> */
    public static function packs(): array
    {
        $packs = self::row('wallet.packs');
        return is_array($packs) && $packs ? $packs : WalletController::PACKS;
    }

    public static function pack(string $id): ?array
    {
        return self::packs()[$id] ?? null;
    }

    /** @return array<string, int> */
    public static function costs(): array
    {
        $defaults = [
            'tryon'       => WalletCheck::COST_TRYON,
            'studio'      => WalletCheck::COST_STUDIO,
            'infographic' => WalletCheck::COST_INFOGRAPHIC,
        ];
        $saved = self::row('wallet.costs');
        return is_array($saved) ? array_merge($defaults, array_intersect_key($saved, $defaults)) : $defaults;
    }

    public static function cost(string $action): int
    {
        return (int)(self::costs()[$action] ?? 1);
    }

    /**
     * Validates and stores packs + costs. Returns the error message, or null on success.
     * Pack ids are kept stable because /wallet/topup clients send them back.
     */
    public static function save(array $packs, array $costs, ?string $by = null): ?string
    {
        $cleanPacks = [];
        foreach ($packs as $p) {
            $id = strtolower(trim((string)($p['id'] ?? '')));
            if (!preg_match('/^[a-z0-9_-]{2,30}$/', $id)) return 'Each pack needs an id of 2-30 letters, digits, - or _';
            if (isset($cleanPacks[$id])) return "Duplicate pack id: $id";
            $credits = (int)($p['credits'] ?? 0);
            $minor   = (int)($p['amount_minor'] ?? 0);
            $cur     = strtoupper(trim((string)($p['currency'] ?? 'INR')));
            $label   = trim((string)($p['label'] ?? ''));
            if ($credits < 1 || $credits > 1000000) return "Pack $id: credits must be between 1 and 1,000,000";
            if ($minor < 100) return "Pack $id: price must be at least 1.00";
            if (!preg_match('/^[A-Z]{3}$/', $cur)) return "Pack $id: currency must be a 3-letter code";
            if ($label === '' || mb_strlen($label) > 40) return "Pack $id: label is required (max 40 characters)";
            $cleanPacks[$id] = ['credits' => $credits, 'amount_minor' => $minor, 'currency' => $cur, 'label' => $label]
                + (!empty($p['popular']) ? ['popular' => true] : []);
        }
        if (!$cleanPacks) return 'At least one credit pack is required';
        if (count($cleanPacks) > 12) return 'At most 12 credit packs';

        $cleanCosts = [];
        foreach (self::ACTIONS as $a) {
            $v = $costs[$a] ?? null;
            if (!is_numeric($v) || (int)$v < 0 || (int)$v > 1000) return "Cost for $a must be a whole number from 0 to 1000";
            $cleanCosts[$a] = (int)$v;
        }

        $pdo  = Database::getInstance();
        $stmt = $pdo->prepare(
            'INSERT INTO platform_settings (setting_key, value_json, updated_by) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_by = VALUES(updated_by)'
        );
        $pdo->beginTransaction();
        $stmt->execute(['wallet.packs', json_encode($cleanPacks, JSON_UNESCAPED_UNICODE), $by]);
        $stmt->execute(['wallet.costs', json_encode($cleanCosts), $by]);
        $pdo->commit();
        self::$rows = null;
        return null;
    }

    /** packs + costs in the shape the platform admin edits (packs as an ordered list) */
    public static function export(): array
    {
        $packs = [];
        foreach (self::packs() as $id => $p) {
            $packs[] = ['id' => $id, 'label' => $p['label'], 'credits' => (int)$p['credits'],
                        'amount_minor' => (int)$p['amount_minor'], 'currency' => $p['currency'], 'popular' => !empty($p['popular'])];
        }
        return ['packs' => $packs, 'costs' => self::costs(), 'customised' => self::row('wallet.packs') !== null];
    }

    private static function row(string $key)
    {
        if (self::$rows === null) {
            self::$rows = [];
            try {
                $rows = Database::getInstance()
                    ->query("SELECT setting_key, value_json FROM platform_settings WHERE setting_key LIKE 'wallet.%'")
                    ->fetchAll();
                foreach ($rows as $r) self::$rows[$r['setting_key']] = json_decode((string)$r['value_json'], true);
            } catch (\Throwable $e) {
                // table not migrated yet → constants apply
                error_log('[FitFyce] platform_settings unavailable: ' . $e->getMessage());
            }
        }
        return self::$rows[$key] ?? null;
    }
}
