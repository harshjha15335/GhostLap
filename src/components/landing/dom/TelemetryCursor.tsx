import { useEffect } from 'react';
import type { LandingBus } from '../bus';

/**
 * Oversized cut-out pointer with a live delta readout driven by cursor speed:
 * move fast and you "gain" time (green, negative), crawl and you lose it.
 * Only mounted for fine pointers with hover; touch devices keep the native UI.
 */
export default function TelemetryCursor({ bus }: { bus: LandingBus }) {
  // The visible pointer now lives in ui/StickerCursor; this only feeds the 3D scene's pointer.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      bus.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      bus.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
      bus.pointer.active = true;
    };
    const onLeave = () => {
      bus.pointer.active = false;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [bus]);

  return null;
}
