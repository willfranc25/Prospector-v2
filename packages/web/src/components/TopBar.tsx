import { useLocation } from 'react-router-dom';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const SUBTITLES: Record<string, string> = {
  '/': 'Triá los perfiles descubiertos, uno por uno',
  '/dashboard': 'Métricas y seguimiento completo del embudo',
  '/aprender': 'El sistema ajusta prioridades según resultados reales',
  '/agregar': 'Sumá clientes nuevos o importá un lote de Apify',
  '/lote': 'Recomendación dinámica de semillas para Apify'
};

export function TopBar() {
  const location = useLocation();
  const subtitle = SUBTITLES[location.pathname] || '';

  return (
    <header className="topbar">
      <div className="brand-row">
        <div className="brand-title">
          <span className="brand-icon">⚡</span> Hermes Pro
        </div>
        <div className="brand-date">
          {format(new Date(), "EEE d MMM", { locale: es })}
        </div>
      </div>
      <p className="tab-subtitle">{subtitle}</p>
    </header>
  );
}
