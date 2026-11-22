-- 0001_compliance.sql
-- Owned DDL baseline of the compliance module (`@bslt/compliance`):
-- legal documents, consent & acceptance records, data export/deletion requests,
-- legal holds, retention policies, age-assurance outcome records, and
-- per-jurisdiction eligibility rules.
--
-- Depends on: kernel, identity (users).
--
-- Required seeds: seeds/0001_legal_templates.sql.
--
-- Commands per role (sys_apply_rls: user, admin, system):
--
--   table                            class        user                    admin                   system
--   compliance_legal_documents       public_read  select                  select, insert          select
--   compliance_consents              append_only  select, insert          -                       select, insert
--   compliance_data_requests         owner_user   select, insert, update  -                       select, delete
--   compliance_legal_holds           system       -                       select, insert, update  select, insert, update
--   compliance_retention_policies    system       -                       select, insert, update  select
--   compliance_age_assurance_checks  owner_user   select, insert          select                  select, insert, update, delete
--   compliance_jurisdiction_rules    public_read  select                  select, insert, update  select

CREATE TABLE compliance_legal_documents (
    id           uuid        NOT NULL DEFAULT uuid_generate_v4(),
    type         text        NOT NULL,
    title        text        NOT NULL,
    content      text        NOT NULL,
    version      integer     NOT NULL DEFAULT 1,
    effective_at timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT compliance_legal_documents_pkey PRIMARY KEY (id),
    CONSTRAINT compliance_legal_documents_version_unique UNIQUE (type, version),
    CONSTRAINT compliance_legal_documents_version_positive CHECK ((version >= 1))
);

CREATE INDEX idx_compliance_legal_documents_effective ON compliance_legal_documents (type, effective_at DESC);
CREATE INDEX idx_compliance_legal_documents_type ON compliance_legal_documents (type, version DESC);

SELECT sys_apply_rls(
    'compliance_legal_documents', 'public_read', NULL,
    ARRAY['select'],
    ARRAY['select', 'insert'],
    ARRAY['select']
);

CREATE TABLE compliance_consents (
    id           uuid        NOT NULL DEFAULT uuid_generate_v4(),
    user_id      uuid        NOT NULL,
    record_type  text        NOT NULL,
    document_id  uuid,
    consent_type text,
    granted      boolean,
    ip_address   text,
    user_agent   text,
    metadata     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT compliance_consents_pkey PRIMARY KEY (id),
    CONSTRAINT compliance_consents_record_type_check CHECK ((record_type = ANY (ARRAY['legal_document'::text, 'consent_preference'::text]))),
    CONSTRAINT compliance_consents_document_id_fkey FOREIGN KEY (document_id) REFERENCES compliance_legal_documents(id) ON DELETE RESTRICT,
    CONSTRAINT compliance_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_compliance_consents_document ON compliance_consents (document_id) WHERE (document_id IS NOT NULL);
CREATE INDEX idx_compliance_consents_user ON compliance_consents (user_id, created_at DESC);
CREATE INDEX idx_compliance_consents_user_consent ON compliance_consents (user_id, consent_type, created_at DESC) WHERE (consent_type IS NOT NULL);
CREATE INDEX idx_compliance_consents_user_doc ON compliance_consents (user_id, document_id) WHERE (document_id IS NOT NULL);

SELECT sys_apply_rls(
    'compliance_consents', 'append_only', 'user_id',
    ARRAY['select', 'insert'],
    ARRAY[]::text[],
    ARRAY['select', 'insert']
);

CREATE TABLE compliance_data_requests (
    id            uuid        NOT NULL DEFAULT uuid_generate_v4(),
    user_id       uuid        NOT NULL,
    type          text        NOT NULL,
    status        text        NOT NULL DEFAULT 'pending'::text,
    format        text        NOT NULL DEFAULT 'json'::text,
    download_url  text,
    expires_at    timestamptz,
    completed_at  timestamptz,
    error_message text,
    metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT compliance_data_requests_pkey PRIMARY KEY (id),
    CONSTRAINT compliance_data_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'canceled'::text]))),
    CONSTRAINT compliance_data_requests_type_check CHECK ((type = ANY (ARRAY['export'::text, 'deletion'::text]))),
    CONSTRAINT compliance_data_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_compliance_data_requests_expires ON compliance_data_requests (expires_at) WHERE ((expires_at IS NOT NULL) AND (status <> 'completed'::text));
CREATE INDEX idx_compliance_data_requests_status ON compliance_data_requests (status);
CREATE INDEX idx_compliance_data_requests_user ON compliance_data_requests (user_id, created_at DESC);

SELECT sys_apply_rls(
    'compliance_data_requests', 'owner_user', 'user_id',
    ARRAY['select', 'insert', 'update'],
    ARRAY[]::text[],
    ARRAY['select', 'delete']
);

CREATE TABLE compliance_legal_holds (
    id                  uuid        NOT NULL DEFAULT uuid_generate_v4(),
    subject_type        text        NOT NULL,
    subject_id          text        NOT NULL,
    reason              text        NOT NULL,
    created_by_user_id  uuid,
    held_until          timestamptz,
    released_at         timestamptz,
    released_by_user_id uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT compliance_legal_holds_pkey PRIMARY KEY (id),
    CONSTRAINT compliance_legal_holds_subject_type_check CHECK ((subject_type = ANY (ARRAY['user'::text, 'org'::text, 'file'::text, 'case'::text, 'other'::text]))),
    CONSTRAINT compliance_legal_holds_subject_id_check CHECK ((char_length(TRIM(BOTH FROM subject_id)) > 0)),
    CONSTRAINT compliance_legal_holds_reason_check CHECK ((char_length(TRIM(BOTH FROM reason)) > 0)),
    CONSTRAINT compliance_legal_holds_created_by_fkey FOREIGN KEY (created_by_user_id) REFERENCES identity_users(id) ON DELETE SET NULL,
    CONSTRAINT compliance_legal_holds_released_by_fkey FOREIGN KEY (released_by_user_id) REFERENCES identity_users(id) ON DELETE SET NULL
);

CREATE INDEX idx_compliance_legal_holds_active_subject ON compliance_legal_holds (subject_type, subject_id) WHERE (released_at IS NULL);
CREATE INDEX idx_compliance_legal_holds_created ON compliance_legal_holds (created_at DESC);

CREATE TRIGGER update_compliance_legal_holds_updated_at BEFORE UPDATE ON compliance_legal_holds FOR EACH ROW EXECUTE FUNCTION sys_update_updated_at_column();

SELECT sys_apply_rls(
    'compliance_legal_holds', 'system', NULL,
    ARRAY[]::text[],
    ARRAY['select', 'insert', 'update'],
    ARRAY['select', 'insert', 'update']
);

CREATE TABLE compliance_retention_policies (
    category              text        NOT NULL,
    retention_days        integer     NOT NULL,
    archive_before_delete boolean     NOT NULL DEFAULT false,
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT compliance_retention_policies_pkey PRIMARY KEY (category),
    CONSTRAINT compliance_retention_policies_category_check CHECK ((char_length(TRIM(BOTH FROM category)) > 0)),
    CONSTRAINT compliance_retention_policies_days_check CHECK ((retention_days >= 1))
);

CREATE TRIGGER update_compliance_retention_policies_updated_at BEFORE UPDATE ON compliance_retention_policies FOR EACH ROW EXECUTE FUNCTION sys_update_updated_at_column();

SELECT sys_apply_rls(
    'compliance_retention_policies', 'system', NULL,
    ARRAY[]::text[],
    ARRAY['select', 'insert', 'update'],
    ARRAY['select']
);

-- Age-assurance outcomes only: never stores date of birth or document images.
CREATE TABLE compliance_age_assurance_checks (
    id                    uuid        NOT NULL DEFAULT uuid_generate_v4(),
    user_id               uuid        NOT NULL,
    provider              text        NOT NULL,
    method                text        NOT NULL,
    threshold             integer     NOT NULL,
    result_over_threshold boolean     NOT NULL,
    assurance_level       text        NOT NULL,
    jurisdiction          text,
    provider_ref          text,
    checked_at            timestamptz NOT NULL DEFAULT now(),
    expires_at            timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT compliance_age_assurance_checks_pkey PRIMARY KEY (id),
    CONSTRAINT compliance_age_assurance_checks_method_check CHECK ((method = ANY (ARRAY['attestation'::text, 'facial_estimation'::text, 'document'::text, 'eid_wallet'::text, 'credit_card'::text, 'reusable_token'::text]))),
    CONSTRAINT compliance_age_assurance_checks_level_check CHECK ((assurance_level = ANY (ARRAY['self_attested'::text, 'standard'::text, 'high'::text]))),
    CONSTRAINT compliance_age_assurance_checks_threshold_check CHECK (((threshold >= 13) AND (threshold <= 120))),
    CONSTRAINT compliance_age_assurance_checks_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_compliance_age_assurance_checks_user ON compliance_age_assurance_checks (user_id, checked_at DESC);

SELECT sys_apply_rls(
    'compliance_age_assurance_checks', 'owner_user', 'user_id',
    ARRAY['select', 'insert'],
    ARRAY['select'],
    ARRAY['select', 'insert', 'update', 'delete']
);

CREATE TABLE compliance_jurisdiction_rules (
    jurisdiction           text        NOT NULL,
    minimum_age            integer     NOT NULL DEFAULT 13,
    requires_age_assurance boolean     NOT NULL DEFAULT false,
    allowed_methods        text[]      NOT NULL DEFAULT ARRAY['attestation'::text],
    service_available      boolean     NOT NULL DEFAULT true,
    updated_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT compliance_jurisdiction_rules_pkey PRIMARY KEY (jurisdiction),
    CONSTRAINT compliance_jurisdiction_rules_code_check CHECK ((char_length(TRIM(BOTH FROM jurisdiction)) >= 2)),
    CONSTRAINT compliance_jurisdiction_rules_min_age_check CHECK (((minimum_age >= 13) AND (minimum_age <= 120)))
);

CREATE TRIGGER update_compliance_jurisdiction_rules_updated_at BEFORE UPDATE ON compliance_jurisdiction_rules FOR EACH ROW EXECUTE FUNCTION sys_update_updated_at_column();

SELECT sys_apply_rls(
    'compliance_jurisdiction_rules', 'public_read', NULL,
    ARRAY['select'],
    ARRAY['select', 'insert', 'update'],
    ARRAY['select']
);
