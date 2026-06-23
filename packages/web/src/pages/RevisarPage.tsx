import { useState, useEffect, useCallback } from 'react';
import { useStore, type Profile } from '../lib/store';
import clsx from 'clsx';

const SIGNALS = [
  { id: 'vende', label: 'Vende / Producto', icon: '🛍️' },
  { id: 'contenido', label: 'Contenido profesional', icon: '🎬' },
  { id: 'lifestyle', label: 'Lifestyle / Lujo', icon: '✈️' },
  { id: 'negocio', label: 'Negocio propio', icon: '🏢' },
  { id: 'activo', label: 'Activo (Stories)', icon: '🔥' },
  { id: 'link', label: 'Link en bio', icon: '🔗' }
];

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function scoreTier(score: number): 'hi' | 'mid' | 'lo' {
  if (score >= 70) return 'hi'; if (score >= 40) return 'mid'; return 'lo';
}

function displayScore(p: Profile) {
  return Math.min(100, p.score + ((p.manual_signals || []).length * 4));
}

export function RevisarPage() {
  const { fetchNextProfile, submitFeedback, toggleSignal, showToast, fetchProfiles, niches, fetchStats } = useStore();
  const [tab, setTab] = useState<'nuevo' | 'aprobado' | 'descartado'>('nuevo');
  const [current, setCurrent] = useState<Profile | null>(null);
  const [signals, setSignals] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [counts, setCounts] = useState({ nuevo: 0, aprobado: 0, descartado: 0 });

  const loadNext = useCallback(async () => {
    setLoading(true);
    const p = await fetchNextProfile();
    setCurrent(p); setSignals(p?.manual_signals || []); setLoading(false);
  }, []);

  const loadTab = useCallback(async () => {
    const store = useStore.getState();
    const res = await store.fetchProfiles(tab, 1, 50);
    setProfiles(res.data);
    const s = await fetchStats();
    const pp = s?.profiles || {};
    setCounts({ nuevo: pp.pending || 0, aprobado: pp.approved || 0, descartado: pp.rejected || 0 });
  }, [tab]);

  useEffect(() => { tab === 'nuevo' ? loadNext() : loadTab(); }, [tab]);

  const handleSignal = async (id: string) => {
    if (!current) return;
    const next = signals.includes(id) ? signals.filter(s => s !== id) : [...signals, id];
    setSignals(next);
    await toggleSignal(current.id, id);
  };

  const handleAction = async (action: string) => {
    if (!current) return;
    const msgs: Record<string, string> = { aprobado: '✅ Aprobado', descartado: '❌ Descartado', contactado: '📨 Contactado', cliente: '💰 ¡Cliente! 🌱 Auto-semilla' };
    await submitFeedback(current.id, action, signals);
    showToast(msgs[action] || 'OK');
    loadNext();
  };

  const nicheLabel = (id: string) => niches.find(n => n.id === id)?.label || id;

  if (loading && !current && tab === 'nuevo') {
    return (
      <div className="page-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h1 className="topbar-title" style={{ margin: 0 }}>Revisar</h1>
            <p className="topbar-subtitle" style={{ margin: 0 }}>Calificá los perfiles descubiertos</p>
          </div>
        </div>
        <div className="loading-spinner">
          <span style={{ fontSize: '2rem' }}>⏳</span>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content animate-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 className="topbar-title" style={{ margin: 0 }}>Revisar</h1>
          <p className="topbar-subtitle" style={{ margin: 0 }}>Calificá los perfiles descubiertos</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="segmented">
        {(['nuevo', 'aprobado', 'descartado'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={clsx('seg-btn', tab === t && 'on')}>
            {{ nuevo: 'Por revisar', aprobado: 'Aprobados', descartado: 'Descartados' }[t]}
            <span style={{ opacity: 0.7 }}> ({counts[t]})</span>
          </button>
        ))}
      </div>

      {tab === 'nuevo' ? (
        current ? (
          <div className="profile-card animate-in">
            <div className="profile-header">
              <div className={clsx('score-circle', scoreTier(displayScore(current)))}>
                <span className="score-number">{displayScore(current)}</span>
                <span className="score-text">SCORE</span>
              </div>
              <div className="profile-info">
                <div className="profile-username">@{current.username}</div>
                <div className="profile-handle">{current.full_name || current.username}</div>
                <div className="profile-meta">
                  <span className="badge badge-niche">{nicheLabel(current.niche_id)}</span>
                  <span className="badge badge-followers">{fmtNum(current.followers)} seguidores</span>
                  {current.is_verified && <span className="badge badge-score-hi">✓ Verificado</span>}
                </div>
              </div>
            </div>

            {current.bio && <div className="profile-bio">"{current.bio}"</div>}

            <div className="chips-row">
              {SIGNALS.map(s => (
                <button key={s.id} onClick={() => handleSignal(s.id)}
                  className={clsx('chip', signals.includes(s.id) && 'on')}>
                  {signals.includes(s.id) ? '✓ ' : ''}{s.icon} {s.label}
                </button>
              ))}
            </div>

            <a href={`https://www.instagram.com/${current.username}/`}
              target="_blank" rel="noopener noreferrer" className="insta-link">
              📱 Abrir en Instagram ↗
            </a>

            <div className="action-row">
              <button onClick={() => handleAction('aprobado')} className="action-btn btn-success">✅ Aprobar</button>
              <button onClick={() => handleAction('descartado')} className="action-btn btn-danger">❌ Descartar</button>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <div className="empty-title">Cola vacía</div>
            <div className="empty-desc">No hay perfiles nuevos. Importá un lote desde Agregar o esperá al descubrimiento automático.</div>
          </div>
        )
      ) : profiles.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">{tab === 'aprobado' ? '✅' : '❌'}</div>
          <div className="empty-title">Sin perfiles</div>
          <div className="empty-desc">Todavía no hay perfiles {tab === 'aprobado' ? 'aprobados' : 'descartados'}.</div>
        </div>
      ) : (
        <div className="profile-list">
          {profiles.map(p => (
            <div key={p.id} className="profile-row">
              <div className="profile-row-avatar">👤</div>
              <div className="profile-row-info">
                <div className="profile-row-name">@{p.username}</div>
                <div className="profile-row-meta">
                  {nicheLabel(p.niche_id)} · Score {displayScore(p)}
                  {p.status === 'cliente' && ' · 💰 Cliente'}
                  {p.status === 'contactado' && ' · 📨 Contactado'}
                </div>
              </div>
              <div className="profile-row-actions">
                <a href={`https://www.instagram.com/${p.username}/`} target="_blank" rel="noopener noreferrer" className="icon-btn">↗</a>
                {tab === 'aprobado' && (
                  <>
                    <button onClick={() => { submitFeedback(p.id, 'contactado', p.manual_signals); showToast('📨 Contactado'); }} className="icon-btn" title="Contactado">📨</button>
                    <button onClick={() => { submitFeedback(p.id, 'cliente', p.manual_signals); showToast('💰 ¡Cliente! 🌱 Auto-semilla'); }} className="icon-btn" title="Cliente">💰</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
