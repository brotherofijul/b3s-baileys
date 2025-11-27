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
		throw new Error("Missing required dependencies.");
	}

	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = NORMAL");
	db.pragma("temp_store = MEMORY");
	db.pragma("cache_size = -8000");

	db.exec(`
    CREATE TABLE IF NOT EXISTS auth_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      value TEXT
    )
  `);

	const upsertStmt = db.prepare(
		`INSERT INTO auth_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
	);

	const getStmt = db.prepare(`SELECT value FROM auth_state WHERE key = ?`);
	const deleteStmt = db.prepare(`DELETE FROM auth_state WHERE key = ?`);
	const clearStmt = db.prepare(`DELETE FROM auth_state`);


	const readValue = async (key) => {
		const cached = cache.get(key);
		if (cached !== undefined) return cached;

		const row = getStmt.get(key);
		if (!row) return null;

		const parsed = JSON.parse(row.value, BufferJSON.reviver);
		cache.set(key, parsed);
		return parsed;
	};

	const writeValue = async (key, value) => {
		const stringified = JSON.stringify(value, BufferJSON.replacer);
		upsertStmt.run(key, stringified);
		cache.set(key, value);
	};

	const removeValue = async (key) => {
		deleteStmt.run(key);
		cache.del(key);
	};

	const clearAll = async () => {
		clearStmt.run();
		cache.flushAll();
	};

	const creds = (await readValue("creds")) ?? initAuthCreds();

	if (!cache.has("creds")) {
		await writeValue("creds", creds);
	}

	return {
		state: {
			creds,

			keys: {
				get: async (type, ids) => {
					const data = {};
					await Promise.all(
						ids.map(async (id) => {
							const key = `${type}-${id}`;
							let value = await readValue(key);

							if (type === "app-state-sync-key" && value) {
								value =
									proto.Message.AppStateSyncKeyData.fromObject(
										value
									);
							}

							data[id] = value ?? null;
						})
					);
					return data;
				},

				set: async (data) => {
					const tasks = [];

					for (const category in data) {
						for (const id in data[category]) {
							const value = data[category][id];
							const key = `${category}-${id}`;

							if (value) {
								tasks.push(writeValue(key, value));
							} else {
								tasks.push(removeValue(key));
							}
						}
					}

					await Promise.all(tasks);
				}
			}
		},
		
		saveCreds: async () => {
			await writeValue("creds", creds);
		},
		
		resetSession: async () => {
			await clearAll();
		}
	};
}
