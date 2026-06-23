import { useStore } from '../lib/store';
import clsx from 'clsx';

export function Toast() {
  const toast = useStore(s => s.toast);
  return (
    <div className="toast-container">
      <div className={clsx('toast-msg', toast && 'show')}>{toast}</div>
    </div>
  );
}
