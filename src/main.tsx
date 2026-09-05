import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import './styles/base.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('The #root element is missing from index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * Register the service worker in built output only.
 *
 * Not in dev: a worker sitting in front of Vite's module graph turns every
 * hot reload into a debugging session. BASE_URL rather than a literal path,
 * so the scope follows the deployment rather than assuming a repository name.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
