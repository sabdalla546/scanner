# Roses Scanner Agent (scanner-electron)

Local **Electron** app that runs **NAPS2** to scan signed contracts and exposes a small **HTTP bridge** on `127.0.0.1:17855` for the Wedding System (`GET /health`, `POST /scan-contract`).

## Installation (employees)

1. **Install NAPS2** on the PC (default install is fine if paths match your IT policy).
2. In NAPS2, create a profile named **`Signed Contract Scanner`** (exact name unless IT sets `NAPS2_PROFILE_NAME`).
3. Run **`Roses-Scanner-Agent-Setup-<version>.exe`** from IT (built artifact; see developer section).
4. Complete the installer. A **Desktop** shortcut and **Start Menu** entry **Roses Scanner Agent** are created.
5. Open **Roses Scanner Agent** from the Desktop (or Start Menu). Keep the small scanner window **open** while using the Wedding System scan button in the browser.

The Wedding System talks to **`http://127.0.0.1:17855`**. If the agent is closed, scanning from the web app will fail until you open it again.

## Developer: build the Windows installer

From this folder (`scanner-electron`):

```bash
npm install
npm run dist
```

- **`npm run dist`** — produces an **NSIS** setup executable via **electron-builder**.
- **`npm run pack`** — unpacks a directory build (faster smoke test, no full installer).

The packaged build is **unsigned** (`signAndEditExecutable: false`) so `npm run dist` works on machines where 7-Zip cannot create symbolic links inside the code-signing cache (common without Developer Mode / elevation). Your IT team can later enable **Windows code signing** and adjust `package.json` `build.win` settings when a certificate is available.

Installer output directory:

**`scanner-electron/release/`**

Example artifact name:

**`release/Roses-Scanner-Agent-Setup-1.0.0.exe`** (version follows `package.json`).

## Developer: run without packaging

```bash
npm start
```

Same behavior as the installed app: Electron window + HTTP bridge on port **17855** (or `SCANNER_HTTP_PORT` if set).

## Smoke tests (app running)

```bash
curl.exe http://127.0.0.1:17855/health
```

```bash
curl.exe -X POST http://127.0.0.1:17855/scan-contract ^
  -H "Content-Type: application/json" ^
  -d "{\"contractId\":123}" ^
  -o test-contract.pdf
```

## Environment variables (optional)

| Variable | Purpose |
|----------|---------|
| `NAPS2_PATH` | Path to `NAPS2.Console.exe` |
| `NAPS2_PROFILE_NAME` | NAPS2 profile name (default: `Signed Contract Scanner`) |
| `SCANNER_HTTP_PORT` | HTTP port (default: `17855`) |
| `SCANNER_ALLOWED_ORIGINS` | Extra CORS origins (comma-separated), in addition to localhost Vite defaults |
