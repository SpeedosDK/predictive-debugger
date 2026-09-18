/** Reminder scheduling over a var-scoped loop counter. */

function scheduleReminders(pending, schedule, notify) {
    for (var i = 0; i < pending.length; i++) {
        schedule(() => notify(pending[i]), i * 1000);
    }
    return pending.length;
}

module.exports = { scheduleReminders };
