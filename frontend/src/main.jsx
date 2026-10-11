import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/ui'; // Ateeb: Command Center uses useToast()
import { AuthProvider, AuthGate } from './context/AuthContext'; // BACKEND: login gate
import './styles/global.css';
import './styles/integration.css'; // glue for the teammates' modules (loaded last)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    </ToastProvider>
  </React.StrictMode>
);
