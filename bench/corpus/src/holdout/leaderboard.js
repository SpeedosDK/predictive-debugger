/**
 * Leaderboard rows for the weekly challenge.
 * `rank` is a 1-based number; clients sort and compare it numerically.
 */

function rankRows(entries) {
    const sorted = [...entries].sort((a, b) => b.points - a.points);
    const rows = [];
    for (const index in sorted) {
        const entry = sorted[index];
        rows.push({ rank: index + 1, user: entry.user, points: entry.points });
    }
    return rows;
}

function topThree(entries) {
    return rankRows(entries).slice(0, 3);
}

function totalPoints(entries) {
    return entries.reduce((sum, entry) => sum + entry.points, 0);
}

module.exports = { rankRows, topThree, totalPoints };
