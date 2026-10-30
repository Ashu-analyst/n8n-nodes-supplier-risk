import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bandFor, routeFor, scoreSupplier } from '../src/riskScore';
import { SupplierRisk } from '../nodes/SupplierRisk/SupplierRisk.node';

test('low-risk software supplier is auto-approved', () => {
  const r = scoreSupplier({ supplierId: 'S1', countryRiskIndex: 10, category: 'Software', saqScore: 95, adverseMediaCount: 0 });
  // 10*.3 + 10*.25 + 5*.25 + 0 = 6.75 -> 6.8
  assert.equal(r.score, 6.8);
  assert.equal(r.band, 'Low');
  assert.equal(r.route, 'auto-approve');
  assert.deepEqual(r.warnings, []);
});

test('high-risk raw-materials supplier goes to the committee', () => {
  const r = scoreSupplier({ supplierId: 'S2', countryRiskIndex: 80, category: 'raw materials', saqScore: 40, adverseMediaCount: 3 });
  // 80*.3 + 90*.25 + 60*.25 + 60*.2 = 24 + 22.5 + 15 + 12 = 73.5
  assert.equal(r.score, 73.5);
  assert.equal(r.band, 'High');
  assert.equal(r.route, 'compliance-committee');
});

test('missing questionnaire counts as worst case and warns', () => {
  const r = scoreSupplier({ supplierId: 'S3', countryRiskIndex: 40, category: 'logistics', saqScore: null });
  assert.equal(r.components.questionnaire, 100);
  assert.ok(r.warnings.some((w) => w.includes('questionnaire')));
});

test('adverse media is capped at 5 items', () => {
  const a = scoreSupplier({ supplierId: 'S4', countryRiskIndex: 0, category: 'software', saqScore: 100, adverseMediaCount: 5 });
  const b = scoreSupplier({ supplierId: 'S4', countryRiskIndex: 0, category: 'software', saqScore: 100, adverseMediaCount: 50 });
  assert.equal(a.score, b.score);
});

test('override is limited to ±15 points', () => {
  const base = scoreSupplier({ supplierId: 'S5', countryRiskIndex: 50, category: 'logistics', saqScore: 50 });
  const big = scoreSupplier({ supplierId: 'S5', countryRiskIndex: 50, category: 'logistics', saqScore: 50, overridePoints: 40 });
  assert.equal(Math.round((big.score - base.score) * 10) / 10, 15);
  assert.ok(big.warnings.some((w) => w.includes('Override')));
});

test('unknown category falls back to default and warns', () => {
  const r = scoreSupplier({ supplierId: 'S6', countryRiskIndex: 50, category: 'space tourism', saqScore: 50 });
  assert.equal(r.components.category, 50);
  assert.equal(r.warnings.length, 1);
});

test('band boundaries', () => {
  assert.equal(bandFor(39.9), 'Low');
  assert.equal(bandFor(40), 'Medium');
  assert.equal(bandFor(69.9), 'Medium');
  assert.equal(bandFor(70), 'High');
  assert.equal(routeFor('Medium'), 'category-manager');
});

test('invalid input throws', () => {
  assert.throws(() => scoreSupplier({ supplierId: '', countryRiskIndex: 1, category: 'software' }));
  assert.throws(() => scoreSupplier({ supplierId: 'X', countryRiskIndex: Number('abc'), category: 'software' }));
});

// --- n8n wrapper, executed with a minimal fake of IExecuteFunctions ---
function fakeContext(rows: object[], params: Record<string, unknown> = {}, continueOnFail = false) {
  const defaults: Record<string, unknown> = {
    supplierIdField: 'supplierId', countryField: 'countryRiskIndex', categoryField: 'category',
    saqField: 'saqScore', mediaField: 'adverseMediaCount', includeBreakdown: false, ...params,
  };
  return {
    getInputData: () => rows.map((json) => ({ json })),
    getNodeParameter: (name: string) => defaults[name],
    continueOnFail: () => continueOnFail,
    getNode: () => ({ name: 'Supplier Risk Score' }),
  };
}

test('node scores every item and keeps original fields', async () => {
  const node = new SupplierRisk();
  const ctx = fakeContext([
    { supplierId: 'A', countryRiskIndex: 10, category: 'software', saqScore: 90, name: 'Acme' },
    { supplierId: 'B', countryRiskIndex: 85, category: 'textiles', saqScore: 30, adverseMediaCount: 4 },
  ]);
  const [out] = await node.execute.call(ctx as never);
  assert.equal(out.length, 2);
  assert.equal(out[0].json.name, 'Acme');
  assert.equal((out[0].json.risk as { band: string }).band, 'Low');
  assert.equal((out[1].json.risk as { route: string }).route, 'compliance-committee');
});

test('node continues on fail when enabled', async () => {
  const node = new SupplierRisk();
  const ctx = fakeContext([{ supplierId: '', countryRiskIndex: 10, category: 'software' }], {}, true);
  const [out] = await node.execute.call(ctx as never);
  assert.match(String(out[0].json.error), /supplierId/);
});
