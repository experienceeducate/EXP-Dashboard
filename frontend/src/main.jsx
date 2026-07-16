import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { GLOBAL_CSS } from './styles.js';

// Inject the shared class-based stylesheet once (no separate .css file).
const styleEl = document.createElement('style');
styleEl.textContent = GLOBAL_CSS;
document.head.appendChild(styleEl);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
