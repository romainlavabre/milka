// Renders build/logo.svg to build/icon.png (512x512, transparent corners).
//
// Run: npx electron build/render-icon.cjs
//
// Uses offscreen rendering: capturing a hidden window fails without a GPU.
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const SIZE = Number(process.env.ICON_SIZE ?? 512)
const OUT = process.env.ICON_OUT ?? join(__dirname, 'icon.png')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const svg = readFileSync(join(__dirname, 'logo.svg'), 'utf8')
  const window = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  window.webContents.setFrameRate(1)
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('width="512" height="512"', `width="${SIZE}" height="${SIZE}"`)}</body></html>`
  window.webContents.on('paint', (_event, _dirty, image) => {
    writeFileSync(OUT, image.resize({ width: SIZE, height: SIZE }).toPNG())
    console.log(`Wrote ${OUT}`)
    app.exit(0)
  })
  await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
})
