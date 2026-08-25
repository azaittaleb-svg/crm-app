import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Intercept and silence harmless Firestore clock-skew warnings
const originalError = console.error;
const originalWarn = console.warn;
const originalLog = console.log;

const isFutureTimeWarning = (arg: any): boolean => {
  if (!arg) return false;
  if (typeof arg === 'string') {
    return arg.includes('Detected an update time that is in the future');
  }
  if (arg instanceof Error && arg.message) {
    return arg.message.includes('Detected an update time that is in the future');
  }
  if (typeof arg === 'object') {
    try {
      const str = String(arg);
      if (str.includes('Detected an update time that is in the future')) {
        return true;
      }
      const json = JSON.stringify(arg);
      if (json && json.includes('Detected an update time that is in the future')) {
        return true;
      }
    } catch (_) {}
  }
  return false;
};

console.error = (...args: any[]) => {
  if (args.some(isFutureTimeWarning)) return;
  originalError(...args);
};

console.warn = (...args: any[]) => {
  if (args.some(isFutureTimeWarning)) return;
  originalWarn(...args);
};

console.log = (...args: any[]) => {
  if (args.some(isFutureTimeWarning)) return;
  originalLog(...args);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
