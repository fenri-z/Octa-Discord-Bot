class GuildCache {
    #cache = new Map();
    #ttl;

    constructor(ttlMs = 60_000) {
        this.#ttl = ttlMs;
        // Bersihkan entry kadaluarsa setiap 5 menit
        setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.#cache) {
                if (now > entry.expires) this.#cache.delete(key);
            }
        }, 300_000).unref();
    }

    get(key) {
        const entry = this.#cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expires) { this.#cache.delete(key); return null; }
        return entry.value;
    }

    set(key, value) {
        this.#cache.set(key, { value, expires: Date.now() + this.#ttl });
    }

    del(key) { this.#cache.delete(key); }

    // Hapus semua key yang diawali prefix tertentu
    delPrefix(prefix) {
        for (const key of this.#cache.keys()) {
            if (key.startsWith(prefix)) this.#cache.delete(key);
        }
    }
}

module.exports = new GuildCache(60_000);
