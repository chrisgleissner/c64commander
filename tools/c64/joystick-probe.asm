; ---------------------------------------------------------------------------
; joystick-probe.asm — a C64 program written to be ASSERTED AGAINST, not played
; ---------------------------------------------------------------------------
;
; A filled PETSCII circle sits on the screen. Joystick port 2 moves it one cell
; per press and the fire button advances its colour and sounds a short blip.
; That is the whole program, and every part of it exists so an automated test can
; state exactly what the machine did.
;
; WHY A PURPOSE-BUILT PROGRAM
;
; The app's physical keys reach the C64 through Remote Input, and the only honest
; proof that a key did what the player expected is what the MACHINE did with it.
; Real software cannot supply that: a game's response to "left" depends on its own
; state, its timing and its collision rules, so a test that drives one is really
; testing the game. Here "left" has one meaning — the circle is one column further
; left — and the test reads it back out of screen RAM.
;
; It also answers the question rotation raises. When the handset is turned, the app
; permutes which joystick line a key asserts; the machine cannot know that happened.
; So the assertion has to be made at the machine: press the key that is physically
; "up" on the handset, turn the handset, press it again, and see the circle move in
; the direction the PLAYER now expects rather than the one the key started as.
;
; MOVEMENT IS EDGE-TRIGGERED, ONE CELL PER PRESS
;
; Deliberately not "move while held". A held direction moves the circle a distance
; that depends on how long the key was down, which over a network relay is not a
; quantity a test can predict — the same press would assert a different result on a
; busy phone. One cell per new press is the same answer every time. How long a
; direction was held is still recorded (`HELD_MASK`, and the per-direction counters
; count presses), so a test that wants to reason about holding can.
;
; TELEMETRY
;
; The state a test needs is published at fixed addresses in plain RAM at $C000, so
; it can be read over REST without parsing the display. The display is still the
; primary assertion — it is what the player sees — and the two must agree.
;
;   $C000  COL         column of the circle, 0..39
;   $C001  ROW         row of the circle, 2..24
;   $C002  COLOUR      colour index of the circle, 1..15
;   $C003  FIRES       fire presses since start (wraps at 256)
;   $C004  MOVES       moves since start (wraps at 256)
;   $C005  UP_COUNT    up presses (wraps)
;   $C006  DOWN_COUNT  down presses (wraps)
;   $C007  LEFT_COUNT  left presses (wraps)
;   $C008  RIGHT_COUNT right presses (wraps)
;   $C009  LAST_MASK   the last joystick mask read, active HIGH
;   $C00A  HELD_MASK   directions held right now, active HIGH
;   $C00B  MAGIC1      $4A 'J' — set once the probe is running
;   $C00C  MAGIC2      $50 'P'
;   $C00D  FRAMES      frame counter (wraps) — proves the probe is still alive
;
; Bit order in the two masks is the CIA's own: 0 up, 1 down, 2 left, 3 right,
; 4 fire.
;
; The banner JOYPROBE is drawn on the top row so `read_screen` can confirm the
; right program is running before asserting anything about the circle.
;
; SOUND
;
; A short blip on voice 1 per fire press, so a microphone or a stream capture can
; count fire presses independently of the screen. Percussive on purpose: a fixed
; attack and no sustain make each press one event with an unambiguous onset, which
; is what a counter needs. Every other SID voice is left silent.
;
; RAM-resident and self-contained. Loads at $0801 (BASIC SYS), run via run_prg.
; Interrupts stay disabled: the KERNAL's keyboard scan rewrites $DC00 fifty times a
; second, which is the very register the joystick is read from.

; --- telemetry block, plain RAM so REST can read it without banking ------------
COL         = $c000
ROW         = $c001
COLOUR      = $c002
FIRES       = $c003
MOVES       = $c004
UP_COUNT    = $c005
DOWN_COUNT  = $c006
LEFT_COUNT  = $c007
RIGHT_COUNT = $c008
LAST_MASK   = $c009
HELD_MASK   = $c00a
MAGIC1      = $c00b
MAGIC2      = $c00c
FRAMES      = $c00d

; --- private state, same page so one read covers everything -------------------
PREV_MASK   = $c010
EDGE_MASK   = $c011
SOUND_TTL   = $c012
OFF_LO      = $c013
OFF_HI      = $c014
ROW8_LO     = $c015
ROW8_HI     = $c016
SCRATCH     = $c017

; Indirect indexed writes can only be reached through zero page, and $FB-$FE are
; the four bytes the KERNAL leaves to programs.
ZP_SCR      = $fb               ; and $fc
ZP_COL      = $fd               ; and $fe

SCREEN      = $0400
COLOUR_RAM  = $d800

CIRCLE      = $51               ; screen code of the filled circle
BLANK       = $20

MIN_ROW     = 2                 ; rows 0 and 1 belong to the banner
MAX_ROW     = 24
MAX_COL     = 39

BLIP_FRAMES = 8

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

        ; The KERNAL scans the keyboard from the CIA1 timer interrupt and writes a
        ; column mask into $DC00 while it does. That is the same register the
        ; joystick is read from, so a scan landing between two reads shows
        ; directions nobody pressed. Silencing both CIAs stops the scan entirely.
        lda #$7f
        sta $dc0d
        sta $dd0d
        lda $dc0d               ; acknowledge anything already pending
        lda $dd0d

        ; Port A drives the keyboard columns; holding them all high leaves the
        ; joystick's pull-downs as the only thing that can clear a bit.
        lda #$ff
        sta $dc02
        sta $dc00
        lda #$00
        sta $dc03

        jsr init_screen
        jsr init_sid
        jsr init_state
        jsr draw_circle
        jsr settle

main_loop:
        jsr wait_frame
        jsr read_joystick
        jsr apply_edges
        jsr tick_sound
        inc FRAMES
        jmp main_loop

; --- settle -------------------------------------------------------------------
; The Ultimate's PRG runner starts a program by typing RUN and RETURN into the
; keyboard matrix. A key press shorts a matrix COLUMN to a row, and the columns are
; port A — the same register the joystick is read from. N sits on column 4, which is
; the fire bit, so the R-U-N the runner types arrives here as a fire press that
; nobody made. Measured: exactly one phantom fire on every start.
;
; So the first second is discarded, and the mask left behind at the end of it
; becomes the baseline rather than zero. Without the second half a direction still
; held when the loop opens would read as a fresh press on the first frame.
SETTLE_FRAMES = 50

settle:
        ldx #SETTLE_FRAMES
-       txa
        pha
        jsr wait_frame
        pla
        tax
        dex
        bne -
        lda $dc00
        eor #$ff
        and #$1f
        sta PREV_MASK
        rts

; --- one pass per frame -------------------------------------------------------
; Polled rather than interrupt-driven, because the interrupt this would run from
; is the one that has to stay off (see above).
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
        sta LAST_MASK
        sta HELD_MASK
        ; A press is a bit that is set now and was clear last frame. Without the
        ; edge, one press held across thirty frames would be thirty moves.
        ldx PREV_MASK
        stx SCRATCH
        eor #$ff
        ora SCRATCH
        eor #$ff                ; = LAST_MASK & ~PREV_MASK
        sta EDGE_MASK
        lda LAST_MASK
        sta PREV_MASK
        rts

; Each bit is re-read from memory rather than shifted along in the accumulator. The
; handlers below all use A, so a mask carried in it does not survive the first `jsr` —
; and the damage is silent: the shifted-out bits read as further directions, so ONE
; press arrived at the screen as up, down, left, right and fire together.
apply_edges:
        lda EDGE_MASK
        beq apply_done
        and #$01
        beq +
        jsr move_up
+       lda EDGE_MASK
        and #$02
        beq +
        jsr move_down
+       lda EDGE_MASK
        and #$04
        beq +
        jsr move_left
+       lda EDGE_MASK
        and #$08
        beq +
        jsr move_right
+       lda EDGE_MASK
        and #$10
        beq +
        jsr press_fire
+
apply_done:
        rts

; --- movement -----------------------------------------------------------------
; Each direction erases the circle where it was, moves, and redraws. Clamped at
; every edge: a circle that walked off the screen would wrap into the next row and
; the position a test read back would no longer describe what is on screen.
move_up:
        lda ROW
        cmp #MIN_ROW
        beq +
        jsr erase_circle
        dec ROW
        jsr moved
+       inc UP_COUNT
        rts

move_down:
        lda ROW
        cmp #MAX_ROW
        beq +
        jsr erase_circle
        inc ROW
        jsr moved
+       inc DOWN_COUNT
        rts

move_left:
        lda COL
        beq +
        jsr erase_circle
        dec COL
        jsr moved
+       inc LEFT_COUNT
        rts

move_right:
        lda COL
        cmp #MAX_COL
        beq +
        jsr erase_circle
        inc COL
        jsr moved
+       inc RIGHT_COUNT
        rts

moved:
        inc MOVES
        jsr draw_circle
        rts

; --- fire ---------------------------------------------------------------------
; Colour first, then the blip, so a test that hears the blip can already read the
; colour it belongs to.
press_fire:
        inc FIRES
        inc COLOUR
        lda COLOUR
        cmp #16
        bcc +
        lda #1                  ; 0 is black, which is the background
        sta COLOUR
+       jsr draw_circle
        jsr start_blip
        rts

; --- screen -------------------------------------------------------------------
; row*40 = row*32 + row*8, which is two shifts and an add rather than a table.
addr_for_cell:
        lda ROW
        sta OFF_LO
        lda #0
        sta OFF_HI
        asl OFF_LO              ; *2
        rol OFF_HI
        asl OFF_LO              ; *4
        rol OFF_HI
        asl OFF_LO              ; *8
        rol OFF_HI
        lda OFF_LO              ; keep row*8
        sta ROW8_LO
        lda OFF_HI
        sta ROW8_HI
        asl OFF_LO              ; *16
        rol OFF_HI
        asl OFF_LO              ; *32
        rol OFF_HI
        clc
        lda OFF_LO
        adc ROW8_LO             ; *32 + *8 = *40
        sta OFF_LO
        lda OFF_HI
        adc ROW8_HI
        sta OFF_HI
        clc
        lda OFF_LO
        adc COL
        sta OFF_LO
        lda OFF_HI
        adc #0
        sta OFF_HI
        ; Screen and colour RAM are both page-aligned and hold the same cell at the
        ; same offset, so one offset produces both pointers by adding a high byte.
        lda OFF_LO
        sta ZP_SCR
        sta ZP_COL
        lda OFF_HI
        clc
        adc #>SCREEN
        sta ZP_SCR+1
        lda OFF_HI
        clc
        adc #>COLOUR_RAM
        sta ZP_COL+1
        rts

draw_circle:
        jsr addr_for_cell
        ldy #0
        lda #CIRCLE
        sta (ZP_SCR),y
        lda COLOUR
        sta (ZP_COL),y
        rts

erase_circle:
        jsr addr_for_cell
        ldy #0
        lda #BLANK
        sta (ZP_SCR),y
        rts

init_screen:
        lda #0
        sta $d020
        sta $d021
        ldx #0
        lda #BLANK
-       sta SCREEN,x
        sta SCREEN+$100,x
        sta SCREEN+$200,x
        sta SCREEN+$2e8,x
        inx
        bne -
        ldx #0
        lda #1                  ; white, so the banner reads on any capture
-       sta COLOUR_RAM,x
        sta COLOUR_RAM+$100,x
        sta COLOUR_RAM+$200,x
        sta COLOUR_RAM+$2e8,x
        inx
        bne -
        ldx #0
-       lda banner,x
        beq +
        sta SCREEN,x
        inx
        bne -
+       rts

banner:
        ; JOYPROBE in screen codes; terminated by 0, which is '@' and therefore
        ; never part of the text.
        .byte 10, 15, 25, 16, 18, 15, 2, 5, 0

; --- SID ----------------------------------------------------------------------
; One voice, one job. A fixed attack with no sustain makes each press a single
; onset that a detector can count without knowing anything about the tune.
init_sid:
        ldx #24
        lda #0
-       sta $d400,x
        dex
        bpl -
        lda #$0f
        sta $d418               ; master volume
        lda #$09
        sta $d405               ; attack 0, decay 9
        lda #$00
        sta $d406               ; sustain 0, release 0
        lda #$45                ; ~440 Hz on a PAL machine
        sta $d400
        lda #$1d
        sta $d401
        lda #0
        sta SOUND_TTL
        rts

start_blip:
        lda #$21                ; sawtooth + gate on
        sta $d404
        lda #BLIP_FRAMES
        sta SOUND_TTL
        rts

tick_sound:
        lda SOUND_TTL
        beq +
        dec SOUND_TTL
        bne +
        lda #$20                ; gate off; the release does the rest
        sta $d404
+       rts

; --- state --------------------------------------------------------------------
init_state:
        lda #20
        sta COL
        lda #12
        sta ROW
        lda #1
        sta COLOUR
        lda #0
        sta FIRES
        sta MOVES
        sta UP_COUNT
        sta DOWN_COUNT
        sta LEFT_COUNT
        sta RIGHT_COUNT
        sta LAST_MASK
        sta HELD_MASK
        sta PREV_MASK
        sta EDGE_MASK
        sta FRAMES
        ; Written last, so a test that sees the magic knows every other field has
        ; already been initialised rather than catching the block half-written.
        lda #$4a
        sta MAGIC1
        lda #$50
        sta MAGIC2
        rts
