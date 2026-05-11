# Windows installer icon

Before shipping a branded build to employees, replace the placeholder icon:

1. Put a real Windows **`.ico`** file at **`build/icon.ico`**.
2. The file must be a valid multi-resolution **ICO**. **electron-builder** currently expects the ICO to include at least a **256×256** image (plus smaller sizes for shortcuts).
3. **Do not** rename a **`.png`** to **`.ico`** — Windows and `electron-builder` expect a real ICO container; a renamed PNG will fail or look wrong in shortcuts and the installer.

Optional: use an icon editor or export from your design tool (e.g. Visual Studio Image Library, GIMP with ICO plugin, or online converters that output true ICO format).
