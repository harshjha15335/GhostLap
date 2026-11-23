import type { Quality } from '../../trackModel';
import { circuitAdsUrl, circuitFacadesUrl, loadCircuitEnv } from '../shared/loader';
import type { CircuitEnvData } from '../shared/types';

export const shanghaiAdsUrl = (quality: Quality) => circuitAdsUrl('shanghai', quality);
export const shanghaiFacadesUrl = (quality: Quality) => circuitFacadesUrl('shanghai', quality);
export const loadShanghaiEnv = (quality: Quality): Promise<CircuitEnvData> =>
  loadCircuitEnv('shanghai', 'shanghai_env', quality);
