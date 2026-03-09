#!/usr/bin/env node
/**
 * Test script that mimics the TypeScript RAM operations exactly.
 * This helps identify if there's a bug in the TypeScript implementation.
 */

const BASE_URL = 'http://c64u';
const FULL_RAM_SIZE = 0x10000;
const READ_CHUNK_SIZE = 0x1000;

async function pause() {
    const response = await fetch(`${BASE_URL}/v1/machine:pause`, { method: 'PUT' });
    if (!response.ok) throw new Error(`Pause failed: ${response.status}`);
    console.log('[1] Paused C64');
}

async function resume() {
    const response = await fetch(`${BASE_URL}/v1/machine:resume`, { method: 'PUT' });
    if (!response.ok) throw new Error(`Resume failed: ${response.status}`);
    console.log('[2] Resumed C64');
}

function toHexAddress(value) {
    return value.toString(16).toUpperCase().padStart(4, '0');
}

async function readMemory(address, length) {
    const addrHex = toHexAddress(address);
    const url = `${BASE_URL}/v1/machine:readmem?address=${addrHex}&length=${length}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Read failed: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
}

async function writeMemoryBlock(address, data) {
    const addrHex = toHexAddress(address);
    const url = `${BASE_URL}/v1/machine:writemem?address=${addrHex}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: data.buffer,
    });
    if (!response.ok) throw new Error(`Write failed: ${response.status}`);
    console.log(`[3] Wrote ${data.length} bytes to $${addrHex}`);
}

async function dumpFullRamImage() {
    console.log('[4] Reading full RAM...');
    const image = new Uint8Array(FULL_RAM_SIZE);
    for (let address = 0; address < FULL_RAM_SIZE; address += READ_CHUNK_SIZE) {
        const chunkSize = Math.min(READ_CHUNK_SIZE, FULL_RAM_SIZE - address);
        const chunk = await readMemory(address, chunkSize);
        if (chunk.length !== chunkSize) {
            throw new Error(`Unexpected chunk length at $${toHexAddress(address)}: expected ${chunkSize}, got ${chunk.length}`);
        }
        image.set(chunk, address);
    }
    console.log(`[4] Read ${image.length} bytes`);
    return image;
}

async function loadFullRamImage(image) {
    console.log(`[5] Writing full RAM (${image.length} bytes)...`);
    await writeMemoryBlock(0, image);
}

async function main() {
    console.log('=== TypeScript-style RAM Operations Test ===\n');

    const SCREEN_BUFFER = 1024; // $0400
    const testString = new Uint8Array([0x54, 0x45, 0x53, 0x54]); // "TEST"
    const overwriteString = new Uint8Array([0x58, 0x58, 0x58, 0x58]); // "XXXX"

    // Step 1: Write test string to screen buffer
    await pause();
    await writeMemoryBlock(SCREEN_BUFFER, testString);

    // Verify write
    let screenData = await readMemory(SCREEN_BUFFER, 4);
    console.log(`[6] Screen buffer after write: ${Array.from(screenData).map(b => b.toString(16).padStart(2, '0')).join('')} (expected: 54455354)`);
    if (screenData.length !== 4 || screenData[0] !== 0x54 || screenData[1] !== 0x45 || screenData[2] !== 0x53 || screenData[3] !== 0x54) {
        console.log('ERROR: Initial write failed!');
        await resume();
        process.exit(1);
    }
    console.log('[6] Initial write verified OK');
    await resume();

    // Step 2: Save full RAM
    await pause();
    const ramSnapshot = await dumpFullRamImage();
    await resume();

    // Verify snapshot contains our test string
    const snapshotScreen = ramSnapshot.slice(SCREEN_BUFFER, SCREEN_BUFFER + 4);
    console.log(`[7] Snapshot screen buffer: ${Array.from(snapshotScreen).map(b => b.toString(16).padStart(2, '0')).join('')} (expected: 54455354)`);
    if (snapshotScreen[0] !== 0x54 || snapshotScreen[1] !== 0x45 || snapshotScreen[2] !== 0x53 || snapshotScreen[3] !== 0x54) {
        console.log('ERROR: Snapshot doesn\'t contain test string!');
        process.exit(1);
    }
    console.log('[7] Snapshot verified OK');

    // Step 3: Overwrite the test string
    await pause();
    await writeMemoryBlock(SCREEN_BUFFER, overwriteString);
    screenData = await readMemory(SCREEN_BUFFER, 4);
    console.log(`[8] Screen buffer after overwrite: ${Array.from(screenData).map(b => b.toString(16).padStart(2, '0')).join('')} (expected: 58585858)`);
    if (screenData[0] !== 0x58 || screenData[1] !== 0x58 || screenData[2] !== 0x58 || screenData[3] !== 0x58) {
        console.log('ERROR: Overwrite failed!');
        await resume();
        process.exit(1);
    }
    console.log('[8] Overwrite verified OK');
    await resume();

    // Step 4: Restore RAM snapshot
    await pause();
    await loadFullRamImage(ramSnapshot);
    await resume();

    // Step 5: Verify restoration
    await pause();
    const restoredScreen = await readMemory(SCREEN_BUFFER, 4);
    console.log(`[9] Screen buffer after restore: ${Array.from(restoredScreen).map(b => b.toString(16).padStart(2, '0')).join('')} (expected: 54455354)`);
    if (restoredScreen[0] !== 0x54 || restoredScreen[1] !== 0x45 || restoredScreen[2] !== 0x53 || restoredScreen[3] !== 0x54) {
        console.log('ERROR: Restore failed! Screen buffer doesn\'t match original!');
        await resume();
        process.exit(1);
    }
    console.log('[9] Restore verified OK - original string is back!');
    await resume();

    console.log('\n=== ALL TESTS PASSED ===');
}

main().catch(err => {
    console.error('ERROR:', err);
    process.exit(1);
});
