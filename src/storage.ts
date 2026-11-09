interface StoredRecord {
    id?: number;
    time: number;
    voltage: number;
    current: number;
    power: number;
    energy: number;
    capacity: number;
    resistance: number;
    temp: number;
    data1: number | null;
    data2: number | null;
    duration: string;
    type: number;
}

class MeterStorage {
    private dbName = "usb_meter_db";
    private dbVersion = 1;
    private storeName = "measurements";
    private db: IDBDatabase | null = null;

    async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    const store = db.createObjectStore(this.storeName, {
                        keyPath: "id",
                        autoIncrement: true,
                    });
                    store.createIndex("time", "time", { unique: false });
                }
            };

            request.onsuccess = (event) => {
                this.db = (event.target as IDBOpenDBRequest).result;
                resolve();
            };

            request.onerror = (event) => {
                console.error("Failed to open IndexedDB", event);
                reject((event.target as IDBOpenDBRequest).error);
            };
        });
    }

    async addRecord(record: StoredRecord): Promise<number> {
        if (!this.db) {
            await this.init();
        }
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject(new Error("Database not initialized"));
            }
            const tx = this.db.transaction(this.storeName, "readwrite");
            const store = tx.objectStore(this.storeName);
            const req = store.add(record);

            req.onsuccess = () => {
                resolve(req.result as number);
            };

            req.onerror = () => {
                reject(req.error);
            };
        });
    }

    async getAllRecords(): Promise<StoredRecord[]> {
        if (!this.db) {
            await this.init();
        }
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject(new Error("Database not initialized"));
            }
            const tx = this.db.transaction(this.storeName, "readonly");
            const store = tx.objectStore(this.storeName);
            const req = store.getAll();

            req.onsuccess = () => {
                resolve(req.result as StoredRecord[]);
            };

            req.onerror = () => {
                reject(req.error);
            };
        });
    }

    async clear(): Promise<void> {
        if (!this.db) {
            await this.init();
        }
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject(new Error("Database not initialized"));
            }
            const tx = this.db.transaction(this.storeName, "readwrite");
            const store = tx.objectStore(this.storeName);
            const req = store.clear();

            req.onsuccess = () => {
                resolve();
            };

            req.onerror = () => {
                reject(req.error);
            };
        });
    }
}
