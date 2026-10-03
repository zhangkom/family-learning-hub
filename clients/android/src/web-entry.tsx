import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './library-layout.css';
import './web.css';

export function mountHostedApp(container: HTMLElement) {
  const root = createRoot(container);
  root.render(<div className="hosted-web"><App /></div>);
  return () => root.unmount();
}
