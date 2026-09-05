import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReport } from './markdown.mjs';
test('report shows higher direct-reading cost even when token use falls', () => {
    const arms = [
        { detected: 35, bugs: 39, falseAlarms: 2, controls: 45, total: { total: 1000, cost: 1 } },
        { detected: 39, bugs: 39, falseAlarms: 1, controls: 45, total: { total: 900, cost: 1.5 } },
        { detected: 39, bugs: 39, falseAlarms: 1, controls: 45, total: { total: 800, cost: 1.1 } }
    ];
    const report = renderReport(arms);
    assert.match(report, /20% fewer total tokens/);
    assert.match(report, /10% more than direct reading/);
    assert.match(report, /not subscription invoices/);
    assert.ok(report.split(/\s+/).length < 350);
});
