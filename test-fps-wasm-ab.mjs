#!/usr/bin/env node
/**
 * A/B FPS comparison: OLD WASM binary (no bridge timer) vs NEW WASM (with bridge timer)
 * Both use same page structure, only WASM binary differs.
 */
import { chromium } from 'playwright';

async function measureFPS(url, label, collectSecs = 45) {
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
            process.stdout.write(`  ${label} FPS: ${match[1]}\n`);
        }
    });

    console.log(`\n--- ${label} ---`);
    console.log(`Loading ${url}...`);
    await page.goto(url, { timeout: 30000 });

    // Click Boot button
    const bootBtn = await page.$('#btn-boot');
    if (bootBtn) {
        console.log('Clicking Boot...');
        await bootBtn.click();
    }

    // Wait for first FPS reading (boot complete)
    console.log('Waiting for boot...');
    const deadline = Date.now() + 180000;
    while (fpsReadings.length < 1 && Date.now() < deadline) {
        await page.waitForTimeout(3000);
    }

    if (fpsReadings.length === 0) {
        console.log('No FPS readings after 3 min, aborting');
        await browser.close();
        return { label, avg: 0, min: 0, max: 0, count: 0 };
    }

    // Collect steady-state FPS
    console.log(`Collecting FPS for ${collectSecs}s...`);
    await page.waitForTimeout(collectSecs * 1000);
    await browser.close();

    // Analyze (skip first reading)
    const readings = fpsReadings.length > 2 ? fpsReadings.slice(1) : fpsReadings;
    const avg = readings.reduce((a, b) => a + b, 0) / readings.length;
    const min = Math.min(...readings);
    const max = Math.max(...readings);
    console.log(`${label}: ${readings.length} readings, Avg=${avg.toFixed(1)}, Min=${min.toFixed(1)}, Max=${max.toFixed(1)}`);
    return { label, avg, min, max, count: readings.length };
}

async function main() {
    const results = [];

    // Test A: OLD WASM binary (no bridge timer, no ring buffer code)
    results.push(await measureFPS(
        'http://localhost:8000/index-old-wasm.html?auto',
        'OLD WASM (no bridge timer)'
    ));

    // Test B: NEW WASM binary (with bridge timer and ring buffer code)
    // Use the old root index.html (no JS ring buffer) to isolate WASM-side effects
    results.push(await measureFPS(
        'http://localhost:8000/index-old.html?auto',
        'NEW WASM (with bridge timer)'
    ));

    console.log('\n=== WASM A/B Comparison (no icount) ===');
    for (const r of results) {
        console.log(`${r.label}: Avg=${r.avg.toFixed(1)} FPS (${r.count} readings)`);
    }
    if (results.length === 2 && results[0].avg > 0 && results[1].avg > 0) {
        const diff = ((results[1].avg - results[0].avg) / results[0].avg * 100).toFixed(1);
        console.log(`Difference: ${diff}% (positive = new is faster)`);
    }
}

main();
