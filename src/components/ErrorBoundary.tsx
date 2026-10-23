import { Component, type ErrorInfo, type ReactNode } from "react";
import i18n from "@/i18n";

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches a crash while drawing the UI and shows the error with a reload button,
 * instead of leaving an empty (black) window. React only offers this as a class.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // Plain elements and i18n directly: the crash may have come from a shared component
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-lg font-medium">{i18n.t("crash.title")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{i18n.t("crash.text")}</p>
        <pre className="max-h-40 max-w-2xl overflow-auto rounded-md bg-muted p-3 text-left text-xs whitespace-pre-wrap">
          {error.message}
        </pre>
        <button
          type="button"
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
          onClick={() => window.location.reload()}
        >
          {i18n.t("crash.reload")}
        </button>
      </div>
    );
  }
}
