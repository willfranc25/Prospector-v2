import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useStore } from './lib/store';
import { Sidebar } from './components/Sidebar';
import { BottomNav } from './components/BottomNav';
import { Toast } from './components/Toast';
import { RevisarPage } from './pages/RevisarPage';
import { DashboardPage } from './pages/DashboardPage';
import { AgregarPage } from './pages/AgregarPage';

export default function App() {
  const location = useLocation();
  const { loadState, error, stats, queueCount } = useStore();

  useEffect(() => { loadState(); }, []);
  useEffect(() => {
    const interval = setInterval(() => {
      const s = useStore.getState();
      s.fetchStats();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen flex-col gap-4 p-8 bg-[var(--bg-primary)]">
        <div className="text-5xl">⚡</div>
        <h1 className="text-xl font-bold text-[var(--danger)]">Error de conexión</h1>
        <p className="text-[var(--text-muted)] text-center max-w-sm">{error}</p>
        <button onClick={() => loadState()} className="btn btn-primary">
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-area">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/revisar" element={<RevisarPage />} />
          <Route path="/agregar" element={<AgregarPage />} />
        </Routes>
      </div>
      <BottomNav />
      <Toast />
    </div>
  );
}
