#!/usr/bin/env node
/**
 * Quick FPS test — auto-boot, collect 45s of FPS readings
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:8000/index-old.html?auto';
const label = process.argv[3] || 'test';

async function main() {
    const browser = await chromium.launch({
        headless: false,
        args: ['--enable-features=SharedArrayBuffer'],
    });
    const page = await (await browser.newContext()).newPage();
    const fpsReadings = [];

    page.on('console', msg => {
        const text = msg.text();
        const match = text.match(/\[fps\]\s+([\d.]+)/);
        if (match) {
            fpsReadings.push(parseFloat(match[1]));
            console.log(`  FPS: ${match[1]}`);
        }
    });

    try {
        console.log(`Loading ${url}...`);
        await page.goto(url, { timeout: 30000 });

        // Click Boot if not auto-booting (wait a moment for page to load)
        await page.waitForTimeout(1000);
        try {
            const bootBtn = await page.$('#btn-boot:not([disabled])');
            if (bootBtn) {
                console.log('Clicking Boot...');
                await bootBtn.click();
            }
        } catch(e) {
            console.log('Boot button check skipped:', e.message.substring(0, 60));
        }

        console.log('Waiting for boot (up to 3 min)...');
        const deadline = Date.now() + 180000;
        while (fpsReadings.length < 1 && Date.now() < deadline) {
            await page.waitForTimeout(3000);
        }

        console.log('Collecting FPS for 40s...');
        await page.waitForTimeout(40000);

        const readings = fpsReadings.length > 2 ? fpsReadings.slice(1) : fpsReadings;
        if (readings.length > 0) {
            const avg = readings.reduce((a, b) => a + b, 0) / readings.length;
            console.log(`\n=== ${label} ===`);
            console.log(`Readings: ${readings.length}, Avg: ${avg.toFixed(1)}, Min: ${Math.min(...readings).toFixed(1)}, Max: ${Math.max(...readings).toFixed(1)}`);
        } else {
            console.log('No FPS readings captured');
        }
    } finally {
        await browser.close();
    }
}

main();
