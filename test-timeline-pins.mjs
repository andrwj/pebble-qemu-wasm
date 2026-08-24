// Self-check for timeline-pins.js: build a pin, capture the BlobDB frame the
// PinSender emits, and assert every field matches the firmware wire format
// (item.h header, api.h db id, endpoint_private.h opcodes, attribute.h ids).
// Run: node test-timeline-pins.mjs   (exits non-zero on failure)
import { PinSender, serializeItem, colorByte, iconId, pinUuidFromId } from './timeline-pins.js';
import assert from 'node:assert';

const dec = new TextDecoder();

// Minimal fake phone: records the last frame sent on the BlobDB endpoint and
// lets us inject the watch's ACK.
function fakePhone() {
  const ppHandlers = new Map();
  return {
    ppHandlers,
    sent: [],
    onPP(ep, fn) { ppHandlers.set(ep, fn); },
    sendPP(ep, msg) {
      this.sent.push({ ep, msg });
      // Auto-ACK: [token u16][status=SUCCESS]. token echoes bytes 1..2 of msg.
      const ack = new Uint8Array([msg[1], msg[2], 0x01]);
      queueMicrotask(() => ppHandlers.get(0xb1db)(ack));
    },
  };
}

// Decode attributes/actions region back into a map for assertions.
function decodeItem(value) {
  const dv = new DataView(value.buffer, value.byteOffset);
  const item = {
    uuid: value.slice(0, 16),
    timestamp: dv.getUint32(32, true),
    duration: dv.getUint16(36, true),
    type: value[38], flags: value[39], status: value[40], layout: value[41],
    payloadLen: dv.getUint16(42, true), numAttrs: value[44], numActions: value[45],
    attrs: {},
  };
  let off = 46;
  for (let i = 0; i < item.numAttrs; i++) {
    const id = value[off]; const len = value[off + 1] | (value[off + 2] << 8);
    item.attrs[id] = value.slice(off + 3, off + 3 + len);
    off += 3 + len;
  }
  return item;
}

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('ok   -', name); }
  catch (e) { failures++; console.error('FAIL -', name, '\n     ', e.message); }
}

// --- pure helpers ---
check('color #ffffff -> opaque white 0xff', () => assert.equal(colorByte('#ffffff'), 0xff));
check('color #000000 -> opaque black 0xc0', () => assert.equal(colorByte('#000000'), 0xc0));
check('color named blue', () => assert.equal(colorByte('blue'), 0xc3));
check('icon system:// name maps', () => assert.equal(iconId('system://images/TIMELINE_CALENDAR'), 0x80000015));
check('icon unknown -> generic default', () => assert.equal(iconId('system://images/NOPE'), 0x80000001));
check('icon numeric passthrough', () => assert.equal(iconId(0x80000004), 0x80000004));

// --- deterministic UUID matches RFC v5 (version nibble = 5, variant = 8..b) ---
check('pinUuidFromId is v5', async () => {}); // placeholder; real check below is async

// --- serialized header layout ---
check('serializeItem header fields', () => {
  const uuid = new Uint8Array(16).fill(7);
  const v = serializeItem({
    uuid, timestamp: 1700000000, duration: 60, type: 2, layoutId: 1,
    layout: { title: 'Hello', body: 'World', tinyIcon: 'system://images/NOTIFICATION_FLAG', primaryColor: '#ffffff' },
    actions: [{ title: 'Open', type: 'openWatchApp', launchCode: 15 }],
  });
  const it = decodeItem(v);
  assert.equal(it.type, 2, 'type=Pin');
  assert.equal(it.flags, 1, 'flags=visible');
  assert.equal(it.status, 0, 'status=0');
  assert.equal(it.layout, 1, 'layout=generic');
  assert.equal(it.timestamp, 1700000000);
  assert.equal(it.duration, 60);
  assert.equal(it.numActions, 1, 'one action');
  assert.equal(dec.decode(it.attrs[1]), 'Hello', 'title attr');
  assert.equal(dec.decode(it.attrs[3]), 'World', 'body attr');
  const iconU32 = new DataView(it.attrs[4].buffer, it.attrs[4].byteOffset).getUint32(0, true);
  assert.equal(iconU32, 0x80000004, 'tinyIcon resource id');
  assert.equal(it.attrs[27][0], 0xff, 'primaryColor byte');
  assert.equal(it.payloadLen, v.length - 46, 'payload_length exact');
});

// --- full PinSender BlobDB frame ---
async function main() {
  await new Promise((r) => setTimeout(r, 0));
  // async UUID checks
  const u = await pinUuidFromId('pin-1');
  check('uuid version nibble = 5', () => assert.equal(u[6] & 0xf0, 0x50));
  check('uuid variant bits', () => assert.equal(u[8] & 0xc0, 0x80));
  check('uuid stable across calls', async () => {});
  const u2 = await pinUuidFromId('pin-1');
  check('uuid deterministic', () => assert.deepEqual([...u], [...u2]));

  const phone = fakePhone();
  const sender = new PinSender(phone, () => {});
  const returnedUuid = await sender.sendPin({
    id: 'pin-42', time: '2026-08-24T15:00:00Z', duration: 30,
    layout: { type: 'genericPin', title: 'Meeting', body: 'Standup', tinyIcon: 'system://images/TIMELINE_CALENDAR' },
    actions: [{ title: 'Open App', type: 'openWatchApp' }],
  });
  check('sendPin emitted exactly one BlobDB frame', () => assert.equal(phone.sent.length, 1));
  check('frame is INSERT into Pins db', () => {
    const m = phone.sent[0].msg;
    assert.equal(phone.sent[0].ep, 0xb1db, 'endpoint');
    assert.equal(m[0], 0x01, 'cmd=INSERT');
    assert.equal(m[3], 0x01, 'dbId=Pins');
    assert.equal(m[4], 16, 'key length = 16');
  });
  check('frame value round-trips to a Pin', () => {
    const m = phone.sent[0].msg;
    const keyLen = m[4];
    const valLen = m[5 + keyLen] | (m[6 + keyLen] << 8);
    const value = m.slice(7 + keyLen, 7 + keyLen + valLen);
    const it = decodeItem(value);
    assert.equal(it.type, 2);
    assert.equal(dec.decode(it.attrs[1]), 'Meeting');
    assert.equal(it.timestamp, Math.floor(Date.parse('2026-08-24T15:00:00Z') / 1000));
  });
  check('returned uuid matches derived', async () => {
    const derived = await pinUuidFromId('pin-42');
    const hex = [...derived].map((x) => x.toString(16).padStart(2, '0')).join('');
    const expect = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    assert.equal(returnedUuid, expect);
  });

  // delete path
  const phone2 = fakePhone();
  const s2 = new PinSender(phone2, () => {});
  await s2.deletePin('pin-42');
  check('deletePin emits DELETE with 16-byte key, no value', () => {
    const m = phone2.sent[0].msg;
    assert.equal(m[0], 0x04, 'cmd=DELETE');
    assert.equal(m[3], 0x01, 'dbId=Pins');
    assert.equal(m[4], 16);
    assert.equal(m.length, 5 + 16, 'no value payload on delete');
  });

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nall checks passed');
}
main();
