import React, { ReactNode } from 'react';

interface PageHeaderProps {
  title: string | ReactNode;
  subtitle?: string | ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, icon, actions }: PageHeaderProps) {
  return (
    <div className="w-full pt-4 pb-4 bg-transparent dark:bg-transparent flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5 z-20 select-none">
      {/* Title & Subtitle Section */}
      <div className="flex items-start gap-4 max-w-full text-left">
        {icon && (
          <div className="p-2.5 bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 text-[#696cff] dark:text-[#b1b4ff] rounded-lg shadow-[0_2px_12px_rgba(15,23,42,0.04)] shrink-0 flex items-center justify-center transition-transform hover:scale-105 duration-300">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl md:text-2xl font-bold font-sans tracking-tight text-[#435971] dark:text-[#dbdade] leading-tight capitalize">
            {title}
          </h1>
          {subtitle && (
            <div className="text-[13px] text-[#a1acb8] dark:text-[#707194] font-medium mt-1 leading-normal max-w-lg md:max-w-2xl select-text">
              {subtitle}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 shrink-0">{actions}</div>
      )}
    </div>
  );
}
