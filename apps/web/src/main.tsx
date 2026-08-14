import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { RootStore } from './stores/RootStore';
import { StoreContext } from './stores/context';
import './styles/global.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <StoreContext.Provider value={new RootStore()}>
      <App />
    </StoreContext.Provider>
  </StrictMode>,
);
