import { useState } from 'react';
import { useStore } from '../lib/store';

export function AgregarPage() {
  const { niches, addCustomer, importCSV, showToast, fetchStats } = useStore();
  const [custUser, setCustUser] = useState('');
  const [custNiche, setCustNiche] = useState(niches[0]?.id || '');
  const [custNotes, setCustNotes] = useState('');
  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState<any>(null);
  const [importing, setImporting] = useState(false);

  const handleAddCustomer = async () => {
    if (!custUser.trim()) { showToast('⚠️ Falta el usuario'); return; }
    await addCustomer(custUser.replace(/^@/, ''), custNiche, custNotes);
    showToast('✅ Cliente agregado');
    setCustUser('');
    setCustNotes('');
  };

  const handleImport = async () => {
    if (!csvText.trim()) { showToast('⚠️ Pegá un CSV primero'); return; }
    setImporting(true);
    const result = await importCSV(csvText);
    setImportResult(result);
    setImporting(false);
    setCsvText('');
    showToast(`📥 ${result.stats.passed} perfiles importados`);
  };

  return (
    <div className="page-container">
      {/* Add customer */}
      <div className="card">
        <h2 className="card-title">➕ Agregar cliente que ya pagó</h2>
        <p className="stats-note">Estos perfiles se usan como semilla para encontrar perfiles parecidos.</p>

        <label className="form-label">Usuario de Instagram</label>
        <input
          type="text"
          value={custUser}
          onChange={e => setCustUser(e.target.value)}
          placeholder="usuario_sin_arroba"
          className="form-input"
        />

        <label className="form-label">Nicho</label>
        <select
          value={custNiche}
          onChange={e => setCustNiche(e.target.value)}
          className="form-input"
        >
          {niches.map(n => (
            <option key={n.id} value={n.id}>{n.label}</option>
          ))}
        </select>

        <label className="form-label">Notas (opcional)</label>
        <textarea
          value={custNotes}
          onChange={e => setCustNotes(e.target.value)}
          placeholder="Ej: compró 2 campañas"
          className="form-input min-h-[60px]"
        />

        <button onClick={handleAddCustomer} className="btn btn-brand w-full mt-3">
          Guardar cliente
        </button>
      </div>

      {/* Import CSV */}
      <div className="card">
        <h2 className="card-title">📥 Importar perfiles descubiertos</h2>
        <p className="stats-note">
          Pegá el CSV de Apify. Columnas: <b>username, biography, followersCount, postsCount, isPrivate, externalUrl</b>
        </p>

        <textarea
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          placeholder="username,biography,followersCount,postsCount,isPrivate,externalUrl&#10;juan.perez,Coach de negocios,15400,210,false,https://linktr.ee/juan"
          className="form-input min-h-[100px] font-mono text-sm"
        />

        <button
          onClick={handleImport}
          disabled={importing}
          className="btn btn-brand w-full mt-3"
        >
          {importing ? '⏳ Procesando...' : 'Procesar e importar'}
        </button>

        {importResult && (
          <div className="import-result mt-4">
            <h3 className="font-bold text-green-400 mb-2">📥 Importación completada</h3>
            <div className="text-sm space-y-1">
              <div className="flex justify-between">
                <span>Total en CSV</span>
                <span>{importResult.stats.total}</span>
              </div>
              <div className="flex justify-between text-green-400">
                <span>✅ Pasaron filtros</span>
                <span>{importResult.stats.passed}</span>
              </div>
              <div className="flex justify-between text-red-400">
                <span>❌ Descartados</span>
                <span>{importResult.stats.rejected}</span>
              </div>
              {importResult.rejectionReasons?.map((r: any) => (
                <div key={r.reason} className="flex justify-between text-gray-500 text-xs pl-4">
                  <span>├─ {r.reason}</span>
                  <span>{r.count}</span>
                </div>
              ))}
              <div className="flex justify-between text-yellow-400">
                <span>🔥 Alta prioridad (≥70)</span>
                <span>{importResult.stats.highPriority}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
