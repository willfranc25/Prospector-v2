import { useState, useEffect, useCallback } from 'react';
import { useStore, type Profile } from '../lib/store';
import clsx from 'clsx';

const SIGNALS = [
  { id: 'vende', label: 'Vende algo / producto', icon: '🛍️' },
  { id: 'contenido', label: 'Contenido profesional', icon: '🎬' },
  { id: 'lifestyle', label: 'Lifestyle / viajes / lujo', icon: '✈️' },
  { id: 'negocio', label: 'Negocio propio visible', icon: '🏢' },
  { id: 'activo', label: 'Activo (stories/reels)', icon: '🔥' },
  { id: 'link', label: 'Link en bio', icon: '🔗' }
];

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function scoreTier(score: number): 'hi' | 'mid' | 'lo' {
  if (score >= 70) return 'hi';
  if (score >= 40) return 'mid';
  return 'lo';
}

export function RevisarPage() {
  const { fetchNextProfile, submitFeedback, toggleSignal, showToast, fetchStats, niches, queueCount } = useStore();
  const [currentTab, setCurrentTab] = useState<'nuevo' | 'aprobado' | 'descartado'>('nuevo');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null);
  const [signals, setSignals] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabCounts, setTabCounts] = useState({ nuevo: 0, aprobado: 0, descartado: 0 });

  const loadNext = useCallback(async () => {
    setLoading(true);
    const profile = await fetchNextProfile();
    setCurrentProfile(profile);
    setSignals(profile?.manual_signals || []);
    setLoading(false);
  }, [fetchNextProfile]);

  const loadTabProfiles = useCallback(async () => {
    const store = useStore.getState();
    const res = await store.fetchProfiles(currentTab, 1, 50);
    setProfiles(res.data);
    // Update counts
    const statsRes = await store.fetchStats();
    const p = statsRes?.profiles || {};
    setTabCounts({
      nuevo: p.pending || 0,
      aprobado: p.approved || 0,
      descartado: p.rejected || 0
    });
  }, [currentTab]);

  useEffect(() => {
    if (currentTab === 'nuevo') {
      loadNext();
    } else {
      loadTabProfiles();
    }
  }, [currentTab]);

  const handleSignal = async (signalId: string) => {
    if (!currentProfile) return;
    const newSignals = signals.includes(signalId)
      ? signals.filter(s => s !== signalId)
      : [...signals, signalId];
    setSignals(newSignals);
    await toggleSignal(currentProfile.id, signalId);
  };

  const handleAction = async (action: string) => {
    if (!currentProfile) return;
    const msgs: Record<string, string> = {
      aprobado: '✅ Aprobado',
      descartado: '❌ Descartado',
      contactado: '📨 Contactado',
      cliente: '💰 ¡Nuevo cliente!'
    };
    await submitFeedback(currentProfile.id, action, signals);
    showToast(msgs[action] || 'Actualizado');
    loadNext();
  };

  const nicheLabel = (nicheId: string) => niches.find(n => n.id === nicheId)?.label || nicheId;
  const displayScore = (p: Profile) => {
    const bonus = (p.manual_signals || []).length * 4;
    return Math.min(100, p.score + bonus);
  };

  if (loading && !currentProfile) {
    return (
      <div className="flex items-center justify-center h-full flex-col gap-3">
        <div className="text-3xl animate-pulse">⏳</div>
        <p className="text-gray-400">Cargando perfiles...</p>
      </div>
    );
  }

  return (
    <div className="page-container">
      {/* Tab bar */}
      <div className="segmented-control">
        {(['nuevo', 'aprobado', 'descartado'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setCurrentTab(tab)}
            className={clsx('seg-btn', currentTab === tab && 'on')}
          >
            {{ nuevo: 'Por revisar', aprobado: 'Aprobados', descartado: 'Descartados' }[tab]}
            <span className="seg-count"> ({tabCounts[tab]})</span>
          </button>
        ))}
      </div>

      {/* Swipe card */}
      {currentTab === 'nuevo' ? (
        currentProfile ? (
          <div className="profile-card">
            <div className="pc-top">
              <div className={clsx('score-badge', scoreTier(displayScore(currentProfile)))}>
                <span className="score-num">{displayScore(currentProfile)}</span>
                <span className="score-label">SCORE</span>
              </div>
              <div className="pc-id">
                <div className="pc-user">@{currentProfile.username}</div>
                <div className="pc-meta">
                  <span className="pill">{nicheLabel(currentProfile.niche_id)}</span>
                  <span>{fmtNum(currentProfile.followers)} seguidores</span>
                </div>
              </div>
            </div>

            {currentProfile.bio ? (
              <div className="pc-bio">"{currentProfile.bio}"</div>
            ) : (
              <div className="pc-bio text-gray-400">Sin biografía registrada</div>
            )}

            {/* Signal chips */}
            <div className="chips-grid">
              {SIGNALS.map(s => (
                <button
                  key={s.id}
                  onClick={() => handleSignal(s.id)}
                  className={clsx('chip', signals.includes(s.id) && 'on')}
                >
                  {signals.includes(s.id) ? '✓ ' : ''}{s.icon} {s.label}
                </button>
              ))}
            </div>

            <a
              href={`https://www.instagram.com/${currentProfile.username}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="open-btn"
            >
              📱 Abrir perfil en Instagram ↗
            </a>

            <div className="action-grid">
              <button onClick={() => handleAction('aprobado')} className="act-btn approve">
                ✅ Aprobar
              </button>
              <button onClick={() => handleAction('descartado')} className="act-btn reject">
                ❌ Descartar
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <div className="text-4xl mb-2">📭</div>
            <b>No hay perfiles nuevos por revisar</b>
            <p className="text-gray-400 mt-2">Importá un lote desde la pestaña Agregar.</p>
          </div>
        )
      ) : (
        profiles.length === 0 ? (
          <div className="empty-state">
            <div className="text-4xl mb-2">{currentTab === 'aprobado' ? '✅' : '❌'}</div>
            <b>Todavía no hay perfiles aquí</b>
          </div>
        ) : (
          <div className="profile-list">
            {profiles.map(p => (
              <div key={p.id} className="list-item">
                <a
                  href={`https://www.instagram.com/${p.username}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="icon-btn"
                >
                  ↗
                </a>
                <div className="li-info">
                  <div className="li-user">@{p.username}</div>
                  <div className="li-sub">
                    {nicheLabel(p.niche_id)} · score {displayScore(p)}
                    {p.status === 'cliente' && ' · 💰 Cliente'}
                    {p.status === 'contactado' && ' · 📨 Contactado'}
                  </div>
                </div>
                {currentTab === 'aprobado' && (
                  <div className="li-actions">
                    <button
                      onClick={() => {
                        submitFeedback(p.id, 'contactado', p.manual_signals);
                        showToast('📨 Contactado');
                      }}
                      className="icon-btn"
                      title="Marcar contactado"
                    >
                      📨
                    </button>
                    <button
                      onClick={() => {
                        submitFeedback(p.id, 'cliente', p.manual_signals);
                        showToast('💰 ¡Nuevo cliente!');
                      }}
                      className="icon-btn"
                      title="Marcar cliente"
                    >
                      💰
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
