import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReport } from './markdown.mjs';

const arm = (detected, bugs, falseAlarms, controls, total = 0, cost = 0) =>
    ({ detected, bugs, otherVerified: 0, falseAlarms, controls, total: { total, cost } });

test('report checks the original cases against the previous results and explains the new ones', () => {
    const report = renderReport({
        trials: 3,
        arms: [arm(47, 51, 0, 60, 2060, 1.6), arm(41, 51, 3, 60, 1000, 2.4), arm(51, 51, 0, 60, 1030, 1.3)],
        groups: {
            original: { read: arm(35, 39, 0, 45), previous: arm(38, 39, 3, 45), current: arm(39, 39, 0, 45) },
            added: { read: arm(12, 12, 0, 15), previous: arm(3, 12, 0, 15), current: arm(12, 12, 0, 15) }
        },
        sessions: { rows: [{ arm: 'previous', cold: true, cost: 1 }, { arm: 'previous', cold: false, cost: 0.4 },
            { arm: 'current', cold: false, cost: 0.36 }] },
        prior: { detected: 38, bugs: 39, falseAlarms: 0, controls: 45 }
    });
    assert.match(report, /v0\.7\.1 found 38\/39, the same as v0\.7/);
    assert.match(report, /found\s+3\/12; v0\.7\.2 includes it and found 12\/12/);
    assert.match(report, /3% more tokens than v0\.7\.1 and 50% fewer than direct reading/);
    assert.doesNotMatch(report, /CLI-estimated cost|\$\d|subscription invoices/);
    assert.match(report, /including cache reads and writes/);
    assert.ok(report.split(/\s+/).length < 600);
});
