#!/usr/bin/env node
/**
 * Playwright test: measure FPS of Pebble WASM emulator.
 * Boots, waits for steady-state, then collects FPS readings.
 */

import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:8000/web';

async function main() {
    const browser = await chromium.launch({
        headless: false,
        args: ['--enable-features=SharedArrayBuffer'],
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    const fpsReadings = [];
    page.on('console', msg => {
        const text = msg.text();
        // Capture FPS log lines from QEMU
        const match = text.match(/\[fps\]\s+([\d.]+)/);
        if (match) {
            fpsReadings.push(parseFloat(match[1]));
            console.log('  FPS:', match[1]);
        }
        if (text.includes('[main]') || text.includes('[fatal]')) {
            console.log('  [browser]', text);
        }
    });

    try {
        console.log('Loading index.html...');
        await page.goto(`${BASE_URL}/index.html`, { timeout: 30000 });

        // Wait for boot
        console.log('Waiting for boot...');
        await page.waitForFunction(() => {
            const loading = document.getElementById('loading');
            return loading && loading.classList.contains('hidden');
        }, null, { timeout: 120000, polling: 2000 });
        console.log('Booted! Collecting FPS readings for 30s...');

        // Collect FPS for 30 seconds
        await page.waitForTimeout(30000);

        console.log('\n=== FPS Results ===');
        if (fpsReadings.length > 0) {
            // Skip first reading (may be warming up)
            const readings = fpsReadings.length > 2 ? fpsReadings.slice(1) : fpsReadings;
            const avg = readings.reduce((a, b) => a + b, 0) / readings.length;
            const min = Math.min(...readings);
            const max = Math.max(...readings);
            console.log(`Readings: ${readings.length}`);
            console.log(`Average: ${avg.toFixed(1)} FPS`);
            console.log(`Min: ${min.toFixed(1)} FPS`);
            console.log(`Max: ${max.toFixed(1)} FPS`);
        } else {
            console.log('No FPS readings captured');
        }

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await browser.close();
    }
}

main();
