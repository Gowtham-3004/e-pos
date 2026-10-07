import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@elixir/ui/styles.css';
import { applyTheme, ToastProvider } from '@elixir/ui';
import { ElixirDataProvider } from '@elixir/app-kit';
import { App } from './App';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ElixirDataProvider product="Platform Admin" use={['cloud']}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ElixirDataProvider>
  </StrictMode>,
);
