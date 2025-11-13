import Database from "better-sqlite3";
import NodeCache from "node-cache";

export default function useBetterSqlite3AuthState (
	dbPath,
	{ proto, initAuthCreds, BufferJSON }
) {
	if (!dbPath || typeof dbPath !== "string") {
		throw new Error("Invalid dbPath: expected a valid database file path.");
	}

	// Validation for required modules
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

	const cache = new NodeCache({ stdTTL: 600, checkperiod: 600 });

	try {
		db.exec(`
			CREATE TABLE IF NOT EXISTS auth_state (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				key TEXT UNIQUE NOT NULL,
				value TEXT NOT NULL
			);
		`);
	} catch (err) {
		throw new Error(`Failed to initialize database table: ${err.message}`);
	}

	const getValue = (dbKey) => {
		try {
			const cached = cache.get(dbKey);
			if (cached !== undefined) return cached;

			const row = db
				.prepare("SELECT value FROM auth_state WHERE key = ?")
				.get(dbKey);
			if (row) {
				const value = JSON.parse(row.value, BufferJSON.reviver);
				cache.set(dbKey, value);
				return value;
			}
			cache.set(dbKey, null);
			return null;
		} catch (err) {
			console.error(`[AuthState] Error reading key "${dbKey}":`, err);
			return null;
		}
	};

	const setValue = (dbKey, value) => {
		try {
			cache.set(dbKey, value);
			if (value) {
				db.prepare(
					"INSERT OR REPLACE INTO auth_state (key, value) VALUES (?, ?)"
				).run(dbKey, JSON.stringify(value, BufferJSON.replacer));
			} else {
				db.prepare("DELETE FROM auth_state WHERE key = ?").run(dbKey);
				cache.del(dbKey);
			}
		} catch (err) {
			console.error(`[AuthState] Error writing key "${dbKey}":`, err);
		}
	};

	const getCreds = () => {
		try {
			const credsKey = "creds";
			let creds = getValue(credsKey);
			if (!creds) {
				creds = initAuthCreds();
				setValue(credsKey, creds);
			}
			return creds;
		} catch (err) {
			throw new Error(
				`[AuthState] Failed to load credentials: ${err.message}`
			);
		}
	};

	const setCreds = (creds) => {
		try {
			setValue("creds", creds);
		} catch (err) {
			console.error(
				`[AuthState] Failed to save credentials: ${err.message}`
			);
		}
	};

	const readKey = (type, id) => getValue(`key:${type}:${id}`);
	const writeKey = (type, id, value) => setValue(`key:${type}:${id}`, value);
	const removeKey = (type, id) => setValue(`key:${type}:${id}`, null);

	const creds = getCreds();

	const state = {
		creds,
		keys: {
			get: (type, ids) => {
				const data = {};
				for (const id of ids) {
					try {
						let value = readKey(type, id);
						if (type === "app-state-sync-key" && value) {
							value =
								proto.Message.AppStateSyncKeyData.fromObject(
									value
								);
						}
						data[id] = value;
					} catch (err) {
						console.error(
							`[AuthState] Failed to read key ${type}:${id}`,
							err
						);
						data[id] = null;
					}
				}
				return data;
			},
			set: (data) => {
				for (const category in data) {
					for (const id in data[category]) {
						try {
							const value = data[category][id];
							value
								? writeKey(category, id, value)
								: removeKey(category, id);
						} catch (err) {
							console.error(
								`[AuthState] Failed to write key ${category}:${id}`,
								err
							);
						}
					}
				}
			}
		}
	};

	const saveCreds = () => {
		try {
			setCreds(state.creds);
		} catch (err) {
			console.error("[AuthState] Failed to save creds:", err);
		}
	};

	const resetSession = () => {
		try {
			cache.flushAll();
			db.exec("DELETE FROM auth_state");
		} catch (err) {
			console.error("[AuthState] Failed to reset session:", err);
		}
	};

	return { state, saveCreds, resetSession };
};
