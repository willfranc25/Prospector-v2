"""
Hermes ML Service — Lead classification, scoring, and semantic search.
Uses sentence-transformers for embeddings and XGBoost for classification.
"""

import os
import json
import asyncio
from typing import Optional
from contextlib import asynccontextmanager

import numpy as np
import asyncpg
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

# ── Models (lazy-loaded) ──
text_model: Optional[SentenceTransformer] = None
classifier = None  # XGBoost classifier (trained on feedback)
scaler = None  # StandardScaler
is_fitted = False

DB_URL = os.getenv("DATABASE_URL", "postgresql://hermes:hermes_secret@localhost:5432/hermes")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "intfloat/multilingual-e5-large")
pool: Optional[asyncpg.Pool] = None


async def get_db():
    global pool
    if pool is None:
        pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=10)
    return pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    global pool
    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=10)
    print("✅ ML Service connected to database")
    yield
    if pool:
        await pool.close()


app = FastAPI(title="Hermes ML Service", version="4.0.0", lifespan=lifespan)


# ── Pydantic Schemas ──

class ScoreRequest(BaseModel):
    username: str
    bio: str = ""
    followers: int = 0
    following: int = 0
    posts_count: int = 0
    is_private: bool = False
    is_verified: bool = False
    is_business: bool = False
    external_url: str = ""
    captions: list[str] = []
    engagement_rate: Optional[float] = None
    avg_likes: Optional[float] = None


class ScoreResponse(BaseModel):
    username: str
    score: float
    icp_class: str  # ICP_HIGH, ICP_MEDIUM, ICP_LOW, NOT_ICP
    niche: str
    niche_confidence: float
    signals: dict[str, bool]
    explanation: list[str]


class BatchScoreRequest(BaseModel):
    profiles: list[ScoreRequest]


class SimilarRequest(BaseModel):
    profile_id: Optional[str] = None
    text: Optional[str] = None
    limit: int = 20


class RetrainRequest(BaseModel):
    force: bool = False


# ── Embedding Functions ──

async def get_text_model():
    global text_model
    if text_model is None:
        print(f"Loading embedding model: {EMBEDDING_MODEL}...")
        text_model = SentenceTransformer(EMBEDDING_MODEL)
        print("✅ Embedding model loaded")
    return text_model


def build_profile_text(profile: ScoreRequest) -> str:
    """Build a rich text representation for embedding."""
    parts = [f"passage: {profile.bio}"]
    if profile.captions:
        parts.append(" ".join(profile.captions[:5]))
    if profile.external_url:
        parts.append(f"website: {profile.external_url}")
    return " ".join(parts)


# ── Scoring Engine ──

NICHE_KEYWORDS = {
    "salud": ["dra", "dr.", "doctor", "doctora", "médic", "medicina", "nutrici", "psicólog", "psicolog", "fisio", "cirug", "cirujano", "pediatr", "odont", "dentista", "terapia", "clínica", "clinica", "consultorio", "kinesiolog", "dermatólog", "dermatolog", "paciente", "salud", "plástica", "bariatrica", "cardiolog", "traumatolog", "ginecolog", "urólogo", "neurolog", "oncolog", "oftalmolog", "cirujano estético", "cirujana", "doctor", "doctora", "médic", "medicina", "nutrici",
              "psicólog", "psicolog", "fisio", "cirug", "pediatr", "odont", "dentista",
              "terapia", "clínica", "clinica", "consultorio", "kinesiolog", "dermatólog"],
    "dinero": ["ceo", "founder", "empresari", "emprendedor", "dueñ", "negocio propio",
               "inversionista", "real estate", "bienes raíces", "inmobiliari", "lujo",
               "marca propia", "ejecutiv", "presidente", "director general"],
    "redes": ["community manager", "social media", "creador de contenido", "content creator",
              "influencer", "ugc", "marketing digital", "agencia digital", "copywriter",
              "branding", "growth", "gestión de redes", "estratega digital"],
    "belleza": ["hair", "beauty", "salon", "spa", "estétic", "estetic", "maquillad",
                "entrenador", "coach de vida", "yoga", "pilates", "kine", "boxing",
                "wellness", "bienestar", "fitness"],
    "finanzas": ["trader", "inversión", "inversion", "finanzas", "cripto", "ingresos",
                 "libertad financiera", "asesor financiero", "bolsa", "educación financiera"],
    "personal": ["marca personal", "mi negocio", "emprendiendo", "contenido", "creadora",
                 "creador", "lifestyle", "coach", "mentor", "mentoría"],
    "arte": ["cantante", "música", "musica", "músico", "musico", "artista", "arte",
             "podcast", "dj", "compositor", "banda", "actor", "actriz"]
}

DISCARD_SIGNALS = [
    "viviendo la vida", "just for fun", "cuenta personal",
    "adolescente", "estudiante de secundaria", "memes", "shitpost",
    "agencia de marketing", "agencia digital"
]

ANTI_SIGNALS = {
    "bio_generica": ["viviendo la vida", "just for fun", "personal blog"],
    "inactivo": None,  # Detected from posts_count
    "follow_ratio_alto": None,  # following/followers > 10
    "compra_seguidores": None,  # high followers, low engagement
    "adolescente": ["13 años", "14 años", "15 años", "16 años", "17 años"],
    "cuenta_memes": ["memes", "shitpost", "humor"],
    "otra_agencia": ["agencia de marketing", "agencia digital", "social media agency"]
}


def classify_niche(bio_lower: str) -> tuple[str, float]:
    """Classify profile into niche based on keyword matching with priority."""
    # Higher-priority niches are checked first
    NICHE_PRIORITY = ['salud', 'dinero', 'redes', 'finanzas', 'belleza', 'personal', 'arte']
    
    scores = {}
    for niche_id in NICHE_PRIORITY:
        keywords = NICHE_KEYWORDS.get(niche_id, [])
        hits = sum(1 for kw in keywords if kw in bio_lower)
        if hits > 0:
            scores[niche_id] = hits

    if not scores:
        return "otro", 0.0

    # Pick the one with most keyword matches
    best = max(scores, key=scores.get)
    total_hits = sum(scores.values())
    confidence = scores[best] / total_hits if total_hits > 0 else 0.0

    return best, confidence


def detect_signals(profile: ScoreRequest) -> dict[str, bool]:
    """Detect ICP signals from profile data."""
    bio = (profile.bio or "").lower()
    return {
        "vende": any(kw in bio for kw in ["vende", "venta", "comprar", "producto", "servicio", "consulta", "cita", "turno"]),
        "contenido_profesional": any(kw in bio for kw in ["profesional", "especialista", "experto", "certificad"]),
        "lifestyle": any(kw in bio for kw in ["viaje", "viajero", "lujo", "lifestyle", "aventura"]),
        "negocio_propio": any(kw in bio for kw in ["negocio", "emprend", "fundador", "founder", "ceo", "dueñ", "marca"]),
        "activo": profile.posts_count >= 9,
        "link_bio": bool(profile.external_url),
        "whatsapp": "wa.me" in bio or "whatsapp" in bio,
        "email": "@" in profile.external_url and "." in profile.external_url.split("@")[-1] if profile.external_url else False,
        "verificado": profile.is_verified,
        "business": profile.is_business
    }


def detect_anti_signals(profile: ScoreRequest) -> list[str]:
    """Detect anti-signals that should penalize the score."""
    bio = (profile.bio or "").lower()
    anti = []

    for signal_type, keywords in ANTI_SIGNALS.items():
        if keywords is None:
            if signal_type == "inactivo" and profile.posts_count < 3:
                anti.append(signal_type)
            elif signal_type == "follow_ratio_alto" and profile.followers > 0 and profile.following / profile.followers > 10:
                anti.append(signal_type)
            elif signal_type == "compra_seguidores" and profile.followers > 5000 and profile.engagement_rate is not None and profile.engagement_rate < 0.001:
                anti.append(signal_type)
        else:
            if any(kw in bio for kw in keywords):
                anti.append(signal_type)

    return anti


def calculate_score(profile: ScoreRequest) -> ScoreResponse:
    """Compute multi-dimensional lead score."""
    bio = (profile.bio or "").lower()
    niche_id, niche_conf = classify_niche(bio)
    signals = detect_signals(profile)
    anti = detect_anti_signals(profile)
    explanation: list[str] = []

    score = 50.0  # Base

    # ── Professional signals ──
    prof_count = sum([
        signals["vende"], signals["contenido_profesional"],
        signals["negocio_propio"], signals["business"]
    ])
    score += prof_count * 5
    if prof_count > 0:
        explanation.append(f"+{prof_count * 5} señales profesionales")

    # ── Authority ──
    if profile.followers >= 3000 and profile.followers <= 200000:
        score += 10
        explanation.append("+10 seguidores en rango ideal (3K-200K)")
    elif profile.followers > 200000:
        score -= 3
        explanation.append("-3 seguidores muy altos (>200K)")

    if profile.is_verified:
        score += 8
        explanation.append("+8 cuenta verificada")

    # ── Intent ──
    if profile.external_url:
        score += 7
        explanation.append("+7 tiene link externo")
    if signals["whatsapp"]:
        score += 5
        explanation.append("+5 tiene WhatsApp")
    if signals["email"]:
        score += 4
        explanation.append("+4 tiene email")

    # ── Wealth indicators ──
    if signals["lifestyle"]:
        score += 4
        explanation.append("+4 señales de lifestyle/lujo")

    # ── Activity ──
    if profile.posts_count >= 9:
        score += 4
        explanation.append("+4 cuenta activa (≥9 posts)")
    elif profile.posts_count < 3:
        score -= 10
        explanation.append("-10 muy pocos posts (<3)")

    # ── Engagement ──
    if profile.engagement_rate and profile.engagement_rate > 0.02:
        score += 5
        explanation.append("+5 buen engagement (>2%)")
    elif profile.engagement_rate and profile.engagement_rate < 0.005:
        score -= 5
        explanation.append("-5 engagement bajo (<0.5%)")

    # ── Private penalty ──
    if profile.is_private:
        score -= 30
        explanation.append("-30 cuenta privada")

    # ── Anti-signals ──
    anti_penalties = {
        "bio_generica": ("-15 bio genérica", 15),
        "inactivo": ("-20 perfil inactivo", 20),
        "follow_ratio_alto": ("-10 ratio follows/followers alto", 10),
        "compra_seguidores": ("-20 posible compra de seguidores", 20),
        "adolescente": ("-30 posible adolescente", 30),
        "cuenta_memes": ("-40 cuenta de memes/humor", 40),
        "otra_agencia": ("-50 otra agencia de marketing", 50)
    }
    for a in anti:
        if a in anti_penalties:
            msg, penalty = anti_penalties[a]
            score -= penalty
            explanation.append(msg)

    score = max(0, min(100, score))

    # ── ICP Class ──
    if score >= 70:
        icp_class = "ICP_HIGH"
    elif score >= 50:
        icp_class = "ICP_MEDIUM"
    elif score >= 30:
        icp_class = "ICP_LOW"
    else:
        icp_class = "NOT_ICP"

    return ScoreResponse(
        username=profile.username,
        score=round(score, 1),
        icp_class=icp_class,
        niche=niche_id,
        niche_confidence=round(niche_conf, 2),
        signals=signals,
        explanation=explanation
    )


# ── Routes ──

@app.get("/health")
async def health():
    return {"status": "ok", "service": "hermes-ml", "version": "4.0.0"}


@app.post("/ml/score", response_model=ScoreResponse)
async def score_profile(request: ScoreRequest):
    """Score a single profile."""
    return calculate_score(request)


@app.post("/ml/score/batch", response_model=list[ScoreResponse])
async def score_batch(request: BatchScoreRequest):
    """Score multiple profiles."""
    return [calculate_score(p) for p in request.profiles]


@app.post("/ml/similar/top-clients")
async def find_similar_to_top_clients(request: SimilarRequest = None):
    """Find profiles similar to top-converting clients using embeddings."""
    db = await get_db()
    model = await get_text_model()

    # Get top clients (most feedback + highest approval)
    clients = await db.fetch("""
        SELECT p.username, p.bio, p.full_name
        FROM profiles p
        WHERE p.status = 'cliente'
        ORDER BY p.score DESC
        LIMIT 20
    """)

    if not clients:
        return {"data": [], "message": "No clients with embeddings yet"}

    # Average embedding of top clients
    texts = [f"passage: {c['bio'] or ''} {c['full_name'] or ''}" for c in clients]
    embeddings = model.encode(texts, normalize_embeddings=True)
    avg_embedding = np.mean(embeddings, axis=0)

    # Search similar profiles
    limit = request.limit if request else 20
    similar = await db.fetch("""
        SELECT p.username, p.bio, p.score, p.niche_id,
               1 - (p.embedding <=> $1::vector) AS similarity
        FROM profiles p
        WHERE p.status = 'nuevo' AND p.embedding IS NOT NULL
        ORDER BY p.embedding <=> $1::vector
        LIMIT $2
    """, avg_embedding.tolist(), limit)

    return {
        "data": [
            {
                "username": r["username"],
                "bio": r["bio"],
                "score": r["score"],
                "niche": r["niche_id"],
                "similarity": round(float(r["similarity"]), 4)
            }
            for r in similar
        ]
    }


class EmbeddingsRequest(BaseModel):
    profile_ids: Optional[list[str]] = None
    limit: int = 500


@app.post("/ml/embeddings/generate")
async def generate_embeddings(request: EmbeddingsRequest = None, background_tasks: BackgroundTasks = None):
    """Generate embeddings for profiles (optionally specific IDs)."""
    if background_tasks:
        background_tasks.add_task(_generate_embeddings_job, request)
    else:
        asyncio.create_task(_generate_embeddings_job(request))
    return {"status": "started", "message": "Embedding generation running in background"}


async def _generate_embeddings_job(request: EmbeddingsRequest = None):
    db = await get_db()
    model = await get_text_model()
    limit = request.limit if request else 500

    if request and request.profile_ids:
        profiles = await db.fetch("""
            SELECT id, bio, full_name FROM profiles
            WHERE id = ANY($1::uuid[])
        """, request.profile_ids)
    else:
        profiles = await db.fetch("""
            SELECT id, bio, full_name FROM profiles
            WHERE embedding IS NULL
            LIMIT $1
        """, limit)

    if not profiles:
        print("No profiles need embeddings")
        return

    texts = [f"passage: {p['bio'] or ''} {p['full_name'] or ''}" for p in profiles]
    embeddings = model.encode(texts, normalize_embeddings=True)

    for p, emb in zip(profiles, embeddings):
        await db.execute(
            "UPDATE profiles SET embedding = $1::vector WHERE id = $2",
            emb.tolist(), p["id"]
        )

    print(f"✅ Generated embeddings for {len(profiles)} profiles")
    return {"generated": len(profiles)}


@app.post("/ml/retrain")
async def retrain_model(request: RetrainRequest = None):
    """Retrain the classifier using labeled feedback data."""
    db = await get_db()

    labels = await db.fetch("""
        SELECT p.bio, p.followers, p.is_private, p.is_verified,
               p.posts_count, p.external_url, f.action
        FROM feedback_log f
        JOIN profiles p ON f.profile_id = p.id
        ORDER BY f.created_at DESC
        LIMIT 5000
    """)

    if len(labels) < 10:
        return {"status": "skipped", "reason": "not_enough_labels", "count": len(labels)}

    # Build training data
    X, y = [], []
    for row in labels:
        features = [
            len(row["bio"] or ""),
            float(row["followers"] or 0),
            1 if row["is_private"] else 0,
            1 if row["is_verified"] else 0,
            float(row["posts_count"] or 0),
            1 if row["external_url"] else 0
        ]
        X.append(features)
        # Label: cliente=1.0, contactado=0.8, aprobado=0.6, descartado=0.0
        label_map = {"cliente": 1.0, "contactado": 0.8, "aprobado": 0.6, "descartado": 0.0}
        y.append(label_map.get(row["action"], 0.5))

    X = np.array(X)
    y = np.array(y)

    # Train XGBoost classifier
    import xgboost as xgb
    global classifier, scaler, is_fitted

    from sklearn.preprocessing import StandardScaler
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    classifier = xgb.XGBRegressor(
        objective='reg:squarederror',
        max_depth=5,
        learning_rate=0.05,
        n_estimators=100,
        subsample=0.8
    )
    classifier.fit(X_scaled, y)
    is_fitted = True

    # Save metrics
    preds = classifier.predict(X_scaled)
    from sklearn.metrics import mean_absolute_error
    mae = mean_absolute_error(y, preds)

    await db.execute("""
        INSERT INTO model_metrics (model_version, accuracy, n_samples, is_active)
        VALUES ($1, $2, $3, true)
    """, "v1-xgboost", float(1.0 - mae), len(labels))

    # Deactivate older models
    await db.execute("""
        UPDATE model_metrics SET is_active = false
        WHERE model_version != 'v1-xgboost'
    """)

    return {
        "status": "completed",
        "samples": len(labels),
        "mae": round(float(mae), 4),
        "accuracy_approx": round(float(1.0 - mae), 4)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
