// Playwright test harness: boots QEMU WASM, waits for display, runs PBW install
// Usage: node test-install.mjs
import { chromium } from 'playwright-core';

const TIMEOUT = 5 * 60 * 1000; // 5 minutes total

async function main() {
    const browser = await chromium.launch({
        headless: false,  // need to see what's happening
        args: [
            '--enable-features=SharedArrayBuffer',
            // COOP/COEP headers are set by server.py, but just in case:
            '--disable-web-security',
        ],
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // Forward console messages
    page.on('console', msg => {
        const text = msg.text();
        // Filter noise but show install-related messages
        if (text.includes('[install]') || text.includes('[RX') || text.includes('[TX]') ||
            text.includes('[main]') || text.includes('[boot]') || text.includes('[QEMU]') ||
            text.includes('[putbytes]') || text.includes('[pbw]') || text.includes('[serial]') ||
            text.includes('ERROR') || text.includes('error')) {
            console.log(text);
        }
    });

    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

    console.log('Navigating to test harness...');
    await page.goto('http://localhost:8000/web/test-install.html', { timeout: 30000 });

    console.log('Waiting for test to complete (up to 5 min)...');

    // Wait for either success or failure
    try {
        await page.waitForFunction(() => {
            const log = document.getElementById('log').textContent;
            return log.includes('INSTALL COMPLETE') || log.includes('ERROR:');
        }, { timeout: TIMEOUT });
    } catch(e) {
        console.log('Timeout reached. Dumping log...');
    }

    // Get final log content
    const logContent = await page.evaluate(() => document.getElementById('log').textContent);
    console.log('\n=== FULL LOG ===');
    console.log(logContent);
    console.log('=== END LOG ===');

    // Take screenshot
    await page.screenshot({ path: 'test-install-result.png' });
    console.log('Screenshot saved to test-install-result.png');

    await browser.close();
}

main().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
});
