-- Two-factor on staff sign-in. The secret an authenticator app shares, whether
-- it has been switched on, and the one-time backup codes (kept only as hashes).
ALTER TABLE staff_users ADD COLUMN totp_secret TEXT;
ALTER TABLE staff_users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staff_users ADD COLUMN backup_codes_json TEXT NOT NULL DEFAULT '[]';
