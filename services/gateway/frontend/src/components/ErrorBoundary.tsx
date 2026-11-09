import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** Where this is, for the console log ("Home tab", "card BedroomLamp"). */
  label: string;
  /** 'page' fills its area; 'card' fits in a device-card slot; 'app' is the last resort. */
  variant?: 'page' | 'card' | 'app';
  /** When this changes, try drawing the children again (e.g. a device's new state). */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
  resetKey: unknown;
}

/**
 * Without this, one component throwing while it draws makes React remove the whole page,
 * leaving a blank screen. This catches it and shows a small "something went wrong" in place
 * of just the broken part. (Only errors while drawing; failed requests are toasts.)
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.resetKey) return { resetKey: props.resetKey, error: null };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary] ${this.props.label} crashed:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const retry = () => this.setState({ error: null });
    const variant = this.props.variant ?? 'page';

    if (variant === 'card') {
      return (
        <div className="flex flex-col justify-between gap-3 p-4 min-h-[150px] w-full rounded-3xl border border-red-900/50 bg-red-950/20">
          <AlertTriangle size={20} className="text-red-400" />
          <div>
            <p className="text-sm font-medium text-neutral-200">This card couldn’t be shown</p>
            <button onClick={retry} className="mt-1 text-xs text-neutral-400 underline underline-offset-2 hover:text-white">Try again</button>
          </div>
        </div>
      );
    }

    return (
      <div className={`flex flex-col items-center justify-center gap-4 p-8 text-center ${variant === 'app' ? 'min-h-dvh bg-neutral-950' : 'flex-1'}`}>
        <AlertTriangle size={32} className="text-red-400" />
        <div className="space-y-1">
          <p className="text-lg font-medium text-neutral-200">Something went wrong here</p>
          <p className="text-sm text-neutral-500">The rest of the app still works. Reloading usually fixes it.</p>
        </div>
        <div className="flex gap-3">
          {variant !== 'app' && (
            <button onClick={retry} className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-sm text-white">Try again</button>
          )}
          <button onClick={() => window.location.reload()} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm text-white">
            <RotateCcw size={14} /> Reload
          </button>
        </div>
      </div>
    );
  }
}
