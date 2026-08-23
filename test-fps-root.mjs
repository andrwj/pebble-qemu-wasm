#!/usr/bin/env node
/**
 * FPS test using root index.html (the user's original test page)
 */

import { chromium } from 'playwright';

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
        const match = text.match(/\[fps\]\s+([\d.]+)/);
        if (match) {
            fpsReadings.push(parseFloat(match[1]));
            console.log('  FPS:', match[1]);
        }
        // Print ALL console logs to debug
        if (!text.startsWith('PEBBLE_SNOWY') && !text.startsWith('clktree')) {
            console.log('  [c]', text.substring(0, 120));
        }
    });

    page.on('pageerror', err => console.error('  [page error]', err.message));

    try {
        console.log('Loading root index.html...');
        await page.goto('http://localhost:8000/index.html', { timeout: 30000 });

        console.log('Waiting for FPS readings (45s)...');
        await page.waitForTimeout(45000);

        console.log('\n=== FPS Results (root index.html) ===');
        if (fpsReadings.length > 0) {
            const readings = fpsReadings.length > 2 ? fpsReadings.slice(1) : fpsReadings;
            const avg = readings.reduce((a, b) => a + b, 0) / readings.length;
            console.log(`Readings: ${readings.length}`);
            console.log(`Average: ${avg.toFixed(1)} FPS`);
            console.log(`Min: ${Math.min(...readings).toFixed(1)} FPS`);
            console.log(`Max: ${Math.max(...readings).toFixed(1)} FPS`);
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
