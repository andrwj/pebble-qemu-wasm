#!/usr/bin/env node
/**
 * Longer FPS test — separate boot phase from steady-state
 */
import { chromium } from 'playwright';

async function main() {
    const browser = await chromium.launch({
        headless: false,
        args: ['--enable-features=SharedArrayBuffer'],
    });
    const page = await (await browser.newContext()).newPage();
    const fpsReadings = [];
    const timestamps = [];

    page.on('console', msg => {
        const text = msg.text();
        const match = text.match(/\[fps\]\s+([\d.]+)/);
        if (match) {
            fpsReadings.push(parseFloat(match[1]));
            timestamps.push(Date.now());
            console.log(`  FPS: ${match[1]}`);
        }
    });

    try {
        console.log('Loading with auto-boot...');
        await page.goto('http://localhost:8000/index.html?auto', { timeout: 30000 });

        console.log('Waiting for first frames + collecting 90s total...');
        const deadline = Date.now() + 180000;
        while (fpsReadings.length < 1 && Date.now() < deadline) {
            await page.waitForTimeout(3000);
        }
        if (fpsReadings.length === 0) {
            console.log('No FPS readings');
            return;
        }

        // Collect 90s of data
        await page.waitForTimeout(90000);

        console.log('\n=== Results ===');
        if (fpsReadings.length <= 2) {
            console.log('Too few readings');
            return;
        }

        // Split into boot (first 30s) and steady-state (after 30s)
        const firstTime = timestamps[0];
        const bootReadings = [];
        const steadyReadings = [];

        for (let i = 1; i < fpsReadings.length; i++) {
            const elapsed = (timestamps[i] - firstTime) / 1000;
            if (elapsed < 30) {
                bootReadings.push(fpsReadings[i]);
            } else {
                steadyReadings.push(fpsReadings[i]);
            }
        }

        function stats(arr) {
            if (arr.length === 0) return 'no data';
            const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
            return `${arr.length} readings, Avg=${avg.toFixed(1)}, Min=${Math.min(...arr).toFixed(1)}, Max=${Math.max(...arr).toFixed(1)}`;
        }

        console.log(`Boot phase (0-30s):     ${stats(bootReadings)}`);
        console.log(`Steady-state (30s+):    ${stats(steadyReadings)}`);
        console.log(`Overall:                ${stats(fpsReadings.slice(1))}`);
    } finally {
        await browser.close();
    }
}

main();
