import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import Logo from './Logo';

/**
 * Fixed 48px top bar shared by every route: a chalk strip with a halftone screen and an
 * ink keyline, the GhostLap logo sticker and ink links; the active route is a hot-magenta
 * die-cut sticker.
 */
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
    `relative rounded-md border-2 px-3 py-[3px] font-mono text-[11px] font-semibold uppercase tracking-[0.14em] transition-[transform,background-color,color] ${
      active
        ? '-rotate-2 border-ink bg-pop-pink text-ink shadow-sticker-sm'
        : 'border-transparent text-ink/75 hover:-translate-y-px hover:border-ink/20 hover:bg-ink/[0.06] hover:text-ink'
    }`;

  // bg-cream/95, not solid: a fully opaque fixed bar over a fixed WebGL canvas trips a
  // compositor occlusion bug in some Chrome builds (the canvas loses a header-tall strip
  // at the bottom of the screen)
  return (
    <header className="theme-paper pop-dots fixed inset-x-0 top-0 z-50 h-12 border-b-2 border-ink bg-cream/95">
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-4 px-4">
        <NavLink to="/" className="flex items-center gap-2 rounded-md" aria-label="GhostLap home">
          <Logo className="text-[19px]" tilt={-3} />
          <span className="hidden rounded-[3px] bg-ink px-1 font-mono text-[10px] font-semibold tracking-widest text-cream sm:inline">2026</span>
        </NavLink>

        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Primary">
          {links.map((l) => {
            const active = l.match(pathname);
            return (
              <NavLink key={l.to} to={l.to} className={linkCls(active)} aria-current={active ? 'page' : undefined}>
                {l.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md border-2 border-ink bg-pop-pink text-ink shadow-sticker-sm md:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="pop-dots border-b-2 border-ink bg-cream px-4 py-2 shadow-[0_6px_0_rgba(23,15,51,0.9)] md:hidden" aria-label="Mobile">
          {links.map((l) => {
            const active = l.match(pathname);
            return (
              <NavLink
                key={l.to}
                to={l.to}
                aria-current={active ? 'page' : undefined}
                className={`my-1 flex items-center justify-between rounded-md border-2 px-3 py-2.5 font-display text-xl uppercase tracking-wide ${
                  active ? 'border-ink bg-pop-pink text-ink shadow-sticker-sm' : 'border-transparent text-ink/80 hover:bg-ink/[0.06]'
                }`}
              >
                {l.label}
                {active && <span className="font-mono text-[10px] tracking-[0.2em]">YOU ARE HERE</span>}
              </NavLink>
            );
          })}
        </nav>
      )}
    </header>
  );
}
