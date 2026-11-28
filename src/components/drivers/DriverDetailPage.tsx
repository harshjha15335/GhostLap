import { Link, useParams } from 'react-router-dom';

/**
 * PLACEHOLDER so the /drivers/:code route compiles in the Teams branch.
 * The Drivers agent owns the real page; keep theirs when merging.
 */
export default function DriverDetailPage() {
  const { code } = useParams();
  return (
    <main className="theme-paper pop-dots flex min-h-screen flex-col items-center justify-center gap-4 bg-pop-pink px-4 pt-12 text-center text-ink">
      <div className="font-display text-5xl uppercase">{code}</div>
      <Link to="/drivers" className="rounded-full border-2 border-ink bg-cream px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] shadow-sticker">
        All drivers
      </Link>
    </main>
  );
}
