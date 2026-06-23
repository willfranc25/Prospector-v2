import { useStore } from '../lib/store';
import clsx from 'clsx';

export function Toast() {
  const toast = useStore(s => s.toast);
  return (
    <div className={clsx('toast', toast && 'show')}>
      {toast}
    </div>
  );
}
