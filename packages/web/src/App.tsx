import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useStore } from './lib/store';
import { BottomNav } from './components/BottomNav';
import { TopBar } from './components/TopBar';
import { Toast } from './components/Toast';
import { RevisarPage } from './pages/RevisarPage';
import { DashboardPage } from './pages/DashboardPage';
import { AprenderPage } from './pages/AprenderPage';
import { AgregarPage } from './pages/AgregarPage';
import { LotePage } from './pages/LotePage';

const SUBTITLES: Record<string, string> = {
  '/': 'Triá los perfiles descubiertos, uno por uno',
  '/dashboard': 'Métricas y seguimiento completo del embudo',
  '/aprender': 'El sistema ajusta prioridades según resultados reales',
  '/agregar': 'Sumá clientes nuevos o importá un lote de Apify',
  '/lote': 'Recomendación dinámica de semillas para Apify'
};

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { loadState, error } = useStore();

  useEffect(() => {
    loadState();
  }, []);

  useEffect(() => {
    // Update subtitle
    const subtitle = SUBTITLES[location.pathname] || '';
    document.title = `Hermes Pro — ${subtitle}`;
  }, [location.pathname]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen flex-col gap-4 p-8">
        <div className="text-4xl">⚠️</div>
        <h1 className="text-xl font-bold text-red-500">Error de conexión</h1>
        <p className="text-gray-400 text-center">{error}</p>
        <button
          onClick={() => loadState()}
          className="px-6 py-2 bg-brand text-white rounded-lg font-semibold"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="app-container">
      <TopBar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<RevisarPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/aprender" element={<AprenderPage />} />
          <Route path="/agregar" element={<AgregarPage />} />
          <Route path="/lote" element={<LotePage />} />
        </Routes>
      </main>
      <BottomNav />
      <Toast />
    </div>
  );
}
