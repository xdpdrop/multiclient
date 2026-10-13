// Run with: npx electron scripts/generate-icon.cjs
// Georgia must be installed to reproduce the application's original wordmark.
const { app, BrowserWindow, nativeImage } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  let window;
  try {
    const resources = join(__dirname, '../resources');
    const svg = await readFile(join(resources, 'icon.svg'), 'utf8');
    window = new BrowserWindow({
      width: 1024,
      height: 1024,
      show: false,
      frame: false,
      transparent: true,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    await window.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{width:100%;height:100%}</style>${svg}`,
      )}`,
    );
    const dataUrl = await window.webContents.executeJavaScript(`(async () => {
      await document.fonts.ready;
      const svg = new XMLSerializer().serializeToString(document.querySelector('svg'));
      const source = new Image();
      source.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await source.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1024;
      canvas.getContext('2d').drawImage(source, 0, 0, 1024, 1024);
      return canvas.toDataURL('image/png');
    })()`);
    const image = nativeImage.createFromDataURL(dataUrl).resize({
      width: 512,
      height: 512,
      quality: 'best',
    });
    if (image.isEmpty()) throw new Error('Icon rendering produced an empty image.');
    await writeFile(join(resources, 'icon.png'), image.toPNG());

    // PNG-backed ICO entries cover standard and high-DPI Windows taskbar sizes.
    const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
    const header = Buffer.alloc(6 + sizes.length * 16);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(sizes.length, 4);
    const entries = [];
    let offset = header.length;
    sizes.forEach((size, index) => {
      const png = image.resize({ width: size, height: size, quality: 'best' }).toPNG();
      const entry = 6 + index * 16;
      header[entry] = size === 256 ? 0 : size;
      header[entry + 1] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, entry + 4);
      header.writeUInt16LE(32, entry + 6);
      header.writeUInt32LE(png.length, entry + 8);
      header.writeUInt32LE(offset, entry + 12);
      entries.push(png);
      offset += png.length;
    });
    await writeFile(join(resources, 'icon.ico'), Buffer.concat([header, ...entries]));
    console.log('Created resources/icon.png (512×512) and resources/icon.ico.');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    window?.destroy();
    app.exit(process.exitCode || 0);
  }
});
