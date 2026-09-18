/** Overrides applied to a deep copy, leaving the caller's config untouched. */

function withOverrides(config, overrides) {
    const copy = structuredClone(config ?? {});
    copy.retry = copy.retry ?? { attempts: 3, backoffMs: 100 };
    copy.retry.attempts = overrides.attempts ?? copy.retry.attempts;
    copy.retry.backoffMs = overrides.backoffMs ?? copy.retry.backoffMs;
    return copy;
}

module.exports = { withOverrides };
