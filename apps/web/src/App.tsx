import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';

import { ErrorState, TaskSkeleton } from './components/States';
import { Toaster } from './components/Toaster';
import { TaskList } from './features/tasks/TaskList';
import { ALT_KEY_LABEL } from './platform';
import { useStores } from './stores/context';
import styles from './App.module.css';

export const App = observer(function App() {
  const { tasks: store } = useStores();

  useEffect(() => {
    void store.load();
  }, [store]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden />
          <h1 className={styles.title}>Outline</h1>
        </div>
        <p className={styles.hint}>
          Drag a row to reorder it. Drag it sideways to nest it under the row above.
        </p>
      </header>

      <main className={styles.card}>
        {store.state === 'loading' && <TaskSkeleton />}

        {store.state === 'error' && (
          <ErrorState
            message={store.loadError ?? 'The server did not answer.'}
            onRetry={() => void store.load()}
          />
        )}

        {store.state === 'ready' && <TaskList />}
      </main>

      {store.state === 'ready' && !store.isEmpty && (
        <footer className={styles.footer}>
          <span>{plural(store.tasks.length, 'task')}</span>
          <span>
            {store.deepestLevel} of {store.limits.maxDepth} levels deep
          </span>
          <span className={styles.keys}>
            <kbd>{ALT_KEY_LABEL}</kbd> + arrows to move without the mouse
          </span>
        </footer>
      )}

      <Toaster />
    </div>
  );
});

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
