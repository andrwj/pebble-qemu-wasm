#!/usr/bin/env node
/**
 * Quick FPS test that also captures PFLASH debug output
 */
import { chromium } from 'playwright';

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
        if (text.includes('PFLASH:')) {
            console.log(`  ${text}`);
        }
    });

    try {
        console.log('Loading with auto-boot...');
        await page.goto('http://localhost:8000/index.html?auto', { timeout: 30000 });

        console.log('Waiting for boot + FPS readings (2 min)...');
        const deadline = Date.now() + 120000;
        while (fpsReadings.length < 6 && Date.now() < deadline) {
            await page.waitForTimeout(5000);
        }

        console.log('Collecting for 30s more...');
        await page.waitForTimeout(30000);

        if (fpsReadings.length > 2) {
            const readings = fpsReadings.slice(1);
            const avg = readings.reduce((a, b) => a + b, 0) / readings.length;
            console.log(`\nAvg: ${avg.toFixed(1)} FPS (${readings.length} readings)`);
        }
    } finally {
        await browser.close();
    }
}

main();
