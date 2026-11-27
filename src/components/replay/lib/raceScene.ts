import type { CircuitGeometry, RaceBundle } from '@/types';
import type { RaceTimeline } from '@/engine/raceInterpolator';
import { createCircuitCurve, type CircuitCurve } from '@/engine/circuitCurve';
import { buildTrackModel, type TrackModel } from '@/components/track/trackModel';
import { REPLAY_TRACK_OPTS } from './dims';
import { buildLaneTrack, type LaneTrack } from './laneTrack';
import { planRetirements, type RetirePlan } from './incidents';

/** A safety-car period in replay time. */
export interface ScWindow {
  startLap: number;
  endLap: number;
  /** leader starts startLap: SC leaves the pit exit */
  tStart: number;
  /** leader starts endLap: lights off, SC peels into the pit lane at the end of this lap */
  tLastLap: number;
  /** leader starts the lap after endLap (green) */
  tEnd: number;
}

/** Everything the replay scene derives once per race (built when the race loads). */
export interface RaceScene {
  bundle: RaceBundle;
  timeline: RaceTimeline;
  circuit: CircuitGeometry;
  curve: CircuitCurve;
  model: TrackModel;
  lt: LaneTrack;
  plans: (RetirePlan | null)[];
  sc: ScWindow[];
}

const cache = new WeakMap<RaceTimeline, RaceScene>();

export function buildRaceScene(bundle: RaceBundle, timeline: RaceTimeline): RaceScene {
  const hit = cache.get(timeline);
  if (hit) return hit;
  const circuit = bundle.circuit;
  const curve = createCircuitCurve(circuit);
  const model = buildTrackModel(circuit, curve, REPLAY_TRACK_OPTS);
  const lt = buildLaneTrack(model);
  const plans = planRetirements(bundle, timeline, lt, model.corners);
  const reds = bundle.trackStatus.filter((w) => w.type === 'RED');
  const sc: ScWindow[] = bundle.trackStatus
    .filter((w) => w.type === 'SC')
    .map((w) => {
      // a red flag inside the period ends it: everyone (SC included) goes to the pit lane
      const red = reds.find((r) => r.startLap >= w.startLap && r.startLap <= w.endLap);
      const endLap = Math.max(w.startLap, red ? red.startLap : w.endLap);
      return {
        startLap: w.startLap,
        endLap,
        tStart: timeline.timeAtLap(w.startLap),
        tLastLap: timeline.timeAtLap(endLap),
        tEnd: endLap + 1 <= timeline.totalLaps ? timeline.timeAtLap(endLap + 1) : timeline.duration,
      };
    });
  const scene = { bundle, timeline, circuit, curve, model, lt, plans, sc };
  cache.set(timeline, scene);
  return scene;
}
