import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const isError = type === 'error';

  // Smart context-aware title
  let title = 'Opération réussie';
  if (isError) {
    title = 'Erreur de validation';
    const lower = message.toLowerCase();
    if (lower.includes('chronologie') || lower.includes('antédater') || lower.includes('date')) {
      title = 'Erreur de chronologie';
    } else if (
      lower.includes('séquence') ||
      lower.includes('numéro') ||
      lower.includes('séquentiel')
    ) {
      title = 'Erreur de séquence';
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20, x: '-50%' }}
      animate={{ opacity: 1, y: 0, x: '-50%' }}
      exit={{ opacity: 0, y: -15, x: '-50%' }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="fixed top-6 left-1/2 z-[99999] w-[95%] sm:w-[90%] max-w-[620px]"
      style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        className={`rounded-lg px-[18px] py-[14px] flex items-start gap-[14px] shadow-[0_10px_15px_-3px_rgba(0,0,0,0.05),0_4px_6px_-4px_rgba(0,0,0,0.05)] border transition-colors ${
          isError
            ? 'bg-[#fff5f5] dark:bg-[#2d1a1b] border-[#fecaca] dark:border-rose-900/40'
            : 'bg-[#f0fdf4] dark:bg-[#14261a] border-[#bbf7d0] dark:border-emerald-900/40'
        }`}
      >
        {/* SVG Icon */}
        <div
          className={`pt-[2px] shrink-0 flex items-center justify-center ${
            isError ? 'text-[#ef4444]' : 'text-[#10b981]'
          }`}
        >
          {isError ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286Zm0 13.036h.008v.008H12v-.008Z"
              />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.746 3.746 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z"
              />
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="grow text-left">
          <div
            className={`font-semibold text-[13.5px] mb-[2px] leading-tight ${
              isError ? 'text-[#991b1b] dark:text-rose-300' : 'text-[#15803d] dark:text-emerald-300'
            }`}
          >
            {title}
          </div>
          <div className="text-[#1f2937] dark:text-slate-200 text-[13px] leading-relaxed font-normal">
            {message}
          </div>
        </div>

        {/* Close button with exact style */}
        <button
          onClick={onClose}
          className="bg-transparent border-0 text-slate-400 hover:text-[#ef4444] cursor-pointer p-[2px] rounded flex items-center justify-center transition-colors duration-200 shrink-0"
        >
          <X size={15} />
        </button>
      </div>
    </motion.div>
  );
};
