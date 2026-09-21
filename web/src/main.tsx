import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthGate } from './components/AuthGate';
import './index.css';

const queryClient = new QueryClient({
  defaultQueries: undefined,
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,       // aggregates change only when the MVs refresh
      gcTime: 30 * 60 * 1000,
      retry: (count, err) => count < 2 && !(err as { status?: number }).status,
      refetchOnWindowFocus: false,
    },
  },
} as ConstructorParameters<typeof QueryClient>[0]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthGate>
    </QueryClientProvider>
  </React.StrictMode>,
);
