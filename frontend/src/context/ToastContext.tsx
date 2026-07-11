import React, { createContext, useContext, useCallback } from 'react';
import { toast, Toaster } from 'sonner';
import { useTheme } from './ThemeContext';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { darkMode } = useTheme();

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    switch (type) {
      case 'success':
        toast.success(message);
        break;
      case 'error':
        toast.error(message);
        break;
      case 'warning':
        toast.warning(message);
        break;
      case 'info':
      default:
        toast.info(message);
        break;
    }
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <Toaster 
        theme={darkMode ? 'dark' : 'light'}
        richColors
        closeButton
        position="top-right"
        toastOptions={{
          style: {
            fontFamily: "var(--font-display, 'Figtree', sans-serif)",
            borderRadius: "var(--radius-lg, 12px)"
          }
        }}
      />
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
