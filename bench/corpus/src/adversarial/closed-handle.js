/** Export writer that always releases its handle. */

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
            await handle.flush();
            return written;
        } finally {
            await handle.close();
        }
    }
}

module.exports = { ExportWriter };
