import { observer } from 'mobx-react-lite';

import { PlusIcon } from '../../components/icons';
import type { Task } from '../../domain/task';
import { useStores } from '../../stores/context';
import styles from './Composer.module.css';
import { TitleField } from './TitleField';

interface ComposerRowProps {
  parent: Task;
  onAdd: (title: string) => void;
  onClose: () => void;
}

/**
 * The input for a new subtask, rendered in the list at the level and position
 * the task will occupy. Opening it next to the row that was clicked, rather than
 * at the foot of the card, is what keeps a deep tree usable: the answer appears
 * where the question was asked.
 */
export const ComposerRow = observer(function ComposerRow({
  parent,
  onAdd,
  onClose,
}: ComposerRowProps) {
  const { tasks: store } = useStores();

  return (
    <li
      className={styles.row}
      style={{ ['--depth-offset' as string]: parent.depth }}
      aria-label={`New subtask of ${parent.title}`}
    >
      <TitleField
        initialValue=""
        maxLength={store.limits.maxTitleLength}
        placeholder={`Subtask of ${parent.title}…`}
        ariaLabel={`New subtask of ${parent.title}`}
        onCommit={(value) => {
          if (!value.trim()) {
            onClose();
            return false;
          }

          onAdd(value);
          return true;
        }}
        onCancel={onClose}
      />
    </li>
  );
});

interface AddTaskBarProps {
  open: boolean;
  onAdd: (title: string) => void;
  onOpen: () => void;
  onClose: () => void;
}

/** The bar under the list, where a new top-level task lands anyway. */
export const AddTaskBar = observer(function AddTaskBar({
  open,
  onAdd,
  onOpen,
  onClose,
}: AddTaskBarProps) {
  const { tasks: store } = useStores();

  if (!open) {
    return (
      <button type="button" className={styles.trigger} onClick={onOpen}>
        <PlusIcon />
        Add task
      </button>
    );
  }

  return (
    <div className={styles.composer}>
      <TitleField
        initialValue=""
        maxLength={store.limits.maxTitleLength}
        placeholder="Add a task…"
        ariaLabel="New task"
        onCommit={(value) => {
          if (!value.trim()) {
            onClose();
            return false;
          }

          onAdd(value);
          return true;
        }}
        onCancel={onClose}
      />
    </div>
  );
});
