CREATE TABLE chat_sessions (
 id uuid PRIMARY KEY, token_hash text UNIQUE NOT NULL, branch_id uuid NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '8 hours', revoked_at timestamptz
);
CREATE TABLE conversations (
 id uuid PRIMARY KEY, session_id uuid UNIQUE NOT NULL REFERENCES chat_sessions(id), branch_id uuid NOT NULL,
 mode text NOT NULL DEFAULT 'AI' CHECK(mode IN ('AI','HUMAN')), owner_id uuid,
 version integer NOT NULL DEFAULT 1, watermark integer NOT NULL DEFAULT 0,
 error_code text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE chat_messages (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id),
 dedup_key text NOT NULL, direction text NOT NULL CHECK(direction IN ('IN','OUT')),
 sender text NOT NULL CHECK(sender IN ('GUEST','STAFF','AI','SYSTEM')), text text NOT NULL,
 sources jsonb NOT NULL DEFAULT '[]', model text,
 delivery text NOT NULL CHECK(delivery IN ('RECEIVED','QUEUED','DELIVERED','CANCELLED')),
 conversation_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,dedup_key)
);
CREATE INDEX chat_history ON chat_messages(conversation_id,created_at,id);
CREATE TABLE chat_contexts (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id),
 session_id uuid NOT NULL REFERENCES chat_sessions(id), input jsonb NOT NULL,
 watermark integer NOT NULL, expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
CREATE TABLE conversation_audit (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES conversations(id),
 actor text NOT NULL, action text NOT NULL, version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
