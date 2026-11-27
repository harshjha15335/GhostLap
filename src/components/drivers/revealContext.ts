import { createContext, useContext, useEffect, useState } from 'react';
import { RevealEngine } from './revealEngine';

export const RevealContext = createContext<RevealEngine | null>(null);
export const useRevealEngine = () => useContext(RevealContext);

/** One engine (one WebGL canvas) per Drivers page mount; disposed on unmount. */
export function useRevealEngineHost(enabled: boolean): RevealEngine | null {
  const [engine, setEngine] = useState<RevealEngine | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const e = new RevealEngine();
    document.body.appendChild(e.canvas);
    setEngine(e);
    return () => {
      e.dispose();
      setEngine(null);
    };
  }, [enabled]);
  return engine;
}
