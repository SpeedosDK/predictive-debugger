/** Export writer that releases its handle without waiting. */

class ExportWriter {
    constructor(storage) {
        this.storage = storage;
    }

    async write(name, rows) {
        const handle = await this.storage.open(name);
        try {
            let written = 0;
            for (const row of rows) {
                await handle.append(JSON.stringify(row));
                written += 1;
            }
            return written;
        } finally {
            handle.close();
        }
    }
}

module.exports = { ExportWriter };
