import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  constructor(props: Props) {
    super(props);
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component tree:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  public handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[50vh] w-full items-center justify-center p-6">
          <div className="max-w-md w-full bg-white dark:bg-[#2b2c40] rounded-2xl border border-rose-200/80 dark:border-rose-900/50 p-6 shadow-xl text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto ring-8 ring-rose-50/50 dark:ring-rose-950/20">
              <AlertTriangle size={24} />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 font-sans">
                {this.props.fallbackTitle || "Une interruption inattendue s'est produite"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                Le module a rencontré un problème temporaire d'affichage. Vous pouvez le relancer immédiatement.
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 bg-slate-50 dark:bg-[#232333] rounded-lg text-left overflow-x-auto border border-slate-200/60 dark:border-[#434460]/40">
                <p className="text-[11px] font-mono text-rose-700 dark:text-rose-300 break-all font-semibold">
                  {this.state.error.message || String(this.state.error)}
                </p>
              </div>
            )}

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2.5 rounded-lg text-xs font-bold bg-[#696cff] hover:bg-[#5f61e6] text-white shadow-sm transition-all cursor-pointer inline-flex items-center gap-2"
              >
                <RefreshCw size={14} />
                <span>Réessayer</span>
              </button>

              <button
                type="button"
                onClick={this.handleReload}
                className="px-4 py-2.5 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-[#383952] dark:hover:bg-[#434460] text-slate-700 dark:text-slate-200 transition-all cursor-pointer inline-flex items-center gap-2"
              >
                <Home size={14} />
                <span>Actualiser la page</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
