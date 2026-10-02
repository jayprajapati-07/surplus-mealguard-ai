// Unit: ml-v1 forecasting — features, metrics, time-series validation, model selection.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ml from '../../src/lib/ml-forecast.ts';

const { buildFeatureRows, mae, rmse, mape, r2, rollingOriginEvaluate, predictNext, describeHistory, ML_VERSION } = ml;

const P = (soldKg, iso) => ({ soldKg, date: new Date(iso) });

describe('ml-forecast feature engineering', () => {
  it('uses only past history at each row (no leakage)', () => {
    const series = [P(10, '2026-09-01'), P(20, '2026-09-02'), P(30, '2026-09-03')];
    const rows = buildFeatureRows(series);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].prevDay, null);
    assert.equal(rows[1].prevDay, 10);
    assert.equal(rows[2].prevDay, 20);
    assert.equal(rows[2].target, 30);
    assert.ok(Math.abs(rows[2].histMean - 15) < 1e-9);
  });

  it('exposes version ml-v1', () => {
    assert.equal(ML_VERSION, 'ml-v1');
  });
});

describe('ml-forecast metrics', () => {
  it('computes MAE and RMSE on known values', () => {
    assert.equal(mae([10, 20], [12, 18]), 2);
    assert.ok(Math.abs(rmse([10, 20], [12, 18]) - 2) < 1e-9);
  });

  it('computes MAPE skipping zero actuals, null when none usable', () => {
    assert.ok(Math.abs(mape([100, 200], [110, 180]) - 10) < 1e-9);
    assert.equal(mape([0, 0], [1, 2]), null);
  });

  it('computes R2 as 1 for perfect predictions, null without variance', () => {
    assert.ok(Math.abs(r2([10, 20, 30], [10, 20, 30]) - 1) < 1e-9);
    assert.equal(r2([10, 10, 10], [10, 10, 10]), null);
  });
});

describe('ml-forecast time-series validation', () => {
  it('flags insufficient data below 2 points', () => {
    const out = rollingOriginEvaluate([42], [1]);
    assert.equal(out.insufficient, true);
  });

  it('never trains on future records (cutoff respected)', () => {
    // Spike at the end: any model trained WITH future data would predict ~100 for fold 1.
    const sold = [10, 10, 10, 10, 100];
    const dows = [1, 2, 3, 4, 5];
    const out = rollingOriginEvaluate(sold, dows, 2);
    assert.equal(out.insufficient, undefined);
    assert.ok(out.best.folds >= 1);
    // First fold trains on [10,10] only, so its error on 10 must be ~0 for mean models.
    assert.ok(out.best.mae < 50);
  });

  it('selects seasonal-naive over global-mean on a strong weekly pattern', () => {
    // Mondays sell 50, other days sell 10 — 3 full weeks.
    const sold = [];
    const dows = [];
    const base = new Date('2026-08-31'); // a Monday
    for (let i = 0; i < 21; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      dows.push(d.getUTCDay());
      sold.push(d.getUTCDay() === 1 ? 50 : 10);
    }
    const out = rollingOriginEvaluate(sold, dows, 4);
    assert.equal(out.best.modelName, 'seasonal-naive');
  });

  it('predictNext returns prediction, spread and sample size from history only', () => {
    const sold = [10, 12, 11, 13, 12, 14, 13, 15];
    const dows = [1, 2, 3, 4, 5, 6, 0, 1];
    const p = predictNext(sold, dows, 2, 'weighted-baseline');
    assert.ok(p.predicted > 0 && p.predicted < 30);
    assert.ok(p.std >= 0);
    assert.equal(p.sampleSize, 8);
  });

  it('describeHistory reports mean, spread and variation honestly', () => {
    const d = describeHistory([10, 20, 30]);
    assert.ok(Math.abs(d.mean - 20) < 1e-9);
    assert.ok(d.std > 0);
    assert.ok(Math.abs(d.cv - d.std / 20) < 1e-3);
    assert.equal(d.n, 3);
    const empty = describeHistory([]);
    assert.equal(empty.n, 0);
    assert.equal(empty.mean, 0);
  });
});
