// A tiny 6502 "joystick monitor" loaded at $C000. It disables the keyboard scan
// (SEI + DDRA=input) so CIA1 port A ($DC00) reads joystick port 2 cleanly, then
// forever mirrors the live joystick byte to screen RAM $0400 and counts FIRE
// press edges into $0428. Reading those addresses over REST proves the app's
// joystick/fire actually reaches the running C64's CIA, not just the firmware.
//
//   $0400 = raw $DC00 (active-low: bit0 up,1 down,2 left,3 right,4 fire)
//   $0428 = FIRE press-edge counter (wraps at 256)
//
//        sei
//        lda #$00 ; sta $dc02   ; DDRA = all input
//        lda #$00 ; sta $0428   ; counter = 0
//        sta $fb                ; fire-was-down flag = 0
// loop:  lda $dc00 ; sta $0400  ; mirror joystick byte to screen
//        and #$10               ; fire bit (bit4, 0 = pressed)
//        bne released
//        lda $fb ; bne loop     ; already counted this hold
//        inc $0428 ; lda #$01 ; sta $fb ; jmp loop   ; new press edge
// released: lda #$00 ; sta $fb ; jmp loop
export const MONITOR_ADDRESS = "c000";
export const MONITOR_SYS = 49152;
export const SCREEN_JOY_ADDR = "0400"; // raw $DC00 mirror
export const FIRE_COUNTER_ADDR = "0428"; // press-edge counter

export const MONITOR_BYTES = [
  0x78, 0xa9, 0x00, 0x8d, 0x02, 0xdc, 0xa9, 0x00, 0x8d, 0x28, 0x04, 0x85, 0xfb, 0xad, 0x00, 0xdc, 0x8d, 0x00, 0x04,
  0x29, 0x10, 0xd0, 0x0e, 0xa5, 0xfb, 0xd0, 0xf2, 0xee, 0x28, 0x04, 0xa9, 0x01, 0x85, 0xfb, 0x4c, 0x0d, 0xc0, 0xa9,
  0x00, 0x85, 0xfb, 0x4c, 0x0d, 0xc0,
];

/** Decode the mirrored $DC00 byte to the set of pressed directions/fire. */
export const decodeJoyByte = (b) => {
  const pressed = [];
  if ((b & 0x01) === 0) pressed.push("up");
  if ((b & 0x02) === 0) pressed.push("down");
  if ((b & 0x04) === 0) pressed.push("left");
  if ((b & 0x08) === 0) pressed.push("right");
  if ((b & 0x10) === 0) pressed.push("fire");
  return pressed;
};
