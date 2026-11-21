import { NavLink } from 'react-router-dom';

/** Phase 0 placeholder — Agent 4 owns and styles this. */
const links = [
  { to: '/', label: 'Home' },
  { to: '/circuits', label: 'Circuits' },
  { to: '/replay', label: 'Race Lab' },
  { to: '/season', label: 'Season' },
];

export default function PitWallNav() {
  return (
    <nav className="fixed inset-x-0 top-0 z-50 flex h-12 items-center gap-4 border-b border-line bg-asphalt/80 px-4 backdrop-blur">
      <span className="font-display text-lg tracking-wide text-neon">GHOSTLAP</span>
      {links.map((l) => (
        <NavLink key={l.to} to={l.to} className={({ isActive }) => `text-sm ${isActive ? 'text-white' : 'text-white/60'}`}>
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}
