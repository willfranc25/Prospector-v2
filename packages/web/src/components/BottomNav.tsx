import { useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../lib/store';
import clsx from 'clsx';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: '📊' },
  { path: '/revisar', label: 'Revisar', icon: '🔍', badge: true },
  { path: '/agregar', label: 'Agregar', icon: '➕' },
  { path: '/lote', label: 'Lote', icon: '🌱' }
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { queueCount, stats } = useStore();
  const pending = queueCount || stats?.profiles?.pending || 0;

  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map(({ path, label, icon, badge }) => (
        <button
          key={path}
          onClick={() => navigate(path)}
          className={clsx('nav-btn', location.pathname === path && 'active')}
        >
          <span style={{ fontSize: '1.15rem', position: 'relative' }}>
            {icon}
            {badge && pending > 0 && (
              <span style={{
                position: 'absolute', top: -6, right: -10,
                background: 'var(--brand)', color: 'white',
                fontSize: '0.55rem', fontWeight: 700,
                padding: '1px 5px', borderRadius: 999,
                minWidth: 16, textAlign: 'center'
              }}>
                {pending > 99 ? '99+' : pending}
              </span>
            )}
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
