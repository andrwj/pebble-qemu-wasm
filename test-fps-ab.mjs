#!/usr/bin/env node
/**
 * A/B FPS test: compare old vs new WASM binary using root index.html
 * Usage: node test-fps-ab.mjs [old|new]
 */
import { chromium } from 'playwright';
import { execSync } from 'child_process';

const variant = process.argv[2] || 'current';
const COLLECT_SECONDS = 40;

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
            process.stdout.write(`  FPS: ${match[1]}\n`);
        }
        // Show boot progress
        if (text.includes('[status]') || text.includes('[config]') || text.includes('[boot]')) {
            process.stdout.write(`  ${text.substring(0, 100)}\n`);
        }
    });

    page.on('pageerror', err => console.error('  [page error]', err.message));

    try {
        console.log(`\n=== Testing ${variant} WASM binary ===`);
        console.log('Loading root index.html...');

        // Navigate - the root page has a Boot button
        await page.goto('http://localhost:8000/index.html?fw=sdk&auto', { timeout: 30000 });

        console.log(`Collecting FPS for ${COLLECT_SECONDS}s...`);
        await page.waitForTimeout(COLLECT_SECONDS * 1000);

        console.log(`\n=== ${variant.toUpperCase()} WASM Results ===`);
        if (fpsReadings.length > 0) {
            // Skip first reading (warmup)
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
