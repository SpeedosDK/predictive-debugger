let count = 0;

async function increment() {
    const current = count;
    await new Promise(r => setTimeout(r, 10));
    count = current + 1; // race condition
}
