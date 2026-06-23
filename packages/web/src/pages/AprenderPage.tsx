import { useEffect } from 'react';
import { useStore } from '../lib/store';

export function AprenderPage() {
  const { niches, fetchNiches, adjustNicheWeight, recalcWeights, showToast } = useStore();

  useEffect(() => { fetchNiches(); }, []);

  const sorted = [...niches].sort((a, b) => b.weight - a.weight);

  return (
    <div className="page-container">
      <div className="card">
        <h2 className="card-title">🧠 Cómo aprende el sistema</h2>
        <p className="stats-note">
          Cada vez que marcás un perfil como Aprobado, Descartado o Cliente,
          el sistema lo registra. La prioridad de cada nicho sube o baja
          automáticamente según qué tan bien está convirtiendo.
        </p>
        <button
          onClick={() => { recalcWeights(); showToast('🧠 Pesos recalculados'); }}
          className="btn btn-brand w-full mt-3"
        >
          🔄 Recalcular pesos ahora
        </button>
      </div>

      <div className="card">
        <h2 className="card-title">Prioridad por nicho</h2>
        <p className="stats-note">
          El nicho con más peso es el que el sistema prioriza al armar el próximo lote.
        </p>

        {sorted.map(n => (
          <div key={n.id} className="niche-card">
            <div className="niche-header">
              <span className="niche-name">{n.label}</span>
              <span className="niche-weight">Peso {n.weight}</span>
            </div>
            <div className="progress-track mb-1">
              <div className="progress-fill" style={{ width: `${n.weight}%` }} />
            </div>
            <div className="niche-stats-row">
              {n.stats?.approvalRate !== null
                ? `${Math.round(n.stats.approvalRate * 100)}% aprob. · ${Math.round((n.stats.conversionRate || 0) * 100)}% cliente · ${n.stats.totalFeedback} muestras`
                : 'Sin datos todavía'
              }
            </div>
            <div className="stepper">
              <button onClick={() => adjustNicheWeight(n.id, -2)} className="step-btn">−</button>
              <span className="step-val">{n.weight}</span>
              <button onClick={() => adjustNicheWeight(n.id, 2)} className="step-btn">+</button>
              <span className="step-hint">ajuste manual</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
