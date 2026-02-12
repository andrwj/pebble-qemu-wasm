#!/usr/bin/env node
/**
 * Playwright test: boot Pebble WASM emulator via index.html,
 * install a PBW app via the file picker.
 */

import { chromium } from 'playwright';
import path from 'path';

const BASE_URL = 'http://localhost:8000/web';
const TIMEOUT = 180_000;

async function main() {
    console.log('Launching Chromium...');
    const browser = await chromium.launch({
        headless: false,
        args: ['--enable-features=SharedArrayBuffer'],
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    const consoleLogs = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLogs.push(text);
        if (text.includes('[install]') || text.includes('[main]') ||
            text.includes('[serial]') || text.includes('[fatal]') ||
            text.includes('Ready')) {
            console.log('  [browser]', text);
        }
    });

    page.on('pageerror', err => {
        console.error('  [page error]', err.message);
    });

    try {
        console.log('Loading index.html...');
        await page.goto(`${BASE_URL}/index.html`, { timeout: 30000 });

        // Wait for the loading overlay to disappear (firmware booted + serial ready)
        console.log('Waiting for firmware to boot and serial to initialize...');
        await page.waitForFunction(() => {
            const loading = document.getElementById('loading');
            return loading && loading.classList.contains('hidden');
        }, null, { timeout: TIMEOUT, polling: 2000 });
        console.log('Firmware booted, install enabled!');

        // Take a screenshot of the booted state
        await page.screenshot({ path: 'test-index-booted.png' });
        console.log('Screenshot saved: test-index-booted.png');

        // Upload a PBW file via the hidden file input
        console.log('Installing test PBW...');
        const pbwPath = path.resolve('web/test-app.pbw');
        const fileInput = await page.$('#file-input');
        await fileInput.setInputFiles(pbwPath);

        // Wait for install to complete
        const result = await page.waitForFunction(() => {
            const status = document.getElementById('install-status');
            if (!status) return null;
            const text = status.textContent;
            if (text.includes('Install complete')) return 'SUCCESS';
            if (text.includes('Error:')) return 'FAIL: ' + text;
            return null;
        }, null, { timeout: TIMEOUT, polling: 1000 });

        const resultValue = await result.jsonValue();
        console.log('\n=== Result:', resultValue, '===\n');

        // Wait a moment for the app to render, then take screenshot
        await page.waitForTimeout(3000);
        await page.screenshot({ path: 'test-index-installed.png' });
        console.log('Screenshot saved: test-index-installed.png');

        if (resultValue === 'SUCCESS') {
            console.log('\n*** TEST PASSED: index.html PBW install succeeded ***');
            process.exitCode = 0;
        } else {
            console.log('\n*** TEST FAILED:', resultValue, '***');
            process.exitCode = 1;
        }

    } catch (err) {
        console.error('Test error:', err.message);
        console.log('\nLast 30 console logs:');
        consoleLogs.slice(-30).forEach(l => console.log('  ', l));
        try { await page.screenshot({ path: 'test-index-error.png' }); } catch(e) {}
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

main();
