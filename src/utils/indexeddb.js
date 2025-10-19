/**
 * Promise-based IndexedDB utility for reading and writing objects
 * Thanks to Sonnet for an initial boilerplate
 */
class IndexedDBStore {
  /**
   * @param {string} dbName - Name of the database
   * @param {string} storeName - Name of the object store
   * @param {number} version - Database version
   * @param {Object} schema
   * @param {string} schema.keyPath - The key path for the object store (default: 'id')
   * @param {Array<{name: string, keyPath: string, options?: {unique?: boolean, multiEntry?: boolean}}>} schema.indexes - Array of index definitions
   */
  constructor(dbName, storeName, version = 1, schema = null) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.version = version;
    /** @type {Promise<IDBDatabase>} */
    this.db = null;
    this.schema = schema || { keyPath: "id", indexes: [] };
  }

  /**
   * Open the database connection
   * @returns {Promise<IDBDatabase>}
   */
  async open() {
    if (this.db) {
      return this.db;
    }

    const { promise, resolve, reject } = Promise.withResolvers();
    this.db = promise;

    const request = indexedDB.open(this.dbName, this.version);

    request.onerror = () => {
      this.db = null;
      console.error(request.error);
      reject(request.error);
    };
    request.onsuccess = () => {
      this.db = Promise.resolve(request.result);
      resolve(this.db);
    };

    request.onupgradeneeded = (event) => {
      /** @type {IDBDatabase} */
      const db = event.target.result;
      /** @type {IDBObjectStore} */
      let objectStore;

      if (!db.objectStoreNames.contains(this.storeName)) {
        // first instantiation
        objectStore = db.createObjectStore(this.storeName, {
          keyPath: this.schema.keyPath,
        });
      } else {
        // version upgrade, when does that happen?
        objectStore = event.target.transaction.objectStore(this.storeName);
      }

      // Create indexes based on schema
      if (this.schema.indexes) {
        this.schema.indexes.forEach((index) => {
          if (!objectStore.indexNames.contains(index.name)) {
            objectStore.createIndex(
              index.name,
              index.keyPath,
              index.options || {}
            );
          }
        });
      }
    };
    return promise;
  }

  /**
   * Get a value from the store
   * @param {string|number} key - The key to retrieve
   * @returns {Promise<any>}
   */
  async get(key) {
    const db = await this.open();
    const { promise, resolve, reject } = Promise.withResolvers();

    const transaction = db.transaction([this.storeName], "readonly");
    const store = transaction.objectStore(this.storeName);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    return promise;
  }

  /**
   * Get all values from the store
   * @returns {Promise<any[]>}
   */
  async getAll() {
    const db = await this.open();
    const { promise, resolve, reject } = Promise.withResolvers();

    const transaction = db.transaction([this.storeName], "readonly");
    const store = transaction.objectStore(this.storeName);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    return promise;
  }

  /**
   * Write/update a value in the store
   * @param {any} value - The object to store (must have an 'id' property)
   * @returns {Promise<string|number>}
   */
  async put(value) {
    const db = await this.open();
    const { promise, resolve, reject } = Promise.withResolvers();

    const transaction = db.transaction([this.storeName], "readwrite");
    const store = transaction.objectStore(this.storeName);
    const request = store.put(value);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    return promise;
  }

  /**
   * Write multiple values in the store
   * @param {any[]} values - Array of objects to store
   * @returns {Promise<void>}
   */
  async putMany(values) {
    const db = await this.open();
    const { promise, resolve, reject } = Promise.withResolvers();

    const transaction = db.transaction([this.storeName], "readwrite");
    const store = transaction.objectStore(this.storeName);

    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();

    values.forEach((value) => store.put(value));

    return promise;
  }

  /**
   * Delete a value from the store
   * @param {string|number} key - The key to delete
   * @returns {Promise<void>}
   */
  async delete(key) {
    const db = await this.open();
    const { promise, resolve, reject } = Promise.withResolvers();

    const transaction = db.transaction([this.storeName], "readwrite");
    const store = transaction.objectStore(this.storeName);
    const request = store.delete(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    return promise;
  }

  /**
   * Clear all values from the store
   * @returns {Promise<void>}
   */
  async clear() {
    const db = await this.open();
    const { promise, resolve, reject } = Promise.withResolvers();

    const transaction = db.transaction([this.storeName], "readwrite");
    const store = transaction.objectStore(this.storeName);
    const request = store.clear();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();

    return promise;
  }

  /**
   * Close the database connection
   */
  async close() {
    if (this.db) {
      (await this.db).close();
      this.db = null;
    }
  }
}

export const userSummariesDb = new IndexedDBStore("user_data", "summaries", 3, {
  indexes: [
    { name: "takeaways", keyPath: "takeaways" },
    { name: "tags", keyPath: "tags" },
    { name: "url", keyPath: "url" },
    { name: "title", keyPath: "title" },
    { name: "link", keyPath: "link" },
    // This will just be a float32array with a fixed size
    { name: "embeddings", keyPath: "embeddings" },
  ],
  keyPath: "timestamp",
});
