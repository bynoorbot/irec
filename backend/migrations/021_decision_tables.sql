-- 021_decision_tables.sql
-- Owner-only weekly decision engine: personal blacklist, ETF whitelist, log.
-- Rules: "Never" is permanent until manually cleared; "Not now" may resurface.
-- ETF rows: only status='approved' may be recommended; system may add 'proposed'.

CREATE TABLE IF NOT EXISTS decision_blacklist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    ticker TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('never', 'not_now')),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, ticker)
);

CREATE TABLE IF NOT EXISTS decision_etf_whitelist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    ticker TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, ticker)
);

CREATE TABLE IF NOT EXISTS decision_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    action TEXT NOT NULL,
    ticker TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_decision_blacklist_user ON decision_blacklist(user_id);
CREATE INDEX IF NOT EXISTS idx_decision_etf_user ON decision_etf_whitelist(user_id);
CREATE INDEX IF NOT EXISTS idx_decision_log_user ON decision_log(user_id, created_at DESC);

ALTER TABLE decision_blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_etf_whitelist ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own blacklist" ON decision_blacklist FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own etf whitelist" ON decision_etf_whitelist FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users manage own decision log" ON decision_log FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
