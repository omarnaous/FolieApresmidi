/** The in-between states every sheet has: waiting, and failed. */

export function Loading({ label }: { label: string }) {
  return (
    <p className="acct-state label muted" role="status">{label}</p>
  );
}

export function LoadError({ title, message, onRetry }: { title: string; message?: string; onRetry?: () => void }) {
  return (
    <div className="acct-state" role="alert">
      <span className="display d-sm">{title}</span>
      {message && <span className="label muted">{message}</span>}
      {onRetry && <button className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}
