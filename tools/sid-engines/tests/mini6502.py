"""A 6502 interpreter for the handful of opcodes the probe tunes use, so their register writes can be
checked without an emulator. Unknown opcodes raise, so a tune that grows a new instruction fails
loudly here rather than being half-simulated."""

from __future__ import annotations


class Halt(Exception):
    pass


class Cpu:
    def __init__(self, memory: bytearray) -> None:
        self.mem = memory
        self.a = self.x = self.y = 0
        self.sp = 0xFF
        self.pc = 0
        self.z = self.c = self.n = False
        self.writes: list[tuple[int, int]] = []

    def read(self, address: int) -> int:
        return self.mem[address & 0xFFFF]

    def write(self, address: int, value: int) -> None:
        address &= 0xFFFF
        self.mem[address] = value & 0xFF
        if 0xD400 <= address < 0xD800 or 0xDC00 <= address < 0xDE00 or 0xD000 <= address < 0xD400:
            self.writes.append((address, value & 0xFF))

    def word(self, address: int) -> int:
        return self.read(address) | (self.read(address + 1) << 8)

    def push(self, value: int) -> None:
        self.mem[0x100 + self.sp] = value & 0xFF
        self.sp = (self.sp - 1) & 0xFF

    def pull(self) -> int:
        self.sp = (self.sp + 1) & 0xFF
        return self.mem[0x100 + self.sp]

    def flags(self, value: int) -> int:
        value &= 0xFF
        self.z, self.n = value == 0, bool(value & 0x80)
        return value

    def call(self, address: int, a: int = 0, limit: int = 100_000) -> None:
        """JSR to `address` and run until it returns."""
        self.a = a
        self.push(0xFF)
        self.push(0xFE)  # returns to $FFFF, which stops the run
        self.pc = address
        self.run_until(lambda: self.pc == 0xFFFF, limit)

    def run_until(self, done, limit: int = 100_000) -> None:
        for _ in range(limit):
            if done():
                return
            self.step()
        raise Halt(f"did not finish within {limit} instructions, pc=${self.pc:04X}")

    def step(self) -> None:
        op = self.read(self.pc)
        b1, b2 = self.read(self.pc + 1), self.read(self.pc + 2)
        absolute = b1 | (b2 << 8)
        pc = self.pc
        if op == 0xA9: self.a = self.flags(b1); self.pc += 2
        elif op == 0xA2: self.x = self.flags(b1); self.pc += 2
        elif op == 0xA0: self.y = self.flags(b1); self.pc += 2
        elif op == 0xA5: self.a = self.flags(self.read(b1)); self.pc += 2
        elif op == 0xA6: self.x = self.flags(self.read(b1)); self.pc += 2
        elif op == 0xA4: self.y = self.flags(self.read(b1)); self.pc += 2
        elif op == 0xAD: self.a = self.flags(self.read(absolute)); self.pc += 3
        elif op == 0xAE: self.x = self.flags(self.read(absolute)); self.pc += 3
        elif op == 0xBD: self.a = self.flags(self.read(absolute + self.x)); self.pc += 3
        elif op == 0xB1: self.a = self.flags(self.read(self.word(b1) + self.y)); self.pc += 2
        elif op == 0x85: self.write(b1, self.a); self.pc += 2
        elif op == 0x86: self.write(b1, self.x); self.pc += 2
        elif op == 0x84: self.write(b1, self.y); self.pc += 2
        elif op == 0x8D: self.write(absolute, self.a); self.pc += 3
        elif op == 0x8E: self.write(absolute, self.x); self.pc += 3
        elif op == 0x91: self.write(self.word(b1) + self.y, self.a); self.pc += 2
        elif op == 0xAA: self.x = self.flags(self.a); self.pc += 1
        elif op == 0xA8: self.y = self.flags(self.a); self.pc += 1
        elif op == 0x8A: self.a = self.flags(self.x); self.pc += 1
        elif op == 0x98: self.a = self.flags(self.y); self.pc += 1
        elif op == 0xE8: self.x = self.flags(self.x + 1); self.pc += 1
        elif op == 0xC8: self.y = self.flags(self.y + 1); self.pc += 1
        elif op == 0xCA: self.x = self.flags(self.x - 1); self.pc += 1
        elif op == 0xE6: self.write(b1, self.flags(self.read(b1) + 1)); self.pc += 2
        elif op == 0xC6: self.write(b1, self.flags(self.read(b1) - 1)); self.pc += 2
        elif op == 0x18: self.c = False; self.pc += 1
        elif op == 0x65:
            total = self.a + self.read(b1) + int(self.c)
            self.c = total > 0xFF
            self.a = self.flags(total)
            self.pc += 2
        elif op == 0xE0:
            self.c = self.x >= b1
            self.flags(self.x - b1)
            self.pc += 2
        elif op in (0xD0, 0xF0, 0x90, 0xB0):
            taken = {0xD0: not self.z, 0xF0: self.z, 0x90: not self.c, 0xB0: self.c}[op]
            self.pc += 2
            if taken:
                self.pc = (self.pc + (b1 - 256 if b1 & 0x80 else b1)) & 0xFFFF
        elif op == 0x4C: self.pc = absolute
        elif op == 0x20:
            ret = self.pc + 2
            self.push(ret >> 8)
            self.push(ret & 0xFF)
            self.pc = absolute
        elif op == 0x60:
            low = self.pull()
            self.pc = ((self.pull() << 8) | low) + 1
        elif op == 0x40:
            self.pull()  # status
            low = self.pull()
            self.pc = (self.pull() << 8) | low
        elif op == 0x48: self.push(self.a); self.pc += 1
        elif op == 0x68: self.a = self.flags(self.pull()); self.pc += 1
        elif op in (0x78, 0x58): self.pc += 1
        else:
            raise Halt(f"opcode ${op:02X} at ${pc:04X} is not simulated")

    def interrupt(self) -> None:
        """Take an IRQ through the vector at $FFFE, as the CPU does with the KERNAL banked out."""
        self.push(self.pc >> 8)
        self.push(self.pc & 0xFF)
        self.push(0x20)
        self.pc = self.word(0xFFFE)
