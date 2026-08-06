CREATE TABLE IF NOT EXISTS user_refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  remember_me BOOLEAN NOT NULL DEFAULT FALSE,
  device_id TEXT,
  branch_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_refresh_tokens_user_id ON user_refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_refresh_tokens_token_hash ON user_refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_refresh_tokens_active
  ON user_refresh_tokens(user_id, expires_at)
  WHERE revoked_at IS NULL;
