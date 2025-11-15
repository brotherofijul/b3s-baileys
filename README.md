<h1 align="center">b3s-baileys</h1>
<p align="center">
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-%3E%3D18-blue.svg" alt="Node.js version" /></a>
  <a href="https://www.npmjs.com/package/b3s-baileys"><img src="https://badge.fury.io/js/b3s-baileys.svg?cache=0" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/b3s-baileys"><img src="https://img.shields.io/npm/dt/b3s-baileys.svg?cache=0" alt="npm downloads" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License" /></a>
</p>


> Lightweight Baileys auth state adapter using **better-sqlite3** and **NodeCache**  
> Built for efficient, persistent, and cache-optimized WhatsApp authentication sessions.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Description](#description)
- [License](#license)



## Installation

Install the package using your preferred JavaScript package manager:

### npm
```bash
npm install b3s-baileys
```

### pnpm
```bash
pnpm add b3s-baileys
```

### yarn
```bash
yarn add b3s-baileys
```

### bun
```bash
bun add b3s-baileys
```


### System Dependencies (Linux/Termux)

If you're on Linux or Termux (Android), install required build tools before installation:

#### Linux (Debian/Ubuntu)
```bash
sudo apt update
sudo apt install -y build-essential python3
```

#### Termux (Android)
```bash
pkg install nodejs python make clang binutils
```

For build issues on Android/Termux:
```bash
export GYP_DEFINES="android_ndk_path=''"
npm install
```


## Usage

```javascript
import { makeWASocket, DisconnectReason, proto, initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
// or
// import { makeWASocket, DisconnectReason, proto, initAuthCreds, BufferJSON } from 'baileys';
import useBetterSqlite3AuthState from 'b3s-baileys';

const { state, saveCreds, resetSession } = await useBetterSqlite3AuthState(
  './session.db',  // SQLite database path
  { proto, initAuthCreds, BufferJSON }  // Baileys utils
);

// Initialize WhatsApp socket
const sock = makeWASocket({
  auth: state,
});

// Save credentials on update
sock.ev.on('creds.update', saveCreds);

// Example: Reset session
sock.ev.on('connection.update', async(update) => {
  const { lastDisconnect, connection } = update
  if (connection === "close") {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    if (statusCode === DisconnectReason.loggedOut) {
      await resetSession()
    }
  }
})
```

## Description

`b3s-baileys` is a drop-in replacement for Baileys' default auth state management. It replaces file-based JSON storage with a single SQLite database for persistence and NodeCache for fast in-memory access (with 10-minute TTL and periodic checks).

**Key Benefits:**
- **Efficiency**: Reduces I/O operations with caching.
- **Persistence**: All auth data (creds, keys, signals) in one SQLite file.
- **Lightweight**: Minimal overhead for bots and socket apps.

Ideal for WhatsApp bots, but scale to PostgreSQL/MySQL for high-traffic production.

**Arguments:**
- `dbPath` (string): Path to SQLite file (auto-created if missing).
- `baileysUtils` (object): `{ proto, initAuthCreds, BufferJSON }` from Baileys. Validates inputs for errors.

**Error Handling:** Throws descriptive errors for invalid inputs, DB failures, or missing dependencies. Logs errors to console for reads/writes.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Developed with ❤️ by [Brother of Ijul](https://github.com/brotherofijul).
