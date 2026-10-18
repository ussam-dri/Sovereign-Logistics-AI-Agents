-- sovereignty_audit only

CREATE TABLE IF NOT EXISTS sharing_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_org VARCHAR(64) NOT NULL,
    target_org VARCHAR(64),
    intent VARCHAR(128) NOT NULL,
    raw_payload_hash VARCHAR(64) NOT NULL,
    sanitized_payload JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS policy_decisions (
    id SERIAL PRIMARY KEY,
    request_id UUID NOT NULL REFERENCES sharing_requests(id) ON DELETE CASCADE,
    policy_id VARCHAR(128) NOT NULL,
    allowed_fields TEXT[] DEFAULT '{}',
    rejected_fields TEXT[] DEFAULT '{}',
    action VARCHAR(32) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS collaboration_events (
    id SERIAL PRIMARY KEY,
    task_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    org_id VARCHAR(64),
    payload JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_ledger (
    id SERIAL PRIMARY KEY,
    prev_hash VARCHAR(64) NOT NULL DEFAULT '',
    event_json JSONB NOT NULL,
    event_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sharing_requests_created ON sharing_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collab_task ON collaboration_events(task_id);
