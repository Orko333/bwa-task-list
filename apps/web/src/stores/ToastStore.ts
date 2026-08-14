import { makeAutoObservable } from 'mobx';

export type ToastTone = 'error' | 'info';

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
}

const LIFETIME_MS: Record<ToastTone, number> = { error: 7000, info: 3500 };

export class ToastStore {
  items: Toast[] = [];

  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    makeAutoObservable(this, { items: true }, { autoBind: true });
  }

  show(tone: ToastTone, message: string): void {
    const id = crypto.randomUUID();
    this.items.push({ id, tone, message });
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), LIFETIME_MS[tone]),
    );
  }

  dismiss(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }

    this.items = this.items.filter((toast) => toast.id !== id);
  }
}
