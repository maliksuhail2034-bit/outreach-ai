// Contract a future forecasting engine will implement — trend
// extrapolation, a proper time-series model, or an AI-driven predictor. No
// implementation exists yet, per this phase's explicit scope ("No
// forecasting yet"). Mirrors lib/deliverability/dns-provider.ts's
// interface + placeholder + factory split exactly.

export interface ForecastPoint {
  date: string; // YYYY-MM-DD
  predictedValue: number;
  confidence: number; // 0-1
}

export interface Forecaster {
  forecast(history: { date: string; value: number }[], horizonDays: number): Promise<ForecastPoint[]>;
}

// Always returns no predictions — the only Forecaster implementation
// today. A real one is returned from getForecaster() instead; nothing else
// in the app changes.
export class PlaceholderForecaster implements Forecaster {
  async forecast(history: { date: string; value: number }[], horizonDays: number): Promise<ForecastPoint[]> {
    void history;
    void horizonDays;
    return [];
  }
}

export function getForecaster(): Forecaster {
  return new PlaceholderForecaster();
}
