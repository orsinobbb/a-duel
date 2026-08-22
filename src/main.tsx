import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BattleApp } from './ui/BattleApp';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BattleApp />
  </StrictMode>,
);
