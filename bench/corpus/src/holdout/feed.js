/** Builds the home feed: newest posts first, pinned posts above everything else. */

function byNewest(posts) {
    return [...posts].sort((a, b) => a.publishedAt < b.publishedAt);
}

function withPinned(posts) {
    const pinned = posts.filter((post) => post.pinned);
    const rest = posts.filter((post) => !post.pinned);
    return [...byNewest(pinned), ...byNewest(rest)];
}

function page(posts, cursor, size) {
    const start = cursor ? posts.findIndex((post) => post.id === cursor) + 1 : 0;
    return posts.slice(start, start + size);
}

module.exports = { byNewest, withPinned, page };
