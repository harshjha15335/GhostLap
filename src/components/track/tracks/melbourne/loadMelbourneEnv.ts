import type { Quality } from '../../trackModel';
import { circuitAdsUrl, circuitFacadesUrl, loadCircuitEnv } from '../shared/loader';
import type { AlbertParkEnvData } from './types';

export const melbourneAdsUrl = (quality: Quality) => circuitAdsUrl('melbourne', quality);
export const melbourneFacadesUrl = (quality: Quality) => circuitFacadesUrl('melbourne', quality);
export const loadMelbourneEnv = (quality: Quality): Promise<AlbertParkEnvData> =>
  loadCircuitEnv('melbourne', 'albert_park_env', quality);
