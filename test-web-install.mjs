#!/usr/bin/env node
/**
 * Playwright test: boot Pebble WASM emulator and install a PBW app.
 *
 * Uses Chromium (not system Chrome) to avoid conflicts with running browsers.
 * Requires COOP/COEP headers from server.py on port 8000.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const BASE_URL = 'http://localhost:8000/web';
const TIMEOUT = 180_000; // 3 minutes total timeout

async function main() {
    console.log('Launching Chromium...');
    const browser = await chromium.launch({
        headless: false, // Need to see the display for debugging
        args: [
            '--enable-features=SharedArrayBuffer',
        ],
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // Collect console messages
    const consoleLogs = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLogs.push(text);
        // Print key events
        if (text.includes('[install]') || text.includes('[main]') ||
            text.includes('[serial]') || text.includes('[fatal]') ||
            text.includes('ERROR')) {
            console.log('  [browser]', text);
        }
    });

    page.on('pageerror', err => {
        console.error('  [page error]', err.message);
    });

    try {
        // Navigate to test-install.html (automated test harness)
        console.log('Loading test-install.html...');
        await page.goto(`${BASE_URL}/test-install.html`, { timeout: 30000 });

        // Wait for QEMU to boot and install to complete (or fail)
        console.log('Waiting for install to complete (up to 3 min)...');

        const result = await page.waitForFunction(() => {
            const logEl = document.getElementById('log');
            if (!logEl) return null;
            const text = logEl.textContent;
            if (text.includes('INSTALL COMPLETE')) return 'SUCCESS';
            if (text.includes('[install] ERROR')) {
                const match = text.match(/\[install\] ERROR: (.+)/);
                return 'FAIL: ' + (match ? match[1] : 'unknown');
            }
            return null;
        }, null, { timeout: TIMEOUT, polling: 2000 });

        const resultValue = await result.jsonValue();
        console.log('\n=== Result:', resultValue, '===\n');

        // Capture final state
        const logText = await page.evaluate(() => document.getElementById('log').textContent);
        const lines = logText.split('\n');
        console.log('Last 20 log lines:');
        lines.slice(-20).forEach(l => console.log('  ', l));

        // Take a screenshot
        await page.screenshot({ path: 'test-install-result.png' });
        console.log('Screenshot saved to test-install-result.png');

        if (resultValue === 'SUCCESS') {
            console.log('\n*** TEST PASSED: PBW install succeeded in WASM ***');
            process.exitCode = 0;
        } else {
            console.log('\n*** TEST FAILED:', resultValue, '***');
            process.exitCode = 1;
        }

    } catch (err) {
        console.error('Test error:', err.message);

        // Dump console logs on failure
        console.log('\nAll console logs:');
        consoleLogs.forEach(l => console.log('  ', l));

        try {
            await page.screenshot({ path: 'test-install-error.png' });
        } catch(e) {}

        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

main();
