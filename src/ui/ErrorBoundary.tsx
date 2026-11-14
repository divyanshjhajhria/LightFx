// If the interface throws, show a calm panel instead of a blank page. R restarts.
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Lightspeed FX stopped with an error:', error, info.componentStack);
  }

  // Listen from the start: a failure on the very first render never reaches componentDidUpdate.
  componentDidMount(): void {
    window.addEventListener('keydown', this.key);
  }

  componentWillUnmount(): void {
    window.removeEventListener('keydown', this.key);
  }

  /** Once failed, R restarts from the same address, so ?demo comes back as the guided demo. */
  private key = (e: KeyboardEvent) => {
    if (this.state.failed && (e.key === 'r' || e.key === 'R')) window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="crashed" role="alert">
        <p>Something went wrong. Press R to restart the demo.</p>
        <button className="primary" onClick={() => window.location.reload()}>
          Restart
        </button>
      </div>
    );
  }
}
