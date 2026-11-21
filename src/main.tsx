import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter, MemoryRouter } from 'react-router-dom';
import App from './App';
import './styles/index.css';

// Static hosts can't rewrite deep links. VITE_ROUTER=hash uses #/routes (e.g. GitHub Pages);
// VITE_ROUTER=memory keeps routes in memory (sandboxed previews that don't allow URL changes).
const Router =
  import.meta.env.VITE_ROUTER === 'hash' ? HashRouter : import.meta.env.VITE_ROUTER === 'memory' ? MemoryRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </Router>
  </React.StrictMode>,
);
