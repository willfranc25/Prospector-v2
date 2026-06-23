import { useState } from 'react';
import { useStore } from '../lib/store';

export function AgregarPage() {
  const { niches, addCustomer, importCSV, showToast } = useStore();
  const [custUser, setCustUser] = useState('');
  const [custNiche, setCustNiche] = useState(niches[0]?.id || '');
  const [custNotes, setCustNotes] = useState('');
  const [csvText, setCsvText] = useState('');
  const [result, setResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  const handleAddCustomer = async () => {
    if (!custUser.trim()) { showToast('⚠️ Falta el usuario'); return; }
    await addCustomer(custUser.replace(/^@/, ''), custNiche, custNotes);
    showToast('✅ Cliente agregado');
    setCustUser(''); setCustNotes('');
  };

  const handleImport = async () => {
    if (!csvText.trim()) { showToast('⚠️ Pegá un CSV'); return; }
    setImporting(true);
    try {
      const r = await importCSV(csvText);
      setResult(r);
      showToast(`📥 ${r.stats.passed} perfiles importados`);
    } catch { showToast('❌ Error al importar'); }
    setImporting(false);
    setCsvText('');
  };

  return (
    <div className="page-content animate-in">
      <div style={{ marginBottom: 20 }}>
        <h1 className="topbar-title" style={{ margin: 0 }}>Agregar</h1>
        <p className="topbar-subtitle" style={{ margin: 0 }}>Clientes semilla e importación de perfiles</p>
      </div>

      <div className="grid-2">
        {/* Add Customer */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">➕ Cliente que ya pagó</span>
          </div>
          <p className="card-subtitle" style={{ marginBottom: 16 }}>Estos perfiles alimentan el motor de búsqueda como semillas.</p>

          <div className="form-group">
            <label className="form-label">Usuario de Instagram</label>
            <input type="text" value={custUser} onChange={e => setCustUser(e.target.value)}
              placeholder="usuario_sin_arroba" className="form-input" />
          </div>

          <div className="form-group">
            <label className="form-label">Nicho</label>
            <select value={custNiche} onChange={e => setCustNiche(e.target.value)} className="form-select">
              {niches.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Notas</label>
            <textarea value={custNotes} onChange={e => setCustNotes(e.target.value)}
              placeholder="Ej: compró 2 campañas, plan premium" className="form-textarea" />
          </div>

          <button onClick={handleAddCustomer} className="btn btn-primary btn-block">Guardar cliente</button>
        </div>

        {/* Import CSV */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">📥 Importar CSV de Apify</span>
          </div>
          <p className="card-subtitle" style={{ marginBottom: 16 }}>
            Columnas esperadas: <b>username, biography, followersCount, postsCount, isPrivate, externalUrl</b>
          </p>

          <div className="form-group">
            <textarea value={csvText} onChange={e => setCsvText(e.target.value)}
              placeholder={`username,biography,followersCount,postsCount,isPrivate,externalUrl\njuan.perez,Coach de negocios certificado,15400,210,false,https://linktr.ee/juan`}
              className="form-textarea" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', minHeight: 140 }} />
          </div>

          <button onClick={handleImport} disabled={importing} className="btn btn-primary btn-block">
            {importing ? '⏳ Importando...' : 'Procesar e importar'}
          </button>

          {result && (
            <div style={{ marginTop: 16, padding: 14, background: 'var(--bg-secondary)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div className="card-title" style={{ color: 'var(--success)', marginBottom: 8 }}>✅ {result.stats.passed} importados</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
                <div>Total CSV: {result.stats.total} | Descartados: {result.stats.rejected}</div>
                <div style={{ color: 'var(--warning)' }}>🔥 Alta prioridad: {result.stats.highPriority}</div>
                {result.rejectionReasons?.slice(0, 3).map((r: any) => (
                  <div key={r.reason} style={{ paddingLeft: 8 }}>· {r.reason}: {r.count}</div>
                ))}
                {(result.rejectionReasons?.length || 0) > 3 && <div style={{ paddingLeft: 8, opacity: 0.5 }}>· ... y {result.rejectionReasons.length - 3} más</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
