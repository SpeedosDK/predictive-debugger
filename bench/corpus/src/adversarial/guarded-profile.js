/** Display helper whose guard sits well above the dereference. */

function displayName(session) {
    if (!session || !session.user || typeof session.user.displayName !== "string") {
        return "Guest";
    }

    const locale = session.locale || "en-US";
    const formatter = new Intl.DateTimeFormat(locale);
    const joined = session.joinedAt ? formatter.format(session.joinedAt) : "unknown";

    const label = session.user.displayName.trim();
    return label.length > 0 ? `${label} (since ${joined})` : `Member since ${joined}`;
}

module.exports = { displayName };
