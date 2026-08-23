#!/usr/bin/env node
/**
 * FPS test with icount shift=6 (the setting used for the "5.5 FPS" measurement)
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
            console.log('  FPS:', match[1]);
        }
        if (text.includes('[config]') || text.includes('[status]') || text.includes('Display active')) {
            console.log('  [c]', text.substring(0, 120));
        }
    });

    try {
        // Use icount shift=6 via URL parameter
        console.log('Loading with ?shift=6&auto...');
        await page.goto('http://localhost:8000/index.html?shift=6&auto', { timeout: 30000 });

        // Wait for boot + FPS readings (longer with icount, boot is slower)
        console.log('Waiting for FPS readings (up to 4 min)...');
        const deadline = Date.now() + 240000;
        while (fpsReadings.length < 3 && Date.now() < deadline) {
            await page.waitForTimeout(5000);
            if (fpsReadings.length > 0) console.log(`  ${fpsReadings.length} readings so far`);
        }

        // Collect for 60s at steady state
        console.log('Collecting steady-state FPS for 60s...');
        await page.waitForTimeout(60000);

        console.log('\n=== FPS Results (icount shift=6) ===');
        if (fpsReadings.length > 2) {
            const readings = fpsReadings.slice(1); // skip warmup
            const avg = readings.reduce((a, b) => a + b, 0) / readings.length;
            console.log(`Readings: ${readings.length}, Avg: ${avg.toFixed(1)}, Min: ${Math.min(...readings).toFixed(1)}, Max: ${Math.max(...readings).toFixed(1)}`);
        } else {
            console.log(`Only ${fpsReadings.length} readings captured`);
        }
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await browser.close();
    }
}

main();
