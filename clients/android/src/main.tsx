import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UpdateProvider } from './UpdateControl';
import './styles.css';

createRoot(document.getElementById('root')!).render(<UpdateProvider><App /></UpdateProvider>);
