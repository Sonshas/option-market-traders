import { useSyncExternalStore } from 'react'
import { predictionStore, type PredictionState } from '@/lib/prediction-store'

/** Latest AI BOT SCANNER result and the loaded prediction. */
export function usePrediction(): PredictionState {
  return useSyncExternalStore(predictionStore.subscribe, predictionStore.getSnapshot, predictionStore.getSnapshot)
}
