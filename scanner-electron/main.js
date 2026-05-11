const { app, BrowserWindow, ipcMain } = require("electron");
const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_NAPS2_PATH = "C:\\Program Files\\NAPS2\\NAPS2.Console.exe";
const NAPS2_PATH = process.env.NAPS2_PATH || DEFAULT_NAPS2_PATH;
const NAPS2_PROFILE_NAME = "Signed Contract Scanner";
const SCAN_DIR = path.join(os.tmpdir(), "scanner-electron-scans");

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
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
