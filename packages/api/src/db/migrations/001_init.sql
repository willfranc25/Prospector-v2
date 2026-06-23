-- Hermes Pro — Database Schema v4.0
-- PostgreSQL + pgvector

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- NICHES
-- ============================================
CREATE TABLE niches (
    id          TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    weight      INTEGER NOT NULL DEFAULT 50 CHECK (weight BETWEEN 0 AND 100),
    keywords    TEXT[] NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- CUSTOMERS (seed accounts — confirmed buyers)
-- ============================================
CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username        TEXT NOT NULL UNIQUE,
    niche_id        TEXT REFERENCES niches(id),
    notes           TEXT,
    added_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    last_used_as_seed TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_niche ON customers(niche_id);
CREATE INDEX idx_customers_last_seed ON customers(last_used_as_seed);

-- ============================================
-- PROFILES (discovered prospects)
-- ============================================
CREATE TABLE profiles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username        TEXT NOT NULL,
    bio             TEXT DEFAULT '',
    followers       INTEGER NOT NULL DEFAULT 0,
    following       INTEGER NOT NULL DEFAULT 0,
    posts_count     INTEGER NOT NULL DEFAULT 0,
    is_private      BOOLEAN NOT NULL DEFAULT false,
    is_verified     BOOLEAN NOT NULL DEFAULT false,
    is_business     BOOLEAN NOT NULL DEFAULT false,
    external_url    TEXT DEFAULT '',
    profile_pic_url TEXT DEFAULT '',
    category        TEXT DEFAULT '',
    full_name       TEXT DEFAULT '',

    -- Discovery metadata
    discovery_source    TEXT,        -- 'followers_seed', 'hashtag', 'semantic_search', etc.
    discovery_seed_id   UUID,       -- which customer was used as seed
    discovery_batch_id  TEXT,       -- batch identifier
    discovery_date      DATE NOT NULL DEFAULT CURRENT_DATE,

    -- ML scoring
    niche_id        TEXT REFERENCES niches(id),
    score           INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    score_details   JSONB DEFAULT '{}',   -- {class, probabilities, signals, ...}
    embedding       vector(1024),         -- text embedding for semantic search

    -- Review state
    status          TEXT NOT NULL DEFAULT 'discovered'
                    CHECK (status IN ('discovered','nuevo','aprobado','descartado','contactado','cliente')),
    manual_signals  TEXT[] DEFAULT '{}',  -- ['vende','contenido','lifestyle','negocio','activo','link']
    reviewer_notes  TEXT DEFAULT '',
    review_date     TIMESTAMPTZ,
    status_date     DATE,

    -- Engagement data (from enrichment)
    engagement_rate     REAL,
    avg_likes           REAL,
    avg_comments        REAL,
    latest_posts        JSONB DEFAULT '[]',  -- last 12 posts with captions
    posting_frequency   REAL,

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_status ON profiles(status);
CREATE INDEX idx_profiles_niche ON profiles(niche_id);
CREATE INDEX idx_profiles_score ON profiles(score DESC);
CREATE INDEX idx_profiles_username ON profiles(username);
CREATE INDEX idx_profiles_discovery_date ON profiles(discovery_date);
CREATE INDEX idx_profiles_embedding ON profiles USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================
-- PIPELINE RUNS (track each discovery execution)
-- ============================================
CREATE TABLE pipeline_runs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    strategy        TEXT NOT NULL,          -- 'followers_seed', 'hashtag', 'semantic', etc.
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed')),
    input_config    JSONB DEFAULT '{}',     -- what was passed to the scraper
    stats           JSONB DEFAULT '{}',     -- {total, passed, rejected, high_priority, ...}
    error_message   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX idx_pipeline_runs_strategy ON pipeline_runs(strategy);

-- ============================================
-- FEEDBACK LOG (every human action)
-- ============================================
CREATE TABLE feedback_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    action          TEXT NOT NULL
                    CHECK (action IN ('aprobado','descartado','contactado','cliente','favorito')),
    signals         TEXT[] DEFAULT '{}',
    reviewer_id     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_profile ON feedback_log(profile_id);
CREATE INDEX idx_feedback_action ON feedback_log(action);
CREATE INDEX idx_feedback_created ON feedback_log(created_at);

-- ============================================
-- DAILY STATS (aggregated metrics)
-- ============================================
CREATE TABLE daily_stats (
    date            DATE NOT NULL,
    discovered      INTEGER NOT NULL DEFAULT 0,
    aprobado        INTEGER NOT NULL DEFAULT 0,
    descartado      INTEGER NOT NULL DEFAULT 0,
    contactado      INTEGER NOT NULL DEFAULT 0,
    cliente         INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (date)
);

-- ============================================
-- MODEL METRICS (track ML performance over time)
-- ============================================
CREATE TABLE model_metrics (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_version   TEXT NOT NULL,
    accuracy        REAL,
    roc_auc         REAL,
    ndcg_50         REAL,
    precision_100   REAL,
    n_samples       INTEGER,
    is_active       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- DISCOVERY STRATEGIES CONFIG
-- ============================================
CREATE TABLE discovery_strategies (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    schedule        TEXT NOT NULL,           -- 'daily', 'weekly', 'manual'
    priority        INTEGER NOT NULL DEFAULT 5,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    config          JSONB DEFAULT '{}',
    last_run_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- SYSTEM SETTINGS
-- ============================================
CREATE TABLE settings (
    key             TEXT PRIMARY KEY,
    value           JSONB NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- INSERT SEED DATA
-- ============================================
INSERT INTO niches (id, label, weight, keywords) VALUES
('salud', 'Salud y profesionales médicos', 88, ARRAY[
    'dra','dr.','doctor','doctora','médic','medicina','nutrici','nutriólog',
    'psicólog','psicolog','fisio','cirug','pediatr','odont','dentista','terapia',
    'clínica','clinica','consultorio','kinesiolog','tricólogo','dermatólog','dermatolog'
]),
('dinero', 'Alto poder adquisitivo / negocio propio', 82, ARRAY[
    'ceo','founder','co-founder','empresari','emprendedor','emprendedora',
    'dueñ','negocio propio','inversionista','real estate','bienes raíces',
    'inmobiliari','lujo','marca propia','ejecutiv','presidente','director general'
]),
('redes', 'Marketing y redes sociales (profesión)', 80, ARRAY[
    'community manager','social media','creador de contenido','content creator',
    'influencer','ugc','marketing digital','agencia digital','copywriter','branding',
    'growth','gestión de redes','estratega digital'
]),
('belleza', 'Belleza, fitness y bienestar', 68, ARRAY[
    'hair','beauty','salon','spa','estétic','estetic','maquillad',
    'entrenador','entrenadora','coach de vida','yoga','pilates','kine','boxing',
    'wellness','bienestar','fitness'
]),
('finanzas', 'Finanzas e inversiones', 64, ARRAY[
    'trader','inversión','inversion','finanzas','cripto','criptomoned','ingresos',
    'libertad financiera','asesor financiero','bolsa','educación financiera'
]),
('personal', 'Marca personal / creador en crecimiento', 58, ARRAY[
    'marca personal','mi negocio','emprendiendo','contenido','creadora','creador',
    'lifestyle','coach','mentor','mentoría'
]),
('arte', 'Música, arte y entretenimiento', 48, ARRAY[
    'cantante','música','musica','músico','musico','artista','arte','podcast',
    'dj','compositor','banda','actor','actriz'
]),
('otro', 'Sin nicho claro', 25, ARRAY[]::text[]);

INSERT INTO discovery_strategies (id, name, description, schedule, priority, config) VALUES
('followers_seed', 'Followers de semillas', 'Extrae seguidores de clientes confirmados', 'daily', 10, '{"actorId":"apify~instagram-scraper","resultsLimit":500}'),
('following_seed', 'Following de semillas', 'Extrae a quién siguen los clientes confirmados', 'weekly', 8, '{"actorId":"apify~instagram-scraper","resultsLimit":200}'),
('hashtag', 'Hashtags por nicho', 'Busca perfiles en hashtags profesionales', 'daily', 7, '{"actorId":"apify~instagram-hashtag-scraper","resultsLimit":300}'),
('semantic_search', 'Búsqueda semántica', 'Encuentra perfiles similares a top clients vía embeddings', 'weekly', 9, '{}'),
('location', 'Búsqueda por ubicación', 'Busca perfiles en ciudades objetivo', 'weekly', 6, '{}'),
('competitor', 'Seguidores de competidores', 'Extrae seguidores de líderes de cada nicho', 'weekly', 7, '{}'),
('verified_small', 'Verificados pequeños', 'Busca cuentas verificadas con <200k seguidores', 'manual', 5, '{}'),
('lookalike_expansion', 'Expansión por similitud', 'Auto-descubre seeds similares a top performers', 'weekly', 8, '{}');

INSERT INTO settings (key, value) VALUES
('filters', '{"minFollowers":3000,"maxFollowers":200000,"minPosts":9,"filterPrivate":true,"filterNoBio":true,"requireSpanish":true,"requireTargetLocation":true}'),
('benchmark', '{"perHour":125,"description":"500 perfiles en 4 horas manual"}'),
('apify', '{"token":"","followerActorId":"apify~instagram-scraper","profileActorId":"dSCLg0C3YEZ83HzYX","defaultLimit":500}'),
('batch', '{"size":14,"cooldownDays":14}'),
('ml', '{"minSamplesForRetrain":50,"activeLearningBatchSize":25,"embeddingModel":"intfloat/multilingual-e5-large","retrainSchedule":"0 3 * * *"}');
