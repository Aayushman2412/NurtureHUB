import React, { createContext, useContext, useCallback } from 'react';
import { toast, Toaster } from 'sonner';
import { useTheme } from './ThemeContext';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';
export type ToastId = string | number;

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => ToastId;
  /** Replace an existing toast (by id) in place — e.g. turn a 'loading' toast into a result. */
  updateToast: (id: ToastId, message: string, type?: ToastType) => void;
  /** Dismiss a specific toast, or all toasts when no id is given. */
  dismissToast: (id?: ToastId) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// Emit (or, when `id` is supplied, update-in-place) a sonner toast of the given type.
const emitToast = (message: string, type: ToastType, id?: ToastId): ToastId => {
  const opts = id !== undefined ? { id } : undefined;
  switch (type) {
    case 'success':
      return toast.success(message, opts);
    case 'error':
      return toast.error(message, opts);
    case 'warning':
      return toast.warning(message, opts);
    case 'loading':
      return toast.loading(message, opts);
    case 'info':
    default:
      return toast.info(message, opts);
  }
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { darkMode } = useTheme();

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => emitToast(message, type),
    []
  );

  const updateToast = useCallback(
    (id: ToastId, message: string, type: ToastType = 'info') => {
      emitToast(message, type, id);
    },
    []
  );

  const dismissToast = useCallback((id?: ToastId) => {
    toast.dismiss(id);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, updateToast, dismissToast }}>
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
