import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ExtensionPanelBoundaryProps {
  pluginId: string;
  panelId: string;
  title: string;
  render: () => ReactNode;
}

interface ExtensionPanelBoundaryState {
  error: Error | null;
}

function ExtensionPanelContents({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
}

/** Keep one faulty plugin panel from taking down the entire Dockview workspace. */
export class ExtensionPanelBoundary extends Component<
  ExtensionPanelBoundaryProps,
  ExtensionPanelBoundaryState
> {
  state: ExtensionPanelBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ExtensionPanelBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[Feather plugin: ${this.props.pluginId}] Panel ${this.props.panelId} crashed`,
      error,
      info,
    );
  }

  componentDidUpdate(previous: ExtensionPanelBoundaryProps): void {
    if (previous.render !== this.props.render && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <aside className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Plugin panel failed</span>
              <h2>{this.props.title}</h2>
            </div>
          </div>
          <div className="empty-state wide">
            <p>{this.state.error.message}</p>
            <button className="full-button" onClick={() => this.setState({ error: null })}>Retry panel</button>
          </div>
        </aside>
      );
    }

    return <ExtensionPanelContents render={this.props.render} />;
  }
}
