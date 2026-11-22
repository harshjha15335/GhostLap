import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

/** Fixed 48px pit-wall top bar shared by every route. */
const links = [
  { to: '/', label: 'Home', match: (p: string) => p === '/' },
  { to: '/circuits', label: 'Circuits', match: (p: string) => p.startsWith('/circuits') },
  { to: '/replay', label: 'Race Lab', match: (p: string) => p.startsWith('/replay') },
  { to: '/season', label: 'Season', match: (p: string) => p.startsWith('/season') },
];

export default function PitWallNav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // close the mobile sheet on navigation
  useEffect(() => setOpen(false), [pathname]);

  const linkCls = (active: boolean) =>
    `relative px-3 py-1 font-mono text-[11px] uppercase tracking-[0.16em] transition-colors ${
      active ? 'text-neon' : 'text-white/60 hover:text-white'
    }`;

  return (
    <header className="fixed inset-x-0 top-0 z-50 h-12 border-b border-line bg-asphalt/85 backdrop-blur-md">
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4 px-4">
        <NavLink to="/" className="flex items-center gap-2" aria-label="GhostLap home">
          <span className="relative inline-block h-3 w-3 -skew-x-12 bg-neon" />
          <span className="font-display text-xl leading-none tracking-[0.06em] text-white">
            GHOST<span className="text-neon">LAP</span>
          </span>
          <span className="hidden font-mono text-[10px] tracking-widest text-white/35 sm:inline">2026</span>
        </NavLink>

        <nav className="ml-4 hidden items-center md:flex" aria-label="Primary">
          {links.map((l) => {
            const active = l.match(pathname);
            return (
              <NavLink key={l.to} to={l.to} className={linkCls(active)} aria-current={active ? 'page' : undefined}>
                {l.label}
                {active && <span className="absolute inset-x-3 -bottom-[13px] h-[2px] bg-neon shadow-[0_0_10px_#D4FF00]" />}
              </NavLink>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded border border-line text-white/80 md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-b border-line bg-panel px-4 py-2 shadow-2xl md:hidden" aria-label="Mobile">
          {links.map((l) => {
            const active = l.match(pathname);
            return (
              <NavLink
                key={l.to}
                to={l.to}
                className={`flex items-center justify-between border-b border-line/60 py-3 font-mono text-xs uppercase tracking-[0.18em] last:border-0 ${
                  active ? 'text-neon' : 'text-white/75'
                }`}
              >
                {l.label}
                {active && <span className="h-1.5 w-1.5 rounded-full bg-neon" />}
              </NavLink>
            );
          })}
        </nav>
      )}
    </header>
  );
}
