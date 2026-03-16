# Commodore 64 File Structural Validation Specification

## Purpose

This document defines **fast structural validation rules** for several common Commodore‑64 related file formats:

- D64
- D71
- D81
- PRG
- SID
- MOD
- CRT

The goal is **structural plausibility validation** only.

The validation rules must:

- operate on a **byte array representing the file**
- rely only on **numeric offsets and lengths defined in this
  document**
- avoid external domain knowledge
- be deterministic and fast
- terminate immediately on failure

The implementation environment may assume:

    file = byte array
    size = length of file in bytes

All validation rules below refer only to:

- `size`
- `file[offset]`
- contiguous byte ranges

No other knowledge is required.

---

# Common Definitions

## Byte Access

    file[n]

means the byte at offset `n` (0‑based).

Example:

    file[0] = first byte
    file[1] = second byte

---

## Multi‑Byte Integers

### Little‑Endian 16‑bit

    LE16(offset) =
        file[offset] +
        256 * file[offset+1]

### Big‑Endian 16‑bit

    BE16(offset) =
        256 * file[offset] +
        file[offset+1]

### Big‑Endian 32‑bit

    BE32(offset) =
        file[offset]*16777216 +
        file[offset+1]*65536 +
        file[offset+2]*256 +
        file[offset+3]

---

## Bounds Rule

Any rule that reads bytes must verify:

    offset + required_bytes <= size

Otherwise return:

    INVALID_OUT_OF_BOUNDS

---

# D64 Validation

D64 files represent a disk image where the file is composed of fixed
size blocks.

Each block is **256 bytes**.

### Step 1 --- Validate File Size

Valid sizes:

    174848
    175531
    196608
    197376

If `size` is not one of these values →

    INVALID_SIZE

---

### Step 2 --- Validate Block Count

    block_size = 256
    block_count = size / block_size

Block count must be one of:

    683
    685
    768
    771

Otherwise:

    INVALID_BLOCK_COUNT

---

### Step 3 --- Validate Directory Block Structure

Directory blocks begin at block index:

    dir_block = 18 * 256

Ensure:

    dir_block + 256 <= size

Otherwise:

    INVALID_DIRECTORY_LOCATION

Inside this block:

    file[dir_block + 0] = next block pointer byte 1
    file[dir_block + 1] = next block pointer byte 2

These two bytes may be any value but must exist.

---

### Step 4 --- Directory Entry Structure

Each directory block contains **8 entries**.

Each entry is **32 bytes**.

Entry offsets:

    entry_offset = dir_block + 2 + (entry_index * 32)

for `entry_index = 0..7`.

Each entry must satisfy:

    entry_offset + 32 <= size

Otherwise:

    INVALID_DIRECTORY_ENTRY

---

# D71 Validation

### Step 1 --- Validate File Size

Allowed sizes:

    349696
    351062

Otherwise:

    INVALID_SIZE

---

### Step 2 --- Validate Block Size

Block size:

    256 bytes

Block count:

    block_count = size / 256

Must equal:

    1366

or

    1371

Otherwise:

    INVALID_BLOCK_COUNT

---

### Step 3 --- Directory Block

Directory block location:

    dir_block = 18 * 256

Verify:

    dir_block + 256 <= size

Otherwise:

    INVALID_DIRECTORY_LOCATION

---

# D81 Validation

### Step 1 --- Validate File Size

Allowed sizes:

    819200
    822400

Otherwise:

    INVALID_SIZE

---

### Step 2 --- Block Geometry

    block_size = 256
    block_count = size / block_size

Expected:

    3200
    3210

Otherwise:

    INVALID_BLOCK_COUNT

---

### Step 3 --- Header Block

Header block offset:

    header_offset = 40 * 40 * 256

Verify:

    header_offset + 256 <= size

Otherwise:

    INVALID_HEADER_LOCATION

---

# PRG Validation

PRG files are raw binary programs.

### Step 1 --- Minimum Size

    size >= 2

Otherwise:

    INVALID_SIZE

---

### Step 2 --- Load Address

    load_address = LE16(0)

Must satisfy:

    0 <= load_address <= 65535

Always true if bytes exist.

---

### Step 3 --- Program Data

    program_length = size - 2

Must satisfy:

    program_length >= 1

Otherwise:

    INVALID_PROGRAM_DATA

---

# SID Validation

### Step 1 --- Minimum Size

    size >= 0x76

Otherwise:

    INVALID_SIZE

---

### Step 2 --- Magic Identifier

Bytes:

    file[0..3]

Must equal ASCII:

    PSID

or

    RSID

Otherwise:

    INVALID_MAGIC

---

### Step 3 --- Version

    version = BE16(4)

Allowed values:

    1
    2
    3
    4

Otherwise:

    INVALID_VERSION

---

### Step 4 --- Data Offset

    data_offset = BE16(6)

Must satisfy:

    data_offset < size

This means the data offset must point to at least one byte inside the file.
An exact 0x76-byte header with data_offset = 0x76 is still invalid because it
contains no program data after the header.

Otherwise:

    INVALID_DATA_OFFSET

---

### Step 5 --- Song Counts

    songs = BE16(14)
    start_song = BE16(16)

Must satisfy:

    songs >= 1
    start_song >= 1
    start_song <= songs

Otherwise:

    INVALID_SONG_RANGE

---

# MOD Validation

### Step 1 --- Minimum Size

    size >= 1084

Otherwise:

    INVALID_SIZE

---

### Step 2 --- Signature

Signature location:

    sig_offset = 1080

Signature is 4 ASCII bytes.

Allowed values:

    M.K.
    M!K!
    M&K!
    FLT8
    OCTA
    OKTA

If signature does not match any allowed value:

assume legacy format but continue validation.

---

### Step 3 --- Pattern Table

Pattern table location:

    952..1079

Length:

    128 bytes

Find:

    max_pattern = maximum byte value in table

Must satisfy:

    max_pattern <= 127

Otherwise:

    INVALID_PATTERN_TABLE

---

# CRT Validation

### Step 1 --- Minimum Size

    size >= 64

Otherwise:

    INVALID_SIZE

---

### Step 2 --- Magic String

Bytes:

    file[0..15]

Must equal ASCII:

    C64 CARTRIDGE

followed by spaces until byte 15.

Otherwise:

    INVALID_MAGIC

---

### Step 3 --- Header Length

    header_len = BE32(16)

Must equal:

    64

Otherwise:

    INVALID_HEADER_LENGTH

---

### Step 4 --- Version

    version = BE16(20)

Allowed:

    0x0100
    0x0101
    0x0200

Otherwise:

    INVALID_VERSION

---

### Step 5 --- CHIP Packet Validation

Starting at:

    offset = 64

Loop until `offset >= size`.

Each packet must start with ASCII:

    CHIP

If not →

    INVALID_CHIP_HEADER

Packet length:

    packet_len = BE32(offset + 4)

Must satisfy:

    packet_len >= 16
    offset + packet_len <= size

Otherwise:

    INVALID_CHIP_PACKET

Advance:

    offset += packet_len

---

# Validation Result

Each validator must return exactly one of:

    VALID
    INVALID_SIZE
    INVALID_BLOCK_COUNT
    INVALID_DIRECTORY_LOCATION
    INVALID_DIRECTORY_ENTRY
    INVALID_HEADER_LOCATION
    INVALID_MAGIC
    INVALID_VERSION
    INVALID_DATA_OFFSET
    INVALID_PATTERN_TABLE
    INVALID_CHIP_PACKET
    INVALID_OUT_OF_BOUNDS
