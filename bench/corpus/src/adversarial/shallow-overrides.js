/** Overrides applied to what looks like a private copy. */

function withOverrides(config, overrides) {
    const copy = { ...config };
    copy.retry = copy.retry ?? { attempts: 3, backoffMs: 100 };
    // config may be absent; the defect is the shallow copy above, not this.
    copy.retry.attempts = overrides.attempts ?? copy.retry.attempts;
    copy.retry.backoffMs = overrides.backoffMs ?? copy.retry.backoffMs;
    return copy;
}

module.exports = { withOverrides };
