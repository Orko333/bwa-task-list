import { observer } from 'mobx-react-lite';

import { useStores } from '../stores/context';
import { CloseIcon } from './icons';
import styles from './Toaster.module.css';

export const Toaster = observer(function Toaster() {
  const { toasts } = useStores();

  return (
    <div className={styles.stack} role="region" aria-label="Notifications">
      {toasts.items.map((toast) => (
        <output key={toast.id} className={`${styles.toast} ${styles[toast.tone]}`}>
          <span className={styles.message}>{toast.message}</span>
          <button
            type="button"
            className={styles.dismiss}
            aria-label="Dismiss"
            onClick={() => toasts.dismiss(toast.id)}
          >
            <CloseIcon />
          </button>
        </output>
      ))}
    </div>
  );
});
