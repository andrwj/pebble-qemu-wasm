#!/usr/bin/env node
// Test PBW install protocol over TCP against native QEMU
// Usage: node test-install-tcp.mjs [pbw-file] [host:port]
// This uses the EXACT same protocol logic as test-install.html but over TCP
// to verify the JS install code works against a known-good QEMU instance.

import net from 'net';
import fs from 'fs';
import JSZip from 'jszip';

const PBW_PATH = process.argv[2] || 'web/test-app.pbw';
const TARGET = process.argv[3] || 'localhost:12344';
const [HOST, PORT] = [TARGET.split(':')[0], parseInt(TARGET.split(':')[1])];

function log(msg) {
    console.log(new Date().toTimeString().slice(0,8) + '.' +
        String(new Date().getMilliseconds()).padStart(3,'0') + ' ' + msg);
}

function hexdump(data, max = 48) {
    let s = '';
    for (let i = 0; i < Math.min(data.length, max); i++) {
        s += data[i].toString(16).padStart(2, '0') + ' ';
    }
    if (data.length > max) s += '...';
    return s.trim();
}

// ================================================================
// Protocol helpers (identical to test-install.html)
// ================================================================
function buildQemuPacket(protocol, payload) {
    const frame = Buffer.alloc(8 + payload.length);
    frame.writeUInt16BE(0xFEED, 0);
    frame.writeUInt16BE(protocol, 2);
    frame.writeUInt16BE(payload.length, 4);
    payload.copy ? payload.copy(frame, 6) : frame.set(payload, 6);
    frame.writeUInt16BE(0xBEEF, 6 + payload.length);
    return frame;
}

function buildPebbleProtocol(endpoint, data) {
    const pp = Buffer.alloc(4 + data.length);
    pp.writeUInt16BE(data.length, 0);
    pp.writeUInt16BE(endpoint, 2);
    if (data.copy) data.copy(pp, 4); else pp.set(data, 4);
    return pp;
}

function buildPhoneVersionResponse() {
    const buf = Buffer.alloc(25);
    buf[0] = 0x01;
    buf.writeUInt32BE(0xFFFFFFFF, 1);
    buf.writeUInt32BE(0x80000000, 5);
    buf.writeUInt32BE(50, 9);
    buf[13] = 2; buf[14] = 3; buf[15] = 0; buf[16] = 0;
    buf.writeUInt32BE(0xFFFFFFFF, 17);
    buf.writeUInt32BE(0xFFFFFFFF, 21);
    return buf;
}

function stm32Crc32(data) {
    const padLen = Math.ceil(data.length / 4) * 4;
    const padded = Buffer.alloc(padLen);
    if (data.copy) data.copy(padded); else padded.set(data);
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < padLen; i += 4) {
        crc = (crc ^ padded.readUInt32LE(i)) >>> 0;
        for (let j = 0; j < 32; j++) {
            if (crc & 0x80000000) {
                crc = ((crc << 1) ^ 0x04C11DB7) >>> 0;
            } else {
                crc = (crc << 1) >>> 0;
            }
        }
    }
    return crc >>> 0;
}

// ================================================================
// TCP transport
// ================================================================
let socket;
let responseBuffer = Buffer.alloc(0);
let pendingMessages = [];
let phoneVersionSent = false;

function sendRaw(data) {
    socket.write(data);
}

function sendPebbleMessage(endpoint, data) {
    if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) data = Buffer.from(data);
    const pp = buildPebbleProtocol(endpoint, data);
    const frame = buildQemuPacket(1, pp);
    log('[TX] endpoint=0x' + endpoint.toString(16) + ' len=' + data.length +
        ' frame=' + hexdump(frame, 32));
    sendRaw(frame);
}

function processData(chunk) {
    responseBuffer = Buffer.concat([responseBuffer, chunk]);

    while (responseBuffer.length >= 8) {
        if (responseBuffer.readUInt16BE(0) !== 0xFEED) {
            log('[RX] skipping non-FEED byte: 0x' + responseBuffer[0].toString(16).padStart(2, '0'));
            responseBuffer = responseBuffer.slice(2);
            continue;
        }
        const proto = responseBuffer.readUInt16BE(2);
        const dataLen = responseBuffer.readUInt16BE(4);
        const totalSize = 6 + dataLen + 2;
        if (responseBuffer.length < totalSize) break;

        if (responseBuffer.readUInt16BE(6 + dataLen) !== 0xBEEF) {
            log('[RX] bad footer at offset ' + (6 + dataLen));
            responseBuffer = responseBuffer.slice(2);
            continue;
        }

        const data = responseBuffer.slice(6, 6 + dataLen);
        responseBuffer = responseBuffer.slice(totalSize);

        log('[RX frame] proto=' + proto + ' len=' + dataLen + ' data=' + hexdump(data, 48));

        if (proto === 1 && data.length >= 4) {
            let ppOff = 0;
            while (ppOff + 4 <= data.length) {
                const ppLen = data.readUInt16BE(ppOff);
                const ppEndpoint = data.readUInt16BE(ppOff + 2);
                if (ppOff + 4 + ppLen > data.length) break;
                const ppPayload = data.slice(ppOff + 4, ppOff + 4 + ppLen);
                ppOff += 4 + ppLen;
                log('[RX PP] endpoint=0x' + ppEndpoint.toString(16) +
                    ' ppLen=' + ppLen + ' payload=' + hexdump(ppPayload, 32));

                if (ppEndpoint === 0x11 && ppPayload.length >= 1 &&
                    ppPayload[0] === 0x00 && !phoneVersionSent) {
                    phoneVersionSent = true;
                    log('[serial] PhoneVersionRequest received, sending response');
                    sendPebbleMessage(0x11, buildPhoneVersionResponse());
                    continue;
                }

                if (ppEndpoint === 0x07d1 && ppPayload.length >= 5 &&
                    ppPayload[0] === 0x00) {
                    const pong = Buffer.alloc(5);
                    pong[0] = 0x01;
                    ppPayload.copy(pong, 1, 1, 5);
                    log('[serial] Ping received, sending Pong');
                    sendPebbleMessage(0x07d1, pong);
                    continue;
                }

                pendingMessages.push({ endpoint: ppEndpoint, data: ppPayload });
            }
        }
    }
}

async function waitForResponse(endpoint, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (let i = 0; i < pendingMessages.length; i++) {
            if (pendingMessages[i].endpoint === endpoint) {
                return pendingMessages.splice(i, 1)[0].data;
            }
        }
        await new Promise(r => setTimeout(r, 50));
    }
    log('[RX] pending messages at timeout: ' + pendingMessages.length);
    for (const m of pendingMessages) {
        log('[RX]   pending: endpoint=0x' + m.endpoint.toString(16) +
            ' data=' + hexdump(m.data, 32));
    }
    throw new Error('Timeout waiting for endpoint 0x' + endpoint.toString(16));
}

// ================================================================
// PBW Parser (identical logic to test-install.html)
// ================================================================
async function parsePBW(data) {
    const zip = await JSZip.loadAsync(data);
    log('[pbw] Files in PBW: ' + Object.keys(zip.files).join(', '));

    const prefixes = ['emery/', 'basalt/', ''];
    let manifest = null, prefix = '';
    for (const p of prefixes) {
        const mf = zip.file(p + 'manifest.json');
        if (mf) {
            manifest = JSON.parse(await mf.async('string'));
            prefix = p;
            break;
        }
    }
    if (!manifest) throw new Error('No manifest.json');
    log('[pbw] Using prefix: "' + prefix + '"');
    log('[pbw] Manifest: ' + JSON.stringify(manifest, null, 2));

    const appInfo = manifest.application || manifest.firmware;
    const appBinPath = prefix + (appInfo.name || 'pebble-app.bin');
    const appBinary = Buffer.from(await zip.file(appBinPath).async('uint8array'));

    const uuid = appBinary.slice(104, 120);
    let name = '';
    for (let i = 24; i < 56 && appBinary[i] !== 0; i++) name += String.fromCharCode(appBinary[i]);

    log('[pbw] Name: "' + name + '"');
    log('[pbw] UUID bytes: ' + hexdump(uuid, 16));
    log('[pbw] Flags: 0x' + appBinary.readUInt32LE(96).toString(16));
    log('[pbw] Icon: ' + appBinary.readUInt32LE(88));

    const result = {
        uuid, name,
        flags: appBinary.readUInt32LE(96),
        icon: appBinary.readUInt32LE(88),
        appVersionMajor: appBinary[12],
        appVersionMinor: appBinary[13],
        sdkVersionMajor: appBinary[10],
        sdkVersionMinor: appBinary[11],
        binary: appBinary, resources: null, worker: null,
    };

    if (manifest.resources) {
        const resFile = zip.file(prefix + manifest.resources.name);
        if (resFile) result.resources = Buffer.from(await resFile.async('uint8array'));
    }
    if (manifest.worker) {
        const wkFile = zip.file(prefix + manifest.worker.name);
        if (wkFile) result.worker = Buffer.from(await wkFile.async('uint8array'));
    }

    return result;
}

// ================================================================
// Install flow (identical logic to test-install.html)
// ================================================================
function buildAppMetadata(info) {
    const meta = Buffer.alloc(126);
    info.uuid.copy(meta, 0);
    meta.writeUInt32LE(info.flags, 16);
    meta.writeUInt32LE(info.icon, 20);
    meta[24] = info.appVersionMajor;
    meta[25] = info.appVersionMinor;
    meta[26] = info.sdkVersionMajor;
    meta[27] = info.sdkVersionMinor;
    for (let i = 0; i < Math.min(info.name.length, 95); i++) {
        meta[30 + i] = info.name.charCodeAt(i);
    }
    return meta;
}

function buildBlobDBInsert(token, uuid, value) {
    const buf = Buffer.alloc(23 + value.length);
    buf[0] = 0x01;
    buf.writeUInt16LE(token, 1);
    buf[3] = 0x02;
    buf[4] = 16;
    uuid.copy(buf, 5);
    buf.writeUInt16LE(value.length, 21);
    value.copy(buf, 23);
    return buf;
}

async function putBytesTransfer(data, objectType, appId, label) {
    log('[putbytes] ' + label + ': ' + data.length + ' bytes, type=0x' +
        objectType.toString(16) + ', appId=' + appId);

    const initBuf = Buffer.alloc(10);
    initBuf[0] = 0x01;
    initBuf.writeUInt32BE(data.length, 1);
    initBuf[5] = objectType;
    initBuf.writeUInt32BE(appId, 6);
    sendPebbleMessage(0xBEEF, initBuf);

    const initResp = await waitForResponse(0xBEEF, 15000);
    if (initResp[0] !== 0x01) throw new Error('PutBytes init NACK: ' + initResp[0]);
    const cookie = initResp.readUInt32BE(1);
    log('[putbytes] cookie=' + cookie);

    const CHUNK = 2000;
    let sent = 0;
    while (sent < data.length) {
        const len = Math.min(CHUNK, data.length - sent);
        const putBuf = Buffer.alloc(9 + len);
        putBuf[0] = 0x02;
        putBuf.writeUInt32BE(cookie, 1);
        putBuf.writeUInt32BE(len, 5);
        data.copy(putBuf, 9, sent, sent + len);
        sendPebbleMessage(0xBEEF, putBuf);

        const putResp = await waitForResponse(0xBEEF, 15000);
        if (putResp[0] !== 0x01) throw new Error('PutBytes put NACK at ' + sent);
        sent += len;
        log('[putbytes] ' + label + ': ' + sent + '/' + data.length);
    }

    const crc = stm32Crc32(data);
    const commitBuf = Buffer.alloc(9);
    commitBuf[0] = 0x03;
    commitBuf.writeUInt32BE(cookie, 1);
    commitBuf.writeUInt32BE(crc, 5);
    sendPebbleMessage(0xBEEF, commitBuf);
    const commitResp = await waitForResponse(0xBEEF, 15000);
    if (commitResp[0] !== 0x01) throw new Error('PutBytes commit NACK');
    log('[putbytes] ' + label + ' committed CRC=0x' + crc.toString(16));

    const installBuf = Buffer.alloc(5);
    installBuf[0] = 0x05;
    installBuf.writeUInt32BE(cookie, 1);
    sendPebbleMessage(0xBEEF, installBuf);
    const installResp = await waitForResponse(0xBEEF, 15000);
    if (installResp[0] !== 0x01) throw new Error('PutBytes install NACK');
    log('[putbytes] ' + label + ' installed');
}

// ================================================================
// Main
// ================================================================
async function main() {
    log('Loading PBW: ' + PBW_PATH);
    const pbwData = fs.readFileSync(PBW_PATH);
    log('PBW size: ' + pbwData.length);

    const pbw = await parsePBW(pbwData);
    const uuidHex = Array.from(pbw.uuid).map(b => b.toString(16).padStart(2, '0')).join('');
    log('[install] App: "' + pbw.name + '" UUID=' + uuidHex);
    log('[install] Binary: ' + pbw.binary.length +
        (pbw.resources ? ', Resources: ' + pbw.resources.length : '') +
        (pbw.worker ? ', Worker: ' + pbw.worker.length : ''));

    log('Connecting to ' + HOST + ':' + PORT + '...');
    socket = net.createConnection({ host: HOST, port: PORT });

    await new Promise((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('error', reject);
    });
    log('Connected!');

    socket.on('data', chunk => processData(chunk));

    // Send PhoneVersionResponse proactively (firmware sent PhoneVersionRequest
    // during boot before we connected — the request was lost, but we still need
    // to tell firmware a phone is connected)
    log('Sending PhoneVersionResponse proactively...');
    sendPebbleMessage(0x11, buildPhoneVersionResponse());
    phoneVersionSent = true;

    // Wait for any unsolicited messages
    await new Promise(r => setTimeout(r, 3000));

    // Send WatchVersionRequest
    log('[main] Sending WatchVersionRequest...');
    sendPebbleMessage(0x10, Buffer.from([0x00]));
    try {
        const watchVer = await waitForResponse(0x10, 10000);
        log('[main] WatchVersionResponse: ' + watchVer.length + ' bytes');
    } catch(e) {
        log('[main] WatchVersionResponse timeout (continuing anyway)');
    }

    await new Promise(r => setTimeout(r, 1000));

    // 1. BlobDB Insert
    log('[install] === Step 1: BlobDB Insert ===');
    const token = (Math.random() * 65534 + 1) | 0;
    const metadata = buildAppMetadata(pbw);
    log('[install] Metadata (' + metadata.length + ' bytes): ' + hexdump(metadata, 48));
    const blobCmd = buildBlobDBInsert(token, pbw.uuid, metadata);
    log('[install] BlobDB cmd (' + blobCmd.length + ' bytes): ' + hexdump(blobCmd, 48));
    sendPebbleMessage(0xb1db, blobCmd);

    const blobResp = await waitForResponse(0xb1db, 10000);
    log('[install] BlobDB response: ' + hexdump(blobResp, 16));
    if (blobResp[2] !== 0x01) throw new Error('BlobDB insert failed: ' + blobResp[2]);
    log('[install] BlobDB OK');

    await new Promise(r => setTimeout(r, 1000));

    // 2. AppRunState Start
    log('[install] === Step 2: AppRunState Start ===');
    const runCmd = Buffer.alloc(17);
    runCmd[0] = 0x01;
    pbw.uuid.copy(runCmd, 1);
    sendPebbleMessage(0x34, runCmd);

    // 3. Wait for AppFetchRequest
    log('[install] === Step 3: Waiting for AppFetchRequest (0x1771) ===');
    const fetchReq = await waitForResponse(0x1771, 60000);
    const appId = fetchReq.readUInt32LE(17);
    log('[install] AppFetchRequest! app_id=' + appId);

    // 4. AppFetchResponse
    log('[install] === Step 4: AppFetchResponse ===');
    sendPebbleMessage(0x1771, Buffer.from([0x01, 0x01]));

    // Wait for firmware to process AppFetchResponse
    await new Promise(r => setTimeout(r, 500));

    // 5. PutBytes
    log('[install] === Step 5: PutBytes binary ===');
    await putBytesTransfer(pbw.binary, 0x85, appId, 'binary');
    if (pbw.resources) {
        log('[install] === Step 6: PutBytes resources ===');
        await putBytesTransfer(pbw.resources, 0x84, appId, 'resources');
    }
    if (pbw.worker) {
        log('[install] === Step 7: PutBytes worker ===');
        await putBytesTransfer(pbw.worker, 0x87, appId, 'worker');
    }

    log('[install] === INSTALL COMPLETE ===');
    socket.destroy();
    process.exit(0);
}

main().catch(e => {
    console.error('Fatal:', e.message);
    process.exit(1);
});
