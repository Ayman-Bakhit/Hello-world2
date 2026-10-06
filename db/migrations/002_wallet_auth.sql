-- 002_wallet_auth: support for Solana wallet-signature sign-in. Additive.
-- Existing auth_nonces / sessions tables were never written in production-capable code paths
-- (sign-in returned 501 before this migration), so the NOT NULL additions are safe; defaults are dropped
-- so application code must always supply real values.

-- Challenge text is stored verbatim so verification can require an exact match with what the server issued.
ALTER TABLE auth_nonces ADD COLUMN message text NOT NULL DEFAULT '';
ALTER TABLE auth_nonces ADD COLUMN domain text NOT NULL DEFAULT '';
ALTER TABLE auth_nonces ADD COLUMN chain_id text NOT NULL DEFAULT '';
ALTER TABLE auth_nonces ALTER COLUMN message DROP DEFAULT;
ALTER TABLE auth_nonces ALTER COLUMN domain DROP DEFAULT;
ALTER TABLE auth_nonces ALTER COLUMN chain_id DROP DEFAULT;
ALTER TABLE auth_nonces ADD CONSTRAINT auth_nonces_nonce_format CHECK (nonce ~ '^[A-Za-z0-9_-]{32}$');
ALTER TABLE auth_nonces ADD CONSTRAINT auth_nonces_consumed_after_issue CHECK (consumed_at IS NULL OR consumed_at >= issued_at);
CREATE INDEX auth_nonces_address_idx ON auth_nonces (address, issued_at DESC);
CREATE INDEX auth_nonces_expires_idx ON auth_nonces (expires_at);

-- Sessions record how they were created. Pre-existing rows can only have come from the dev-only endpoint.
ALTER TABLE sessions ADD COLUMN auth_method text NOT NULL DEFAULT 'dev_insecure' CHECK (auth_method IN ('wallet_signature','dev_insecure'));
ALTER TABLE sessions ALTER COLUMN auth_method DROP DEFAULT;
ALTER TABLE sessions ADD COLUMN wallet_id uuid REFERENCES wallets(id);
-- A wallet-signature session must name the wallet that signed.
ALTER TABLE sessions ADD CONSTRAINT sessions_wallet_session_has_wallet CHECK (auth_method <> 'wallet_signature' OR wallet_id IS NOT NULL);

-- Demo wallets are fictional and can never be "verified".
ALTER TABLE wallets ADD CONSTRAINT wallets_demo_never_verified CHECK (data_source <> 'demo' OR ownership_verified_at IS NULL);
