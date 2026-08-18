/** Builds inclusive-start, exclusive-end date windows. */

const DAY_MS = 24 * 60 * 60 * 1000;

function windowDays(start, days) {
    const out = [];
    for (let i = 0; i <= days; i++) {
        out.push(new Date(start.getTime() + i * DAY_MS));
    }
    return out;
}

function isWithin(date, start, end) {
    return date >= start && date < end;
}

module.exports = { windowDays, isWithin, DAY_MS };
