import { chromium } from 'playwright-core'
const out = process.argv[3] || '/tmp/shot'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1280, height: 300 } })
const errors = []
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
await page.goto(process.argv[2] || 'http://localhost:5173', { waitUntil: 'load' })
await page.waitForTimeout(2200)

// Crop the top bar only
await page.screenshot({ path: out + '-bar-light.png', clip: { x: 0, y: 0, width: 1280, height: 120 } })

// Open File menu to show section icon + submenu still fine
await page.getByRole('button', { name: 'Analysis' }).click()
await page.waitForTimeout(350)
await page.screenshot({ path: out + '-analysis.png', clip: { x: 0, y: 0, width: 560, height: 300 } })
await page.keyboard.press('Escape')

// Flip to dark theme via View menu
await page.getByRole('button', { name: 'View' }).click()
await page.waitForTimeout(300)
await page.getByRole('menuitem', { name: /Dark theme/ }).click()
await page.waitForTimeout(400)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.screenshot({ path: out + '-bar-dark.png', clip: { x: 0, y: 0, width: 1280, height: 120 } })

const sessionLabel = await page.locator('.session-label').textContent().catch(() => null)
const triggers = await page.locator('.menu-trigger').count()
console.log(JSON.stringify({ sessionLabel, triggers, errors }, null, 2))
await browser.close()
