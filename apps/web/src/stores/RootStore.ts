import { TaskStore } from './TaskStore';
import { ToastStore } from './ToastStore';

export class RootStore {
  readonly toasts = new ToastStore();
  readonly tasks = new TaskStore(this.toasts);
}
