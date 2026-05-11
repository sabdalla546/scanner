const { app, BrowserWindow, ipcMain } = require("electron");
const { exec } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const DEFAULT_NAPS2_PATH = "C:\\Program Files\\NAPS2\\NAPS2.Console.exe";
const NAPS2_PATH = process.env.NAPS2_PATH || DEFAULT_NAPS2_PATH;
const NAPS2_PROFILE_NAME =
  process.env.NAPS2_PROFILE_NAME || "Signed Contract Scanner";
const SCAN_DIR = path.join(os.tmpdir(), "scanner-electron-scans");

const SCANNER_HTTP_PORT = Number(process.env.SCANNER_HTTP_PORT) || 17855;
const MAX_JSON_BODY_BYTES = 1024 * 1024;

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

/** @type {http.Server | null} */
let httpServer = null;

function getAllowedOrigins() {
  const set = new Set(DEFAULT_ALLOWED_ORIGINS);
  const extra = process.env.SCANNER_ALLOWED_ORIGINS;
  if (extra) {
    for (const part of extra.split(",")) {
      const trimmed = part.trim();
      if (trimmed) {
        set.add(trimmed);
      }
    }
  }
  return set;
}

function getCorsHeaders(origin, allowedOrigins) {
  if (!origin || !allowedOrigins.has(origin)) {
    return {};
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;

    const finish = (fn) => {
      if (settled) {
        return;
      }
      settled = true;
      fn();
    };

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.resume();
        finish(() =>
          reject(Object.assign(new Error("Payload too large"), { code: "PAYLOAD_TOO_LARGE" })),
        );
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        finish(() => resolve({}));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        finish(() =>
          reject(Object.assign(new Error("Invalid JSON"), { code: "INVALID_JSON" })),
        );
        return;
      }
      finish(() => resolve(parsed));
    });

    req.on("error", (err) => finish(() => reject(err)));
  });
}

function scanFailureHttpStatus(errorMessage) {
  if (!errorMessage) {
    return 500;
  }
  if (
    errorMessage === "Contract ID is required." ||
    errorMessage === "Contract ID is too long."
  ) {
    return 400;
  }
  if (errorMessage.includes("NAPS2 CLI was not found")) {
    return 503;
  }
  return 500;
}

function startScannerHttpServer() {
  const allowedOrigins = getAllowedOrigins();

  httpServer = http.createServer(async (req, res) => {
    const origin = req.headers.origin;

    if (origin && !allowedOrigins.has(origin)) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      return;
    }

    const cors = getCorsHeaders(origin, allowedOrigins);
    let pathname;
    try {
      pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8", ...cors });
      res.end(JSON.stringify({ error: "Bad request URL" }));
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        ...cors,
      });
      res.end(
        JSON.stringify({
          ok: true,
          service: "scanner-electron",
          naps2Path: NAPS2_PATH,
          profile: NAPS2_PROFILE_NAME,
        }),
      );
      return;
    }

    if (req.method === "POST" && pathname === "/scan-contract") {
      let body;
      try {
        body = await readJsonBody(req, MAX_JSON_BODY_BYTES);
      } catch (err) {
        if (err && err.code === "PAYLOAD_TOO_LARGE") {
          res.writeHead(413, {
            "Content-Type": "application/json; charset=utf-8",
            ...cors,
          });
          res.end(JSON.stringify({ error: "Request body too large" }));
          return;
        }
        if (err && err.code === "INVALID_JSON") {
          res.writeHead(400, {
            "Content-Type": "application/json; charset=utf-8",
            ...cors,
          });
          res.end(JSON.stringify({ error: "Invalid JSON body" }));
          return;
        }
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
          ...cors,
        });
        res.end(JSON.stringify({ error: "Failed to read request body" }));
        return;
      }

      const result = await scanContract(body);

      if (!result.success) {
        const status = scanFailureHttpStatus(result.error);
        res.writeHead(status, {
          "Content-Type": "application/json; charset=utf-8",
          ...cors,
        });
        res.end(JSON.stringify({ error: result.error || "Scan failed" }));
        return;
      }

      let pdfBuffer;
      try {
        pdfBuffer = Buffer.from(result.data, "base64");
      } catch {
        res.writeHead(500, {
          "Content-Type": "application/json; charset=utf-8",
          ...cors,
        });
        res.end(JSON.stringify({ error: "Invalid scan data encoding" }));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Content-Length": pdfBuffer.length,
        ...cors,
      });
      res.end(pdfBuffer);
      return;
    }

    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
      ...cors,
    });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.on("error", (err) => {
    console.error("Scanner HTTP bridge failed to start:", err.message || err);
  });

  httpServer.listen(SCANNER_HTTP_PORT, "127.0.0.1", () => {
    console.log(
      `Scanner HTTP bridge running at http://127.0.0.1:${SCANNER_HTTP_PORT}`,
    );
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 420,
    height: 320,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  window.loadFile(path.join(__dirname, "index.html"));
}

function ensureScanDirectory() {
  fs.mkdirSync(SCAN_DIR, { recursive: true });
}

function sanitizeContractId(contractId) {
  return String(contractId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-");
}

function validateContractId(contractId) {
  if (typeof contractId !== "string" && typeof contractId !== "number") {
    return "Contract ID is required.";
  }

  const value = String(contractId).trim();

  if (!value) {
    return "Contract ID is required.";
  }

  if (value.length > 100) {
    return "Contract ID is too long.";
  }

  return null;
}

function buildScanCommand(outputPath) {
  return `"${NAPS2_PATH}" -o "${outputPath}" -p "${NAPS2_PROFILE_NAME}" -f`;
}

function mapScanError(error, stdout, stderr) {
  const details = [error?.message, stdout, stderr].filter(Boolean).join(" ").toLowerCase();

  if (
    error &&
    (error.code === "ENOENT" ||
      details.includes("is not recognized") ||
      details.includes("cannot find the file"))
  ) {
    return `NAPS2 CLI was not found at "${NAPS2_PATH}".`;
  }

  if (details.includes("cancel")) {
    return "Scan was cancelled.";
  }

  return "Scan failed.";
}

function runScan(outputPath) {
  const command = buildScanCommand(outputPath);

  return new Promise((resolve, reject) => {
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(mapScanError(error, stdout, stderr)));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function scanContract(payload) {
  const validationError = validateContractId(payload?.contractId);

  if (validationError) {
    return { success: false, error: validationError };
  }

  ensureScanDirectory();

  const safeContractId = sanitizeContractId(payload.contractId) || "scan";
  const fileName = `contract-${safeContractId}.pdf`;
  const outputPath = path.join(
    SCAN_DIR,
    `${Date.now()}-${process.pid}-${fileName}`,
  );

  try {
    if (!fs.existsSync(NAPS2_PATH)) {
      return {
        success: false,
        error: `NAPS2 CLI was not found at "${NAPS2_PATH}".`,
      };
    }

    await runScan(outputPath);

    if (!fs.existsSync(outputPath)) {
      return {
        success: false,
        error: "Scan finished, but no PDF file was created.",
      };
    }

    const fileBuffer = fs.readFileSync(outputPath);

    if (!fileBuffer.length) {
      return {
        success: false,
        error: "The scanned PDF file is empty.",
      };
    }

    return {
      success: true,
      fileName,
      mimeType: "application/pdf",
      data: fileBuffer.toString("base64"),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Scan failed.",
    };
  } finally {
    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
      } catch (cleanupError) {
        console.warn("Failed to remove temporary scan file:", cleanupError);
      }
    }
  }
}

ipcMain.handle("scan-contract", async (_event, payload) => scanContract(payload));

app.whenReady().then(() => {
  ensureScanDirectory();
  startScannerHttpServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
