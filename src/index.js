import Database from "better-sqlite3";
import NodeCache from "node-cache";

const cache = new NodeCache({ stdTTL: 0 });

export default async function useBetterSqlite3AuthState(
	dbPath,
	{ proto, initAuthCreds, BufferJSON }
) {
	if (!dbPath || typeof dbPath !== "string") {
		throw new Error("Invalid dbPath: expected a valid database file path.");
	}

	if (!proto || !initAuthCreds || !BufferJSON) {
		throw new Error(
			"Missing required dependencies: proto, initAuthCreds, and BufferJSON must be provided."
		);
	}

	if (typeof initAuthCreds !== "function") {
		throw new Error("initAuthCreds must be a function.");
	}

	if (
		typeof BufferJSON.replacer !== "function" ||
		typeof BufferJSON.reviver !== "function"
	) {
		throw new Error(
			"BufferJSON must contain valid 'replacer' and 'reviver' functions."
		);
	}

	let db;
	try {
		db = new Database(dbPath);
	} catch (err) {
		throw new Error(`Failed to open database: ${err.message}`);
	}

	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("temp_store = MEMORY");
	db.pragma("cache_size = -8000");

	db.exec(`
		CREATE TABLE IF NOT EXISTS auth_state (
		  id INTEGER PRIMARY KEY AUTOINCREMENT,
			key TEXT,
			value TEXT
		)
	`);

	const setStmt = db.prepare(
		`REPLACE INTO auth_state (key, value) VALUES (?, ?)`
	);
	const getStmt = db.prepare(`SELECT value FROM auth_state WHERE key = ?`);
	const deleteStmt = db.prepare(`DELETE FROM auth_state WHERE key = ?`);
	const clearStmt = db.prepare(`DELETE FROM auth_state`);

	const dbSet = async (key, value) => {
		return new Promise((resolve) => {
			setStmt.run(key, JSON.stringify(value, BufferJSON.replacer));
			cache.set(key, value);
			resolve();
		});
	};

	const dbGet = async (key) => {
		return new Promise((resolve) => {
			const cached = cache.get(key);
			if (cached !== undefined) return resolve(cached);

			const row = getStmt.get(key);
			if (!row) return resolve(null);

			const parsed = JSON.parse(row.value, BufferJSON.reviver);
			cache.set(key, parsed);
			resolve(parsed);
		});
	};

	const dbDelete = async (key) => {
		return new Promise((resolve) => {
			deleteStmt.run(key);
			cache.del(key);
			resolve();
		});
	};

	const dbClearAll = async () => {
		return new Promise((resolve) => {
			clearStmt.run();
			cache.flushAll();
			resolve();
		});
	};

	let creds = await dbGet("creds");
	if (!creds) {
		creds = initAuthCreds();
		await dbSet("creds", creds);
	}

	return {
		state: {
			creds,

			keys: {
				get: async (type, ids) => {
					const out = {};

					await Promise.all(
						ids.map(async (id) => {
							const keyName = `${type}-${id}`;
							let value = await dbGet(keyName);

							if (type === "app-state-sync-key" && value) {
								value =
									proto.Message.AppStateSyncKeyData.fromObject(
										value
									);
							}

							out[id] = value || null;
						})
					);

					return out;
				},

				set: async (data) => {
					const tasks = [];

					for (const category in data) {
						for (const id in data[category]) {
							const value = data[category][id];
							const keyName = `${category}-${id}`;

							if (value) {
								tasks.push(dbSet(keyName, value));
							} else {
								tasks.push(dbDelete(keyName));
							}
						}
					}

					await Promise.all(tasks);
				}
			}
		},

		saveCreds: async () => {
			await dbSet("creds", creds);
		},

		resetSession: async () => {
			await dbClearAll();
		}
	};
}
