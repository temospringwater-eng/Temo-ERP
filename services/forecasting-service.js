'use strict';

const INSUFFICIENT_DATA_MESSAGE = 'Not enough historical data for reliable forecasting.';

class DeterministicBaselineProvider {
  constructor(options = {}) {
    this.recentPeriods = options.recentPeriods || 3;
  }

  forecast(periods) {
    const observed = periods.filter((period) => Number(period.value) > 0);
    if (observed.length < this.recentPeriods) {
      return { reliable: false, message: INSUFFICIENT_DATA_MESSAGE };
    }

    const recent = periods.slice(-this.recentPeriods).map((period) => Number(period.value) || 0);
    const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const trend = (last - first) / Math.max(1, recent.length - 1);
    const forecast = Math.max(0, average + trend);
    const mean = average || 1;
    const variance = recent.reduce((sum, value) => sum + ((value - average) ** 2), 0) / recent.length;
    const coefficientOfVariation = Math.sqrt(variance) / mean;
    const confidence = Math.round(Math.max(25, Math.min(90, 85 - (coefficientOfVariation * 50) + Math.min(10, observed.length * 2))));

    return {
      reliable: true,
      method: 'deterministic-recent-average-trend',
      forecast: Number(forecast.toFixed(2)),
      confidence,
      recentPeriods: this.recentPeriods,
      average: Number(average.toFixed(2)),
      trend: Number(trend.toFixed(2)),
      explanation: `Forecast = average of the last ${this.recentPeriods} periods (${average.toFixed(2)}) plus the observed per-period trend (${trend.toFixed(2)}). No external AI or synthetic history is used.`
    };
  }
}

class ForecastingService {
  constructor(provider = new DeterministicBaselineProvider()) {
    this.provider = provider;
  }

  async forecast(input) {
    const history = await input.loadHistoricalData();
    const periods = history.periods || [];
    const result = this.provider.forecast(periods);
    return {
      ...result,
      metric: input.metric,
      horizon: input.horizon,
      dataWindow: history.dataWindow,
      sourceCounts: history.sourceCounts,
      periods,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = { ForecastingService, DeterministicBaselineProvider, INSUFFICIENT_DATA_MESSAGE };
