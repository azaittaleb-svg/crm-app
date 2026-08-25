import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'info';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Confirmer',
  cancelText = 'Annuler',
  variant = 'danger',
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onCancel}
            className="fixed inset-0 bg-transparent backdrop-blur-sm z-[9999]"
          />

          {/* Modal Container */}
          <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[10000] p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="bg-[#ffffff] dark:bg-[#2b2c40] rounded-lg shadow-xl w-full max-w-sm pointer-events-auto overflow-hidden border border-[#dbdade]/70 dark:border-[#434460]/40"
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div
                    className={`w-11 h-11 flex items-center justify-center ${
                      variant === 'danger'
                        ? 'bg-[#ffe1e1] text-[#ff3e1d] dark:bg-[#4b2e2e]'
                        : 'bg-[#e7e7ff] text-[#696cff] dark:bg-[#393a59] dark:text-[#b1b4ff]'
                    } rounded-lg`}
                  >
                    <AlertTriangle size={22} />
                  </div>
                  <button
                    onClick={onCancel}
                    className="p-2 hover:bg-[#696cff]/5 rounded-lg text-[#a1acb8] transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>

                <h3 className="text-[17px] font-semibold text-[#435971] dark:text-[#dbdade] mb-2 tracking-tight">
                  {title}
                </h3>
                <p className="text-[#697a8d] dark:text-[#a3a4cc] text-sm leading-relaxed mb-6">
                  {message}
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={onCancel}
                    className="flex-1 px-4 py-2.5 rounded-lg font-bold text-[#697a8d] dark:text-[#a3a4cc] bg-[#f5f5f9] dark:bg-[#323249] hover:bg-[#ebebed] dark:hover:bg-[#3f405a] transition-all uppercase text-[11px] tracking-wider"
                  >
                    {cancelText}
                  </button>
                  <button
                    onClick={onConfirm}
                    className={`flex-1 px-4 py-2.5 rounded-lg font-bold text-white shadow-xs transition-all uppercase text-[11px] tracking-wider ${
                      variant === 'danger'
                        ? 'bg-[#ff3e1d] hover:bg-[#e6381a]'
                        : 'bg-[#696cff] hover:bg-[#5f61e6]'
                    }`}
                  >
                    {confirmText}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};
