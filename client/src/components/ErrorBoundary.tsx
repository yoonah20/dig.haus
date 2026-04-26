import { Component, type ErrorInfo, type ReactNode } from 'react';

// Top-level error boundary — catches render-time errors anywhere
// in the React tree and falls back to a simple recovery card
// instead of leaving the user with a blank white screen. Logs
// the error to the console for the developer + a reload button
// for the visitor; keeps the failure local rather than letting
// the whole tab go dark.

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
  }

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center px-6 py-16 bg-[#0a0703] text-gray-100">
          <div className="max-w-md w-full text-center">
            <div className="text-3xl mb-3">😵‍💫</div>
            <h1
              className="text-xl font-bold mb-2"
              style={{ fontFamily: "'Syne', 'Inter', sans-serif" }}
            >
              앗, 화면이 무너졌어요.
            </h1>
            <p className="text-sm text-gray-400 mb-5 leading-relaxed">
              일시적인 문제일 가능성이 높아요. 새로고침 한 번 해 보시고,
              계속 나타나면 잠시 후 다시 시도해 주세요.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="text-sm text-[#1a1208] bg-[#e8a020] hover:bg-[#f0b040] font-semibold px-4 py-2 rounded-full transition-colors"
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
