<?php

declare(strict_types=1);

namespace TryFit\Db;

use PDO;

/**
 * Wallet-credit accounting. All balance mutations go through debit()/credit(),
 * which run the UPDATE and the ledger INSERT inside the same transaction so
 * `wallet_credits = SUM(credit_transactions.delta)` is always preserved.
 *
 * No fixed plans or monthly limits — credits never expire, and a merchant can
 * only act while `wallet_credits > 0`.
 */
class WalletRepo
{
    private PDO $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public function balance(int $merchantId): int
    {
        $stmt = $this->db->prepare(
            'SELECT wallet_credits FROM merchants WHERE id = ? LIMIT 1'
        );
        $stmt->execute([$merchantId]);
        $v = $stmt->fetchColumn();
        return $v === false ? 0 : (int)$v;
    }

    public function totalDebited(int $merchantId): int
    {
        $stmt = $this->db->prepare(
            'SELECT wallet_total_debited FROM merchants WHERE id = ? LIMIT 1'
        );
        $stmt->execute([$merchantId]);
        $v = $stmt->fetchColumn();
        return $v === false ? 0 : (int)$v;
    }

    /**
     * Atomically takes $credits off the wallet; returns false if the merchant
     * doesn't have enough. A single conditional UPDATE so concurrent requests
     * can't both pass the check and overspend.
     */
    public function debit(int $merchantId, int $credits, string $reason, ?string $refType = null, ?string $refId = null, ?string $note = null): bool
    {
        if ($credits <= 0) {
            return true;
        }
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                'UPDATE merchants
                    SET wallet_credits        = wallet_credits - ?,
                        wallet_total_debited  = wallet_total_debited + ?
                  WHERE id = ? AND wallet_credits >= ?'
            );
            $stmt->execute([$credits, $credits, $merchantId, $credits]);
            if ($stmt->rowCount() !== 1) {
                $this->db->rollBack();
                return false;
            }
            $this->writeLedger($merchantId, -$credits, $reason, $refType, $refId, $note);
            $this->db->commit();
            if (class_exists(\TryFit\Src\PlatformSync::class)) {
                \TryFit\Src\PlatformSync::walletChanged($merchantId);   // platform admin mirrors the wallet
            }
            return true;
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
    }

    /** Adds credits (purchase, welcome bonus, refund, admin grant). */
    public function credit(int $merchantId, int $credits, string $reason, ?string $refType = null, ?string $refId = null, ?string $note = null): int
    {
        if ($credits <= 0) {
            return $this->balance($merchantId);
        }
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                'UPDATE merchants SET wallet_credits = wallet_credits + ? WHERE id = ?'
            );
            $stmt->execute([$credits, $merchantId]);
            $this->writeLedger($merchantId, $credits, $reason, $refType, $refId, $note);
            $this->db->commit();
            if (class_exists(\TryFit\Src\PlatformSync::class)) {
                \TryFit\Src\PlatformSync::walletChanged($merchantId);   // platform admin mirrors the wallet
            }
            return $this->balance($merchantId);
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
    }

    /** Gives back credits taken by debit() when the action then failed. */
    public function release(int $merchantId, int $credits, string $refType = null, string $refId = null): void
    {
        if ($credits <= 0) {
            return;
        }
        $this->credit($merchantId, $credits, 'release', $refType, $refId, 'Released after failure');
    }

    /** Last N ledger rows (reverse-chronological) for the wallet page. */
    public function recentTransactions(int $merchantId, int $limit = 20): array
    {
        $limit = max(1, min(100, $limit));
        $stmt  = $this->db->prepare(
            'SELECT id, delta, reason, reference_type, reference_id, balance_after, note, created_at
               FROM credit_transactions
              WHERE merchant_id = ?
              ORDER BY id DESC
              LIMIT ' . $limit
        );
        $stmt->execute([$merchantId]);
        return $stmt->fetchAll();
    }

    private function writeLedger(int $merchantId, int $delta, string $reason, ?string $refType, ?string $refId, ?string $note): void
    {
        $balance = $this->balance($merchantId);
        $stmt = $this->db->prepare(
            'INSERT INTO credit_transactions
               (merchant_id, delta, reason, reference_type, reference_id, balance_after, note)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$merchantId, $delta, $reason, $refType, $refId, $balance, $note]);
    }

    // ── Payment orders ─────────────────────────────────────────────────────

    public function createPaymentOrder(int $merchantId, string $provider, string $providerOrderId, int $amountMinor, string $currency, int $credits): int
    {
        $stmt = $this->db->prepare(
            'INSERT INTO credit_payments
               (merchant_id, provider, provider_order_id, amount_minor, currency, credits)
             VALUES (?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$merchantId, $provider, $providerOrderId, $amountMinor, strtoupper($currency), $credits]);
        return (int)$this->db->lastInsertId();
    }

    public function findPaymentOrder(string $provider, string $providerOrderId): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT * FROM credit_payments WHERE provider = ? AND provider_order_id = ? LIMIT 1'
        );
        $stmt->execute([$provider, $providerOrderId]);
        $row = $stmt->fetch();
        return $row !== false ? $row : null;
    }

    /**
     * Marks the payment captured and credits the wallet in one transaction.
     * Idempotent: a repeat call for the same captured order is a no-op, so
     * replayed webhooks never double-credit.
     */
    public function capturePayment(int $paymentId, ?string $providerPaymentId = null): ?array
    {
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                'SELECT * FROM credit_payments WHERE id = ? FOR UPDATE'
            );
            $stmt->execute([$paymentId]);
            $row = $stmt->fetch();
            if ($row === false) {
                $this->db->rollBack();
                return null;
            }
            if ($row['status'] === 'captured') {
                $this->db->rollBack();
                return $row;
            }

            $upd = $this->db->prepare(
                'UPDATE credit_payments
                    SET status = \'captured\', provider_payment_id = ?, captured_at = NOW()
                  WHERE id = ?'
            );
            $upd->execute([$providerPaymentId, $paymentId]);

            // Apply the credit as the merchant.
            $merchantId = (int)$row['merchant_id'];
            $credits    = (int)$row['credits'];

            $addCredits = $this->db->prepare(
                'UPDATE merchants SET wallet_credits = wallet_credits + ? WHERE id = ?'
            );
            $addCredits->execute([$credits, $merchantId]);

            $this->writeLedger(
                $merchantId,
                $credits,
                'purchase',
                'credit_payment',
                (string)$paymentId,
                "Captured {$row['provider']} order {$row['provider_order_id']}"
            );

            $this->db->commit();

            $row['status']              = 'captured';
            $row['provider_payment_id'] = $providerPaymentId;
            return $row;
        } catch (\Throwable $e) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $e;
        }
    }
}
