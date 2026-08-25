import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Toast, ToastType } from '../components/Toast';
import { AnimatePresence } from 'motion/react';

interface NotificationContextType {
  showToast: (message: string, type?: ToastType) => void;
  confirm: (options: ConfirmOptions) => void;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'info';
  onConfirm: () => void;
  onCancel?: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [confirmData, setConfirmData] = useState<ConfirmOptions | null>(null);

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    setToast({ message, type });
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    setConfirmData(options);
  }, []);

  return (
    <NotificationContext.Provider value={React.useMemo(() => ({ showToast, confirm }), [showToast, confirm])}>
      {children}

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
        )}
      </AnimatePresence>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!confirmData}
        title={confirmData?.title || ''}
        message={confirmData?.message || ''}
        confirmText={confirmData?.confirmText}
        cancelText={confirmData?.cancelText}
        variant={confirmData?.variant}
        onConfirm={() => {
          confirmData?.onConfirm();
          setConfirmData(null);
        }}
        onCancel={() => {
          confirmData?.onCancel?.();
          setConfirmData(null);
        }}
      />
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};
