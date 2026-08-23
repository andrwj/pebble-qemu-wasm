#!/usr/bin/env node
/**
 * Playwright FPS test using the OLD root-level index.html
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
        if (text.includes('[boot]') || text.includes('[config]') || text.includes('Display active')) {
            console.log('  [browser]', text);
        }
    });

    try {
        // Use old root-level index.html (served at /index.html since server serves ".")
        console.log('Loading OLD index.html (root)...');
        await page.goto('http://localhost:8000/index.html', { timeout: 30000 });

        // Click the "Boot" button to start — old page had a manual boot
        console.log('Clicking Boot...');
        await page.waitForSelector('#btn-boot', { timeout: 5000 }).catch(() => null);
        const bootBtn = await page.$('#btn-boot');
        if (bootBtn) await bootBtn.click();
        else console.log('  No boot button found, auto-booting...');

        // Collect FPS for 45 seconds
        console.log('Collecting FPS for 45s...');
        await page.waitForTimeout(45000);

        console.log('\n=== OLD page FPS Results ===');
        if (fpsReadings.length > 0) {
            const readings = fpsReadings.length > 2 ? fpsReadings.slice(1) : fpsReadings;
            const avg = readings.reduce((a, b) => a + b, 0) / readings.length;
            console.log(`Readings: ${readings.length}, Avg: ${avg.toFixed(1)}, Min: ${Math.min(...readings).toFixed(1)}, Max: ${Math.max(...readings).toFixed(1)}`);
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
