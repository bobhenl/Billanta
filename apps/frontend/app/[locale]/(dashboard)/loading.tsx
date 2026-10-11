/**
 * Shown the moment a dashboard link is tapped, while the next page renders
 * on the server, so a slow page never looks like the tap did nothing (the
 * header and the tab bar stay; only the content area is replaced).
 */
export default function DashboardLoading() {
  return (
    <div role="status" aria-busy="true" className="animate-pulse">
      <span className="sr-only">…</span>
      <div className="h-7 w-48 rounded-md bg-secondary" />
      <div className="mt-2 h-4 w-72 max-w-full rounded-md bg-secondary" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 rounded-xl border border-border bg-card" />
        ))}
      </div>
      <div className="mt-4 h-64 rounded-xl border border-border bg-card" />
    </div>
  );
}
