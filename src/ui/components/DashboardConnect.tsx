import { useEffect, useState } from "react";
import { getSyncStatusLabel, markConnectPromptShown, shouldShowConnectPrompt } from "../../lib/digest";

/** Persistent, always-visible sync status line ("Reading digest synced 3 days ago" / "Not connected to dashboard"). */
export function DashboardSyncStatus() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    void getSyncStatusLabel().then(setLabel);
  }, []);

  if (!label) return null;
  return (
    <div className="dashboard-status-bar" title="Ellipsis can sync an anonymous weekly reading summary — article counts and bias/topic patterns only, never article URLs or content — to your Unframed dashboard.">
      {label}
    </div>
  );
}

/** Once-a-week prompt for users who haven't connected the dashboard yet. */
export function DashboardConnectBanner({ onConnect }: { onConnect: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void shouldShowConnectPrompt().then(setVisible);
  }, []);

  function dismiss() {
    setVisible(false);
    void markConnectPromptShown();
  }

  if (!visible) return null;

  return (
    <div className="notice-panel dashboard-connect-banner" role="status">
      <p>
        <strong>Connect to your Unframed dashboard</strong> to see a private weekly summary of what
        you&apos;ve been reading. Only article counts and bias/topic patterns sync — never article
        URLs or content — unless you separately opt into saved-article syncing.
      </p>
      <div className="dashboard-connect-actions">
        <button
          className="text-button"
          type="button"
          onClick={() => { dismiss(); onConnect(); }}
        >
          Connect Ellipsis
        </button>
        <button className="text-button" type="button" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
