CREATE TABLE accounts (
  id uuid PRIMARY KEY, subject text NOT NULL UNIQUE CHECK (subject IN ('alice','bob')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  sequence bigint NOT NULL DEFAULT 0, sync_epoch uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE service_secrets (id text PRIMARY KEY, value text NOT NULL);
CREATE TABLE sessions (
  id uuid PRIMARY KEY, owner uuid NOT NULL REFERENCES accounts(id), token_hash char(64) NOT NULL UNIQUE,
  csrf_hash char(64) NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  UNIQUE(owner,id)
);
CREATE TABLE custom_places (
  id uuid PRIMARY KEY, owner uuid NOT NULL REFERENCES accounts(id), client_id text NOT NULL,
  input_hash char(64) NOT NULL, data jsonb NOT NULL, version bigint NOT NULL DEFAULT 1, deleted_at timestamptz,
  UNIQUE(owner,client_id), UNIQUE(owner,id)
);
CREATE TABLE visits (
  id uuid PRIMARY KEY, owner uuid NOT NULL REFERENCES accounts(id), client_id text NOT NULL,
  input_hash char(64) NOT NULL, place_key text NOT NULL, custom_place_id uuid, data jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 1, deleted_at timestamptz,
  UNIQUE(owner,client_id), UNIQUE(owner,id),
  FOREIGN KEY(owner,custom_place_id) REFERENCES custom_places(owner,id)
);
CREATE TABLE photos (
  id uuid PRIMARY KEY, owner uuid NOT NULL REFERENCES accounts(id), client_id text NOT NULL,
  input_hash char(64) NOT NULL, data jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('prepared','uploaded','ready','rejected','deleted')),
  visit_id uuid, object_key text NOT NULL UNIQUE, version bigint NOT NULL DEFAULT 1, deleted_at timestamptz,
  UNIQUE(owner,client_id), UNIQUE(owner,id), FOREIGN KEY(owner,visit_id) REFERENCES visits(owner,id)
);
CREATE TABLE uploads (
  id uuid PRIMARY KEY, owner uuid NOT NULL REFERENCES accounts(id), photo_id uuid NOT NULL UNIQUE,
  session_id uuid NOT NULL, generation uuid NOT NULL, token_hash char(64) NOT NULL,
  incoming_key text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('prepared','uploaded','ready','rejected','cancelled','expired')),
  FOREIGN KEY(owner,photo_id) REFERENCES photos(owner,id), FOREIGN KEY(owner,session_id) REFERENCES sessions(owner,id)
);
CREATE TABLE map_covers (
  owner uuid NOT NULL REFERENCES accounts(id), place_key text NOT NULL, visit_id uuid NOT NULL,
  photo_id uuid NOT NULL, version bigint NOT NULL DEFAULT 1, deleted_at timestamptz,
  PRIMARY KEY(owner,place_key), FOREIGN KEY(owner,visit_id) REFERENCES visits(owner,id), FOREIGN KEY(owner,photo_id) REFERENCES photos(owner,id)
);
CREATE TABLE mutation_receipts (
  owner uuid NOT NULL REFERENCES accounts(id), operation_id text NOT NULL, request_hash char(64) NOT NULL,
  status integer NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner,operation_id)
);
CREATE TABLE sync_commits (
  owner uuid NOT NULL REFERENCES accounts(id), sequence bigint NOT NULL, id uuid NOT NULL UNIQUE,
  changes jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner,sequence)
);
CREATE TABLE download_grants (
  token_hash char(64) PRIMARY KEY, owner uuid NOT NULL, photo_id uuid NOT NULL, session_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  FOREIGN KEY(owner,photo_id) REFERENCES photos(owner,id), FOREIGN KEY(owner,session_id) REFERENCES sessions(owner,id)
);
CREATE TABLE cleanup_tasks (
  id uuid PRIMARY KEY, owner uuid NOT NULL REFERENCES accounts(id), photo_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE, kind text NOT NULL CHECK (kind IN ('incoming','photo')),
  due_at timestamptz NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','done')),
  attempts integer NOT NULL DEFAULT 0, last_error text,
  FOREIGN KEY(owner,photo_id) REFERENCES photos(owner,id)
);
CREATE INDEX cleanup_due ON cleanup_tasks(owner,state,due_at);
CREATE INDEX visit_owner ON visits(owner,id);
CREATE INDEX session_owner ON sessions(owner);
