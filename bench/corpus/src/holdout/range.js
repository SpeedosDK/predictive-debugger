/** Calendar helpers. Ranges are inclusive of both `from` and `to`. */

function daysBetween(from, to) {
    const days = [];
    for (let day = from; day <= to; day++) {
        days.push(day);
    }
    return days;
}

function countDays(from, to) {
    return to < from ? 0 : to - from + 1;
}

module.exports = { daysBetween, countDays };
