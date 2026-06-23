import React, { createContext, useState, useContext, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div id="toastContainer" className="toast-container" style={{ zIndex: 'var(--z-toast)' }}>
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '1.25rem' }}>{icons[toast.type]}</span>
            <span style={{ flex: 1, fontSize: '0.9375rem' }}>{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              style={{
                fontSize: '1.1rem',
                color: 'var(--gray-400)',
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                padding: '0 4px',
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
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
