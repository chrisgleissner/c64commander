; ---------------------------------------------------------------------------
; follow-lock-demo.asm — a fake game, written to exercise a tracker
; ---------------------------------------------------------------------------
;
; Eight hardware sprites move over a dotted backdrop. Sprite 0 is "the player" —
; the one a user would press and hold on in Live View — and everything else is
; scenery that exists to make following it hard. Nothing here is playable; every
; part of it is one of the things a real game does to an object tracker.
;
; WHY A PURPOSE-BUILT PROGRAM
;
; A tracker can be unit-tested against synthetic frames, and it is. What that
; cannot cover is the whole path: a real VIC drawing real sprites, the machine's
; own video encoder, the network, the receiver, and the app's decode. Running an
; actual game over that path proves nothing repeatable, because the game's
; behaviour depends on how it is played. Here the player's motion is a fixed,
; published programme, so a person watching the phone knows exactly what the view
; SHOULD be doing at every moment, and the numbers behind it can be read out of
; RAM over REST.
;
; THE SIX PHASES, 150 frames (3 seconds) each, looping
;
;   1 IDLE   drifts right one pixel a frame, steady colour. Lock on here.
;   2 WALK   two pixels a frame with a vertical wander — ordinary play.
;   3 FLASH  the same motion while the colour changes every four frames, then
;            settles on a NEW colour and keeps it. Damage, then a power-up.
;   4 FAST   eight pixels a frame, running off one side of the screen and back on
;            the other. The screen-wrap case, and the fastest a C64 game moves.
;   5 CROSS  the player and sprite 1 — same shape, same colour — converge on one
;            row and pass through each other. The identity-swap case.
;   6 HIDE   the player is switched off for 40 frames while it keeps moving, then
;            comes back. Occlusion, and leaving the frame.
;
; The player's colour is deliberately WHITE in phases 1 and 2 and sprite 1 is
; white too, so the crossing in phase 5 is between two objects that are identical
; in every respect a tracker can measure. If the view comes out of phase 5 on
; sprite 1, that is the defect the phase exists to find.
;
; CONTROLS (joystick port 2)
;
;   FIRE   freeze / unfreeze all motion. Freeze it to press and hold calmly.
;   UP     skip to the next phase, so a session does not have to wait for one.
;
; TELEMETRY — plain RAM at $C000, readable over GET /v1/machine:readmem
;
;   $C000  MAGIC1        $46 'F' — set once the demo is running
;   $C001  MAGIC2        $4C 'L'
;   $C002  FRAMES        frame counter (wraps)
;   $C003  PHASE         1..6, as above
;   $C004  PHASE_FRAMES  frames elapsed in this phase, 0..149
;   $C005  PX_LO         player X, low 8 bits
;   $C006  PX_HI         player X, bit 8 (0 or 1)
;   $C007  PY            player Y
;   $C008  PCOLOUR       player colour index
;   $C009  PANIM         which of the two player shapes is showing (0 or 1)
;   $C00A  PVISIBLE      1 unless the player is switched off (phase 6)
;   $C00B  CROSSINGS     times the player and sprite 1 swapped sides (wraps)
;   $C00C  RECOLOURS     player colour changes (wraps)
;   $C00D  WRAPS         times the player wrapped past X=511 (wraps)
;   $C00E  PAUSED        1 while motion is frozen
;   $C00F  SPRITES       8 — how many sprites this demo drives
;
; The phase and its frame counter are published rather than only timed, so a
; harness can wait for the phase it wants instead of counting seconds and hoping.
;
; RAM-resident and self-contained. Loads at $0801 (BASIC SYS), run via run_prg.
; Interrupts stay disabled: the KERNAL's keyboard scan rewrites $DC00 fifty times
; a second, which is the very register the joystick is read from.

; --- telemetry ----------------------------------------------------------------
MAGIC1        = $c000
MAGIC2        = $c001
FRAMES        = $c002
PHASE         = $c003
PHASE_FRAMES  = $c004
PX_LO         = $c005
PX_HI         = $c006
PY            = $c007
PCOLOUR       = $c008
PANIM         = $c009
PVISIBLE      = $c00a
CROSSINGS     = $c00b
RECOLOURS     = $c00c
WRAPS         = $c00d
PAUSED        = $c00e
SPRITES       = $c00f

; --- private state ------------------------------------------------------------
PREV_MASK   = $c020
EDGE_MASK   = $c021
SCRATCH     = $c022
ANIM_TTL    = $c023
PREV_SIGN   = $c024
PREV_HI     = $c025
CARRY_TMP   = $c026

; --- per-sprite state, one byte each ------------------------------------------
SX_LO       = $c040
SX_HI       = $c048
SY          = $c050
DX          = $c058
DY          = $c060
SCOL        = $c068
SPTR        = $c070

SCREEN      = $0400
COLOUR_RAM  = $d800
SPRITE_PTRS = $07f8

BLANK       = $20
DOT         = $2e

PHASE_LEN   = 150
MIN_Y       = 60
MAX_Y       = 220
CROSS_Y     = 140
ANIM_RATE   = 5
HIDE_FROM   = 40
HIDE_TO     = 80

WHITE       = 1
ORANGE      = 8

*=$0801
        .word basic_end
        .word 10
        .byte $9e
        .byte " "
        .text format("%4d", start)
        .byte 0
basic_end:
        .word 0

start:
        sei
        lda #$37
        sta $01

        ; Silence both CIAs. The KERNAL's keyboard scan writes a column mask into
        ; $DC00 from the CIA1 interrupt, and $DC00 is where the joystick is read
        ; from, so a scan landing between two reads shows directions nobody made.
        lda #$7f
        sta $dc0d
        sta $dd0d
        lda $dc0d
        lda $dd0d
        lda #$ff
        sta $dc02
        sta $dc00
        lda #$00
        sta $dc03

        jsr init_screen
        jsr init_state
        jsr enter_phase
        jsr settle

main_loop:
        jsr wait_frame
        jsr read_joystick
        jsr apply_controls
        lda PAUSED
        bne main_frozen
        jsr advance_phase
        jsr move_sprites
        jsr animate
        jsr detect_cross
main_frozen:
        jsr write_vic
        jsr draw_phase
        inc FRAMES
        jmp main_loop

; --- settle -------------------------------------------------------------------
; The Ultimate's PRG runner starts a program by typing RUN and RETURN into the
; keyboard matrix, and a key press shorts a matrix COLUMN — which is port A, the
; same register the joystick is read from. N sits on the fire bit, so the R-U-N it
; types arrives as a fire press nobody made. The first second is discarded, and
; whatever is held at the end of it becomes the baseline rather than zero.
SETTLE_FRAMES = 50

settle:
        ldx #SETTLE_FRAMES
-       txa
        pha
        jsr wait_frame
        jsr write_vic
        pla
        tax
        dex
        bne -
        lda $dc00
        eor #$ff
        and #$1f
        sta PREV_MASK
        rts

wait_frame:
        lda #$fb
-       cmp $d012
        bne -
-       cmp $d012
        beq -
        rts

; --- joystick -----------------------------------------------------------------
; $DC00 reads active LOW; everything above this line works in active HIGH, so the
; inversion happens once, here.
read_joystick:
        lda $dc00
        eor #$ff
        and #$1f
        sta SCRATCH
        lda PREV_MASK
        eor #$ff
        and SCRATCH
        sta EDGE_MASK           ; = held & ~previous
        lda SCRATCH
        sta PREV_MASK
        rts

; Fire freezes motion so the picture can be pressed and held calmly; up skips to
; the next phase so a session does not have to wait three seconds for it.
apply_controls:
        lda EDGE_MASK
        and #$10
        beq +
        lda PAUSED
        eor #$01
        sta PAUSED
+       lda EDGE_MASK
        and #$01
        beq +
        jsr next_phase
+       rts

; --- phases -------------------------------------------------------------------
advance_phase:
        inc PHASE_FRAMES
        lda PHASE_FRAMES
        cmp #PHASE_LEN
        bcc +
        jsr next_phase
        rts
+       jsr phase_tick
        rts

next_phase:
        lda #0
        sta PHASE_FRAMES
        inc PHASE
        lda PHASE
        cmp #7
        bcc +
        lda #1
        sta PHASE
+       jsr enter_phase
        rts

; Everything a phase decides once: the player's speed, its colour, and in the
; crossing phase the look-alike's course as well.
enter_phase:
        lda #1
        sta PVISIBLE
        lda #0
        sta DY

        lda PHASE
        cmp #1
        bne +
        lda #1
        sta DX
        lda #WHITE
        sta SCOL
        rts
+       cmp #2
        bne +
        lda #2
        sta DX
        lda #1
        sta DY
        lda #WHITE
        sta SCOL
        rts
+       cmp #3
        bne +
        lda #2
        sta DX
        rts
+       cmp #4
        bne +
        lda #8
        sta DX
        lda #ORANGE
        sta SCOL
        rts
+       cmp #5
        bne +
        lda #3
        sta DX
        lda #WHITE
        sta SCOL
        lda #CROSS_Y
        sta SY
        sta SY+1
        lda #$fd                ; -3, so sprite 1 comes the other way
        sta DX+1
        lda #0
        sta DY+1
        lda #WHITE
        sta SCOL+1
        rts
+       lda #2                  ; phase 6
        sta DX
        rts

; Everything a phase decides every frame.
phase_tick:
        lda PHASE
        cmp #3
        beq tick_flash
        cmp #6
        beq tick_hide
        rts

; Four frames per colour for 120 frames, then one new colour and keep it. The
; rapid part is damage; the part that sticks is a power-up, and a tracker has to
; survive the first without being rewritten by it and adopt the second.
tick_flash:
        lda PHASE_FRAMES
        cmp #120
        bcs flash_settle
        and #$03
        bne +
        lda PHASE_FRAMES
        lsr
        lsr
        and #$07
        tax
        lda flash_colours,x
        sta SCOL
        inc RECOLOURS
+       rts
flash_settle:
        lda SCOL
        cmp #ORANGE
        beq +
        lda #ORANGE
        sta SCOL
        inc RECOLOURS
+       rts

flash_colours:
        .byte 1, 7, 13, 3, 10, 15, 5, 12

; Switched off, not moved away: the player keeps travelling while it cannot be
; seen, so the view has to arrive where it ended up rather than where it vanished.
tick_hide:
        lda PHASE_FRAMES
        cmp #HIDE_FROM
        bcc hide_show
        cmp #HIDE_TO
        bcs hide_show
        lda #0
        sta PVISIBLE
        rts
hide_show:
        lda #1
        sta PVISIBLE
        rts

; --- motion -------------------------------------------------------------------
; X is nine bits, so it wraps at 512 all by itself: the sprite spends the frames
; between 344 and 511 behind the border, which is the screen-exit case with no
; special code for it.
move_sprites:
        lda SX_HI
        sta PREV_HI
        ldx #7
move_one:
        clc
        lda SX_LO,x
        adc DX,x
        sta SX_LO,x
        ; LDA does not touch carry, so the direction can be re-read to decide what
        ; the carry meant: set after a positive step is an overflow past 255, clear
        ; after a negative one is a borrow below 0. Either way, bit 8 flips.
        lda DX,x
        bmi move_neg
        bcc move_y
        bcs move_flip
move_neg:
        bcs move_y
move_flip:
        lda SX_HI,x
        eor #$01
        sta SX_HI,x
move_y:
        clc
        lda SY,x
        adc DY,x
        sta SY,x
        cmp #MIN_Y
        bcs +
        lda #MIN_Y
        sta SY,x
        jsr flip_dy
+       lda SY,x
        cmp #MAX_Y+1
        bcc +
        lda #MAX_Y
        sta SY,x
        jsr flip_dy
+       dex
        bpl move_one

        ; Only the player's wrap is counted, and only the 511 -> 0 direction.
        lda PREV_HI
        beq +
        lda SX_HI
        bne +
        inc WRAPS
+       rts

flip_dy:
        lda #0
        sec
        sbc DY,x
        sta DY,x
        rts

; Two shapes with different silhouettes, alternating: the outline a tracker sees
; changes every few frames even when the colour does not.
animate:
        dec ANIM_TTL
        bne +
        lda #ANIM_RATE
        sta ANIM_TTL
        lda PANIM
        eor #$01
        sta PANIM
+       lda PANIM
        beq +
        lda #(spr_player_b / 64)
        sta SPTR
        rts
+       lda #(spr_player_a / 64)
        sta SPTR
        rts

; The sign of (player X - sprite 1 X) as a 16-bit difference. A change of sign is
; the two having passed through each other, which is the event phase 5 is for.
detect_cross:
        sec
        lda SX_LO
        sbc SX_LO+1
        lda SX_HI
        sbc SX_HI+1
        and #$80
        sta SCRATCH
        cmp PREV_SIGN
        beq +
        inc CROSSINGS
+       lda SCRATCH
        sta PREV_SIGN
        rts

; --- VIC ----------------------------------------------------------------------
write_vic:
        ldx #0
        ldy #0
-       lda SX_LO,x
        sta $d000,y
        lda SY,x
        sta $d001,y
        lda SCOL,x
        sta $d027,x
        lda SPTR,x
        sta SPRITE_PTRS,x
        iny
        iny
        inx
        cpx #8
        bne -

        ; $D010 holds the ninth X bit of all eight sprites, so it is assembled from
        ; sprite 7 downwards, one bit per shift.
        lda #0
        ldx #7
-       asl
        ora SX_HI,x
        dex
        bpl -
        sta $d010

        lda #$ff
        ldx PVISIBLE
        bne +
        and #$fe
+       sta $d015

        lda #$00
        sta $d01c               ; all sprites hi-res, one colour each
        sta $d017
        sta $d01d

        lda SX_LO
        sta PX_LO
        lda SX_HI
        sta PX_HI
        lda SY
        sta PY
        lda SCOL
        sta PCOLOUR
        rts

; --- screen -------------------------------------------------------------------
draw_phase:
        lda PHASE
        clc
        adc #$30                ; screen code of '0' is $30
        sta SCREEN+46           ; row 1, column 6
        lda #1
        sta COLOUR_RAM+46
        rts

init_screen:
        lda #0
        sta $d020
        sta $d021

        ; A dotted backdrop rather than a flat colour, so the picture the tracker
        ; sees has something in it besides the sprites.
        ldx #0
-       txa
        and #$07
        beq +
        lda #BLANK
        bne ++
+       lda #DOT
+       sta SCREEN,x
        sta SCREEN+$100,x
        sta SCREEN+$200,x
        sta SCREEN+$2e8,x
        lda #11                 ; dark grey, so the dots do not read as objects
        sta COLOUR_RAM,x
        sta COLOUR_RAM+$100,x
        sta COLOUR_RAM+$200,x
        sta COLOUR_RAM+$2e8,x
        inx
        bne -

        ldx #0
-       lda banner,x
        sta SCREEN,x
        lda #1
        sta COLOUR_RAM,x
        inx
        cpx #banner_end-banner
        bne -

        ldx #0
-       lda phase_label,x
        sta SCREEN+40,x
        lda #1
        sta COLOUR_RAM+40,x
        inx
        cpx #phase_label_end-phase_label
        bne -
        rts

; Screen codes, not PETSCII: this is written straight into screen RAM.
banner:
        .byte 6, 15, 12, 12, 15, 23, 12, 15, 3, 11     ; FOLLOWLOCK
banner_end:
phase_label:
        .byte 16, 8, 1, 19, 5, 32                      ; PHASE
phase_label_end:

; --- initial state ------------------------------------------------------------
init_state:
        lda #$46
        sta MAGIC1
        lda #$4c
        sta MAGIC2
        lda #8
        sta SPRITES
        lda #1
        sta PHASE
        lda #ANIM_RATE
        sta ANIM_TTL
        ldx #0
        lda #0
-       sta FRAMES
        sta PHASE_FRAMES
        sta PANIM
        sta CROSSINGS
        sta RECOLOURS
        sta WRAPS
        sta PAUSED
        sta PREV_SIGN
        inx
        cpx #1
        bne -

        ldx #7
-       lda init_x_lo,x
        sta SX_LO,x
        lda init_x_hi,x
        sta SX_HI,x
        lda init_y,x
        sta SY,x
        lda init_dx,x
        sta DX,x
        lda init_dy,x
        sta DY,x
        lda init_col,x
        sta SCOL,x
        lda init_ptr,x
        sta SPTR,x
        dex
        bpl -
        rts

; Sprite 1 is the look-alike: the player's own shape, in the player's own colour.
; Every other decoy is a saucer in a colour the player never wears.
init_x_lo:  .byte 60, 250, 100, 200, 40, 150, 80, 220
init_x_hi:  .byte 0, 0, 0, 0, 1, 0, 1, 0
init_y:     .byte 120, 190, 70, 210, 90, 160, 100, 180
init_dx:    .byte 1, $fd, 2, $fe, 3, $fc, 1, $ff
init_dy:    .byte 0, 0, 1, $ff, 1, $ff, 1, $ff
init_col:   .byte WHITE, WHITE, 10, 12, 3, 13, 7, 15
init_ptr:   .byte (spr_player_a / 64), (spr_player_a / 64), (spr_saucer / 64), (spr_saucer / 64), (spr_saucer / 64), (spr_saucer / 64), (spr_saucer / 64), (spr_saucer / 64)

; --- sprite shapes ------------------------------------------------------------
        .align 64
spr_player_a:
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%01111110,%00000000
        .byte %00000000,%01111110,%00000000
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%00011000,%00000000
        .byte %00000001,%11111111,%10000000
        .byte %00000001,%10111101,%10000000
        .byte %00000001,%10111101,%10000000
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%01111110,%00000000
        .byte %00000000,%01111110,%00000000
        .byte %00000000,%01111110,%00000000
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%00110000,%00000000
        .byte %00000000,%00110000,%00000000
        .byte %00000000,%00110000,%00000000
        .byte %00000000,%00110000,%00000000
        .byte %00000000,%01110000,%00000000
        .byte %00000000,%01110000,%00000000
        .byte 0

        .align 64
spr_player_b:
        .byte %00000110,%00111100,%01100000
        .byte %00000110,%01111110,%01100000
        .byte %00000110,%01111110,%01100000
        .byte %00000011,%00111100,%11000000
        .byte %00000001,%10011001,%10000000
        .byte %00000000,%11111111,%00000000
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%01111110,%00000000
        .byte %00000000,%01111110,%00000000
        .byte %00000000,%01111110,%00000000
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%01100110,%00000000
        .byte %00000000,%11000011,%00000000
        .byte %00000001,%10000001,%10000000
        .byte %00000001,%10000001,%10000000
        .byte %00000011,%00000000,%11000000
        .byte %00000011,%00000000,%11000000
        .byte %00000111,%00000001,%11000000
        .byte %00000111,%00000001,%11000000
        .byte 0

        .align 64
spr_saucer:
        .byte %00000000,%00011000,%00000000
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%01111110,%00000000
        .byte %00000000,%11111111,%00000000
        .byte %00000001,%11111111,%10000000
        .byte %00000011,%11111111,%11000000
        .byte %00000111,%11111111,%11100000
        .byte %00001111,%11111111,%11110000
        .byte %00011111,%11111111,%11111000
        .byte %00111111,%11111111,%11111100
        .byte %01111111,%11111111,%11111110
        .byte %00111111,%11111111,%11111100
        .byte %00011111,%11111111,%11111000
        .byte %00001111,%11111111,%11110000
        .byte %00000111,%11111111,%11100000
        .byte %00000011,%11111111,%11000000
        .byte %00000001,%11111111,%10000000
        .byte %00000000,%11111111,%00000000
        .byte %00000000,%01111110,%00000000
        .byte %00000000,%00111100,%00000000
        .byte %00000000,%00011000,%00000000
        .byte 0
