import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useScrollChoreography } from '@/hooks/useScrollChoreography';
import { useSeason } from '@/store/seasonStore';
import type { HotspotId, LandingBus } from './bus';
import { DriveChapter, FlowChapter, HeroChapter, HotspotPins, SpecimenChapter } from './dom/Chapters';
import { disposeSound, setSoundEnabled } from './dom/sound';
import TelemetryCursor from './dom/TelemetryCursor';
import EveryLap from './flow/EveryLap';
import { useFeatureRace } from './flow/featureRace';
import LaunchCard from './flow/LaunchCard';
import PitExit from './flow/PitExit';
import Strategist from './flow/Strategist';
import { FLOW_CSS } from './flow/theme';
import { CHAPTER_COUNT, CHAPTER_LABELS, SCENE_CHAPTERS, computeLayout } from './layout';
import { detectQuality } from './quality';
import LandingScene from './scene/LandingScene';
import { useLandingStats } from './stats';

const CSS = `
.kl-white { color: #F4F6F0; -webkit-text-stroke: 0; text-shadow: 0 0.035em 0 #080B10, 0 0.07em 0 rgba(0,0,0,.35); }
.kl-neon { color: #D4FF00; text-shadow: 0 0.035em 0 #080B10, 0 0.07em 0 rgba(0,0,0,.35); }
.kinetic-letter { padding: 0 0.008em; }
.tele-delta[data-gain="1"] { background: #D4FF00; color: #080B10; }
.tele-delta[data-gain="0"] { background: #FF1E1E; color: #fff; }
.landing-fine, .landing-fine a, .landing-fine button { cursor: none; }
@keyframes hs-pulse { 0%,100% { transform: scale(1); opacity: .9 } 50% { transform: scale(1.35); opacity: .35 } }
.hs-ring { animation: hs-pulse 1.8s ease-in-out infinite; }
@keyframes cue { 0%,100% { transform: translateY(0) } 50% { transform: translateY(4px) } }
.scroll-cue span { display:inline-block; animation: cue 1.4s ease-in-out infinite; }
.launch-cta { box-shadow: 0 3px 0 #080B10, 0 0 0 2px #D4FF00, 0 18px 50px rgba(212,255,0,.25); }
.drive-card { transition: transform .4s cubic-bezier(.2,.8,.2,1); }
.drive-card:hover { transform: rotate(0deg) translateY(-3px) !important; }
@media (prefers-reduced-motion: reduce) { .hs-ring, .scroll-cue span { animation: none; } }
`;

function useViewport() {
  const read = () => ({
    w: typeof document === 'undefined' ? 1440 : document.documentElement.clientWidth || window.innerWidth,
    h: typeof window === 'undefined' ? 900 : window.innerHeight,
  });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    let t = 0;
    const on = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const n = read();
        // ignore small height jitter from mobile URL bars
        setVp((o) => (o.w === n.w && Math.abs(o.h - n.h) < 80 ? o : n));
      }, 150);
    };
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('resize', on);
      window.clearTimeout(t);
    };
  }, []);
  return vp;
}

export default function Landing() {
  const quality = useMemo(detectQuality, []);
  const vp = useViewport();
  const layout = useMemo(() => computeLayout(vp.w, vp.h), [vp]);
  const choreo = useScrollChoreography(CHAPTER_COUNT);
  const season = useSeason();
  const stats = useLandingStats(season);
  const [hover, setHover] = useState<HotspotId | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  // the WebGL world only renders while chapters 1-4 can be seen; once the orange
  // strategist section covers the viewport the canvas is hidden and its loop stops
  const [sceneLive, setSceneLive] = useState(true);
  const [flowNear, setFlowNear] = useState(false);
  const feature = useFeatureRace(flowNear, season);

  const busRef = useRef<LandingBus | null>(null);
  if (!busRef.current) {
    busRef.current = {
      choreo: choreo.state,
      quality,
      pointer: { x: 0, y: 0, active: false },
      anchors: {},
      focus: new THREE.Vector3(),
    };
  }
  const bus = busRef.current;

  // section heights depend on layout; re-measure after they change
  useEffect(() => {
    choreo.remeasure();
  }, [layout, choreo]);

  // pointer for car tilt (touch drags count too)
  useEffect(() => {
    const on = (e: PointerEvent) => {
      bus.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      bus.pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
      bus.pointer.active = true;
    };
    window.addEventListener('pointermove', on, { passive: true });
    return () => window.removeEventListener('pointermove', on);
  }, [bus]);

  useEffect(() => () => disposeSound(), []);

  useEffect(
    () =>
      choreo.subscribe((s) => {
        const orange = s.chapters[SCENE_CHAPTERS];
        if (!orange || orange.top <= 0) return;
        setSceneLive(s.scrollY < orange.top - 1);
        if (s.scrollY > orange.top - s.vh * 3) setFlowNear(true);
      }),
    [choreo],
  );

  const toggleSound = useCallback(() => {
    setSoundOn((on) => {
      setSoundEnabled(!on);
      return !on;
    });
  }, []);

  const fine = !quality.coarse;
  const reg = choreo.register;

  return (
    <div className={`relative bg-asphalt text-white ${fine ? 'landing-fine' : ''}`} style={{ overflowX: 'clip' }}>
      <style>{FLOW_CSS + CSS}</style>

      {/* the one persistent WebGL world */}
      <div className="fixed inset-0 z-0" aria-hidden style={{ visibility: sceneLive ? 'visible' : 'hidden' }}>
        <LandingScene bus={bus} layout={layout} hover={hover} grid={stats.grid} live={sceneLive} />
        {/* editorial vignette + grain over the canvas */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(8,11,16,0.75)_100%)]" />
      </div>

      {/* projected 3D labels */}
      <div className="pointer-events-none fixed inset-0 z-20">
        <HotspotPins bus={bus} hover={hover} setHover={setHover} />
      </div>

      {/* chapter rail */}
      <nav
        aria-label="Chapters"
        className={`pointer-events-none fixed right-4 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-end gap-2 transition-opacity duration-300 lg:flex ${choreo.active >= SCENE_CHAPTERS ? 'opacity-0' : 'opacity-100'}`}
      >
        {CHAPTER_LABELS.map((label, i) => {
          const on = choreo.active === i;
          return (
            <div key={label} className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em]">
              <span className={`transition ${on ? 'text-white' : 'text-transparent'}`}>{label}</span>
              <span className={`block h-px transition-all ${on ? 'w-8 bg-neon' : 'w-4 bg-white/30'}`} />
            </div>
          );
        })}
      </nav>

      <main className="pointer-events-none relative z-10">
        <section ref={reg(0)} data-chapter="hero" className="relative min-h-[100svh]">
          <HeroChapter stats={stats} reduced={choreo.reducedMotion} soundOn={soundOn} onToggleSound={toggleSound} />
        </section>
        <section ref={reg(1)} data-chapter="specimen" className="relative h-[230vh]">
          <SpecimenChapter hover={hover} setHover={setHover} />
        </section>
        <section ref={reg(2)} data-chapter="drive" className="relative">
          <DriveChapter layout={layout} stats={stats} />
        </section>
        <section ref={reg(3)} data-chapter="flow" className="relative h-[280vh]">
          <FlowChapter stats={stats} />
        </section>
        <Strategist vp={vp} race={feature} reduced={choreo.reducedMotion} sectionRef={reg(4)} />
        <EveryLap vp={vp} race={feature} stats={stats} reduced={choreo.reducedMotion} sectionRef={reg(5)} />
        <LaunchCard vp={vp} stats={stats} sectionRef={reg(6)} />
        <PitExit vp={vp} stats={stats} reduced={choreo.reducedMotion} sectionRef={reg(7)} />
      </main>

      {fine && <TelemetryCursor bus={bus} />}
    </div>
  );
}
