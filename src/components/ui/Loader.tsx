export default function Loader({ label = 'Warming tyres…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="-rotate-2 animate-pulse rounded-full border-2 border-ink bg-pop-sun px-4 py-2 font-mono text-sm font-semibold tracking-widest text-ink shadow-sticker-sm">
        {label}
      </div>
    </div>
  );
}
