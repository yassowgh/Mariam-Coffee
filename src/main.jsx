import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root.jsx';
import './styles.css';
import { applyLang, getLang } from './lib/i18n.js';

applyLang(getLang(), false);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
