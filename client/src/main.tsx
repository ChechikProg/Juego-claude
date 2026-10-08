import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/base.css';
import './styles/ui.css';
import './styles/screens.css';
import './styles/games.css';
import { App } from './App';
import { bindSocket } from './state/store';
import { sfx } from './lib/sfx';

bindSocket();

// El audio sólo puede arrancar con un gesto del usuario.
const wake = () => sfx.wake();
window.addEventListener('pointerdown', wake, { once: true });
window.addEventListener('keydown', wake, { once: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
