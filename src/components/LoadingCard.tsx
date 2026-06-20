export function LoadingCard() {
  return (
    <div className="bg-card-bg border border-border rounded-lg p-5 animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-3 w-24 bg-border rounded" />
        <div className="h-3 w-16 bg-border rounded" />
      </div>
      <div className="h-5 w-full bg-border rounded mb-1.5" />
      <div className="h-5 w-3/4 bg-border rounded mb-3" />
      <div className="h-3.5 w-full bg-border rounded mb-1" />
      <div className="h-3.5 w-full bg-border rounded mb-1" />
      <div className="h-3.5 w-2/3 bg-border rounded mb-3" />
      <div className="flex gap-2">
        <div className="h-5 w-12 bg-border rounded-full" />
        <div className="h-5 w-16 bg-border rounded-full" />
      </div>
    </div>
  );
}

export function LoadingRow() {
  return (
    <div className="bg-background border-2 border-border rounded-lg px-5 py-3.5 animate-pulse">
      <div className="h-5 w-3/4 bg-border rounded mb-2" />
      <div className="flex items-center gap-2">
        <div className="h-3.5 w-3.5 bg-border rounded-sm" />
        <div className="h-3 w-24 bg-border rounded" />
        <div className="h-3 w-12 bg-border rounded" />
        <div className="h-3 w-14 bg-border rounded" />
      </div>
    </div>
  );
}
