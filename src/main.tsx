import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { App } from './App.js';
import './style.css';
import './catalog.css';
import './connections.css';

createRoot(document.getElementById('app')!).render(<StrictMode><App /></StrictMode>);
