import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import clsx from 'clsx';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/revisar', label: 'Revisar', icon: '🔍' },
  { path: '/agregar', label: 'Agregar', icon: '➕' }
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { queueCount, stats } = useStore();
  const pending = queueCount || stats?.profiles?.pending || 0;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">⚡</div>
          <div>
            <div className="sidebar-logo-text">Hermes Pro</div>
            <div className="sidebar-logo-sub">Prospecting Engine</div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section">Principal</div>

        {NAV_ITEMS.map(item => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className={clsx('sidebar-link', location.pathname === item.path && 'active')}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
            {item.path === '/revisar' && pending > 0 && (
              <span className="sidebar-badge">{pending}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-status" />
        <span>Sistema activo</span>
      </div>
    </aside>
  );
}
