-- 0001: клиенты, сообщения, попытки доставки.

CREATE TABLE clients (
  id uuid PRIMARY KEY,
  name varchar(256) NOT NULL,
  api_key_hash varchar(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients(id),
  recipient varchar(512) NOT NULL,
  text varchar(4096) NOT NULL,
  channels varchar(256) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_client ON messages (client_id);

CREATE TABLE delivery_attempts (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES messages(id),
  channel varchar(32) NOT NULL,
  status varchar(32) NOT NULL
    CHECK (status IN ('ok', 'retryable_error', 'permanent_error')),
  latency_ms integer NOT NULL,
  error varchar(1024),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_attempts_message ON delivery_attempts (message_id);
CREATE INDEX idx_attempts_created ON delivery_attempts (created_at);
