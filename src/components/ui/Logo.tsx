/**
 * GhostLap sticker logo: chartreuse die-cut label, "GHOST" in asphalt black and "LAP" in
 * crimson, condensed display type, dark keyline and a hard drop shadow. Sized by font-size,
 * so `className="text-xl"` in the nav and a clamp() size in the hero both work.
 */
export default function Logo({ className = '', tilt = -4 }: { className?: string; tilt?: number }) {
  return (
    <span
      className={`sticker inline-flex select-none items-center rounded-[0.42em] border-[0.09em] border-asphalt bg-neon px-[0.34em] pb-[0.02em] pt-[0.06em] font-display uppercase leading-none tracking-[0.01em] shadow-[0_0.09em_0_#080B10] ${className}`}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <span className="text-asphalt">Ghost</span>
      <span className="text-crimson">Lap</span>
    </span>
  );
}
