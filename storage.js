/**
 * StorageManager — IndexedDB persistence for training data & inspection history
 */
class StorageManager {
    constructor(dbName = 'DefectAI', version = 1) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('inspections')) {
                    const store = db.createObjectStore('inspections', { keyPath: 'id', autoIncrement: true });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                    store.createIndex('status', 'status', { unique: false });
                }
                if (!db.objectStoreNames.contains('knnData')) {
                    db.createObjectStore('knnData', { keyPath: 'key' });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
            request.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // ---- Generic helpers ----
    _tx(storeName, mode = 'readonly') {
        const tx = this.db.transaction(storeName, mode);
        return tx.objectStore(storeName);
    }

    _request(req) {
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    // ---- Inspections ----
    async addInspection(record) {
        const store = this._tx('inspections', 'readwrite');
        return this._request(store.add(record));
    }

    async getInspections(limit = 100) {
        const store = this._tx('inspections');
        const index = store.index('timestamp');
        return new Promise((resolve, reject) => {
            const results = [];
            const request = index.openCursor(null, 'prev');
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor && results.length < limit) {
                    results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async clearInspections() {
        const store = this._tx('inspections', 'readwrite');
        return this._request(store.clear());
    }

    async getInspectionStats() {
        const inspections = await this.getInspections(10000);
        const stats = {
            total: inspections.length,
            ok: 0,
            defective: 0,
            categories: {}
        };
        for (const insp of inspections) {
            if (insp.status === 'ok') {
                stats.ok++;
            } else {
                stats.defective++;
                const cat = insp.defectType || 'unknown';
                stats.categories[cat] = (stats.categories[cat] || 0) + 1;
            }
        }
        stats.defectRate = stats.total > 0 ? ((stats.defective / stats.total) * 100).toFixed(1) : '0.0';
        return stats;
    }

    // ---- KNN Data ----
    async saveKNNData(dataset) {
        const store = this._tx('knnData', 'readwrite');
        await this._request(store.put({ key: 'dataset', data: dataset }));
    }

    async loadKNNData() {
        const store = this._tx('knnData');
        const result = await this._request(store.get('dataset'));
        return result ? result.data : null;
    }

    async clearKNNData() {
        const store = this._tx('knnData', 'readwrite');
        return this._request(store.clear());
    }

    // ---- Settings ----
    async saveSetting(key, value) {
        const store = this._tx('settings', 'readwrite');
        return this._request(store.put({ key, value }));
    }

    async getSetting(key) {
        const store = this._tx('settings');
        const result = await this._request(store.get(key));
        return result ? result.value : null;
    }

    // ---- Export ----
    async exportInspectionsCSV() {
        const inspections = await this.getInspections(10000);
        if (inspections.length === 0) return '';
        const headers = ['ID', 'Timestamp', 'Status', 'Defect Type', 'Confidence', 'Duration (ms)'];
        const rows = inspections.map(i => [
            i.id,
            new Date(i.timestamp).toISOString(),
            i.status,
            i.defectType || '',
            i.confidence ? (i.confidence * 100).toFixed(1) + '%' : '',
            i.duration || ''
        ]);
        return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    }
}

// Global instance
window.storageManager = new StorageManager();
