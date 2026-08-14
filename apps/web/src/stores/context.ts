import { createContext, useContext } from 'react';

import type { RootStore } from './RootStore';

export const StoreContext = createContext<RootStore | null>(null);

export function useStores(): RootStore {
  const store = useContext(StoreContext);

  if (!store) {
    throw new Error('useStores was called outside of StoreContext.Provider');
  }

  return store;
}
