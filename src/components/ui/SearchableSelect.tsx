import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X, Check, User } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  subtitle?: string;
  badge?: string;
}

interface SearchableSelectProps {
  id?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  icon?: React.ReactNode;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
  id,
  options,
  value,
  onChange,
  placeholder = '-- Choisir --',
  searchPlaceholder = 'Rechercher...',
  required = false,
  disabled = false,
  className = '',
  icon,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchTerm('');
    }
  }, [isOpen]);

  const filteredOptions = options.filter((opt) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      opt.label.toLowerCase().includes(term) ||
      (opt.subtitle && opt.subtitle.toLowerCase().includes(term)) ||
      (opt.badge && opt.badge.toLowerCase().includes(term))
    );
  });

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchTerm('');
  };

  return (
    <div id={id ? `${id}-container` : undefined} ref={containerRef} className={`relative ${className}`}>
      {/* Hidden input for HTML form validation if required */}
      {required && (
        <input
          type="text"
          value={value}
          onChange={() => {}}
          required={required}
          className="absolute inset-0 opacity-0 pointer-events-none -z-10 h-full w-full"
          tabIndex={-1}
        />
      )}

      {/* Trigger Button */}
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        title={selectedOption ? selectedOption.label : undefined}
        className={`w-full bg-white dark:bg-[#2b2c40] border ${
          isOpen
            ? 'border-[#696cff] ring-2 ring-[#696cff]/20'
            : 'border-slate-205 dark:border-[#434460]/50 hover:border-slate-300 dark:hover:border-[#434460]'
        } text-left rounded-lg px-2.5 py-1.5 min-h-[34px] flex items-center justify-between gap-1.5 transition-all outline-none cursor-pointer select-none overflow-hidden ${
          disabled ? 'opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-800' : ''
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
          {icon ? (
            <span className="text-slate-400 dark:text-slate-500 shrink-0">{icon}</span>
          ) : (
            <User size={13} className="text-slate-400 dark:text-slate-500 shrink-0" />
          )}
          <span
            className={`text-xs font-medium truncate block min-w-0 flex-1 ${
              selectedOption
                ? 'text-slate-800 dark:text-[#dbdade]'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 text-slate-400 ml-1">
          {value && !disabled && (
            <span
              onClick={handleClear}
              className="p-0.5 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded transition-colors cursor-pointer"
              title="Effacer la sélection"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-[#696cff]' : ''}`}
          />
        </div>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute z-50 left-0 right-0 top-full mt-1.5 bg-white dark:bg-[#2b2c40] border border-slate-200/80 dark:border-[#434460]/60 rounded-lg shadow-xl shadow-slate-900/10 dark:shadow-black/40 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* Search Header */}
          <div className="p-2 border-b border-slate-100 dark:border-[#434460]/40 bg-slate-50/70 dark:bg-[#232333]/50">
            <div className="relative">
              <Search
                size={13}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
              <input
                ref={searchInputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-[#434460]/60 rounded-md outline-none focus:border-[#696cff] focus:ring-2 focus:ring-[#696cff]/20 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 transition-all font-medium"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-56 overflow-y-auto py-1 divide-y divide-slate-50 dark:divide-[#434460]/20">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isSelected = option.value === value;
                return (
                  <div
                    key={option.value}
                    onClick={() => handleSelect(option.value)}
                    className={`px-3 py-2 text-xs flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#696cff]/10 text-[#696cff] font-semibold dark:bg-[#696cff]/20 dark:text-[#b1b4ff]'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#34354c]'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{option.label}</div>
                      {option.subtitle && (
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                          {option.subtitle}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {option.badge && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-mono">
                          {option.badge}
                        </span>
                      )}
                      {isSelected && <Check size={14} className="text-[#696cff] dark:text-[#b1b4ff]" />}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-6 px-3 text-center text-xs text-slate-400 dark:text-slate-500">
                Aucun résultat trouvé
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
