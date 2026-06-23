import { useLocation, useNavigate } from 'react-router-dom';
import { Search, BarChart3, Brain, PlusCircle, Sprout } from 'lucide-react';
import clsx from 'clsx';

const NAV_ITEMS = [
  { path: '/', label: 'Revisar', icon: Search },
  { path: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { path: '/aprender', label: 'Aprender', icon: Brain },
  { path: '/agregar', label: 'Agregar', icon: PlusCircle },
  { path: '/lote', label: 'Lote', icon: Sprout }
];

export function BottomNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="bottom-nav">
      {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
        <button
          key={path}
          onClick={() => navigate(path)}
          className={clsx('nav-btn', location.pathname === path && 'active')}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
