; ---------------------------------------------------------------------------
; joystick-probe.asm — a C64 program written to be ASSERTED AGAINST, not played
; ---------------------------------------------------------------------------
;
; A filled PETSCII circle sits on the screen. Joystick port 2 moves it — one cell
; on the press, then again and again for as long as the direction is held — and the
; fire button advances its colour and sounds a short blip. That is the whole
; program, and every part of it exists so an automated test can state exactly what
; the machine did.
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
; MOVEMENT REPEATS WHILE A DIRECTION IS HELD
;
; A press moves the circle one cell at once. If the direction is still held
; `REPEAT_DELAY_F` frames later the circle moves again, and keeps moving every
; `REPEAT_RATE_F` frames until the direction is released — the same auto-repeat a
; key has, and what a player holding the stick expects to see.
;
; This used to be one cell per press and nothing more, on the argument that a test
; cannot predict how far a held direction travels over a network relay. That
; argument was wrong about what makes a result assertable. The distance is not
; predictable, but it does not have to be: the machine publishes both the repeat
; cadence it is using (`REPEAT_DELAY_F`, `REPEAT_RATE_F`) and how many frames the
; current hold has lasted (`HOLD_FRAMES`), so a test computes the moves that hold
; earned rather than guessing them. What was actually untestable before is the
; behaviour a player cares about most, which is that holding a direction keeps the
; circle going.
;
; Fire is still one event per press. It advances the colour and sounds one blip, and
; a repeating fire would make both a function of how long a thumb stayed down —
; which is the argument above, correctly applied. Autofire is the app's job, and the
; app has its own control for it.
;
; TELEMETRY
;
; The state a test needs is published at fixed addresses in plain RAM at $C000, so
; it can be read over REST without parsing the display. The display is still the
; primary assertion — it is what the player sees — and the two must agree.
;
;   $C000  COL           column of the circle, 0..39
;   $C001  ROW           row of the circle, 2..24
;   $C002  COLOUR        colour index of the circle, 1..15
;   $C003  FIRES         fire presses since start (wraps at 256)
;   $C004  MOVES         cells the circle actually moved (wraps at 256)
;   $C005  UP_COUNT      up events — presses AND repeats (wraps)
;   $C006  DOWN_COUNT    down events (wraps)
;   $C007  LEFT_COUNT    left events (wraps)
;   $C008  RIGHT_COUNT   right events (wraps)
;   $C009  LAST_MASK     the last joystick mask read, active HIGH
;   $C00A  HELD_MASK     directions held right now, active HIGH
;   $C00B  MAGIC1        $4A 'J' — set once the probe is running
;   $C00C  MAGIC2        $50 'P'
;   $C00D  FRAMES        frame counter (wraps) — proves the probe is still alive
;   $C00E  REPEATS       repeat ticks delivered (wraps)
;   $C00F  HOLD_FRAMES   frames the current direction hold has lasted, to 255
;   $C010  REPEAT_DELAY_F frames from the press to the first repeat (constant)
;   $C011  REPEAT_RATE_F  frames between repeats after that (constant)
;
; The two constants are published rather than only documented so a harness reads the
; cadence off the machine it is talking to instead of carrying its own copy that can
; fall out of step with this file.
;
; A direction counter counts EVENTS, and `MOVES` counts cells travelled. They differ
; at a screen edge: the circle is clamped there, so a held direction keeps counting
; up while `MOVES` and the position stop. That is the honest reading of both, and a
; test asserting travel should use `MOVES` and the position.
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
COL           = $c000
ROW           = $c001
COLOUR        = $c002
FIRES         = $c003
MOVES         = $c004
UP_COUNT      = $c005
DOWN_COUNT    = $c006
LEFT_COUNT    = $c007
RIGHT_COUNT   = $c008
LAST_MASK     = $c009
HELD_MASK     = $c00a
MAGIC1        = $c00b
MAGIC2        = $c00c
FRAMES        = $c00d
REPEATS       = $c00e
HOLD_FRAMES   = $c00f
REPEAT_DELAY_F = $c010
REPEAT_RATE_F  = $c011

; --- private state, same page so one read covers everything -------------------
; Left a clear gap below the telemetry block so a field added there later does not
; have to move any of this.
PREV_MASK   = $c020
EDGE_MASK   = $c021
SOUND_TTL   = $c022
OFF_LO      = $c023
OFF_HI      = $c024
ROW8_LO     = $c025
ROW8_HI     = $c026
SCRATCH     = $c027
REPEAT_TTL  = $c028
REPEAT_MASK = $c029

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

; Auto-repeat cadence, in PAL frames (50 per second). The delay is long enough that
; a deliberate single press cannot earn a second cell — the relay's own coalescing
; and one network hop are both well inside it — and the rate is slow enough that a
; second of holding crosses a third of the screen rather than pinning the circle to
; the edge before a test can read it back.
REPEAT_DELAY  = 12              ; ~240 ms before the first repeat
REPEAT_RATE   = 4               ; ~80 ms between repeats, so 12.5 cells a second

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
        jsr apply_repeat
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
        ; A press is a bit that is set now and was clear last frame. The edge is
        ; what separates the press from the hold: without it a direction held for
        ; thirty frames would move thirty cells at the frame rate, instead of one
        ; cell and then the deliberate repeat cadence `apply_repeat` runs.
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

; --- auto-repeat ---------------------------------------------------------------
; One countdown for the whole held direction set rather than one per direction, so a
; diagonal repeats as a diagonal: both of its directions move on the same tick and
; the circle travels along the line the player is holding instead of stepping around
; it. Fire is excluded (`and #$0f`) — it is one event per press, see the header.
apply_repeat:
        lda HELD_MASK
        and #$0f
        sta REPEAT_MASK
        bne repeat_held
        ; Nothing held: the hold is over, and the next one starts its delay afresh.
        lda #0
        sta REPEAT_TTL
        sta HOLD_FRAMES
        rts

repeat_held:
        ; Saturate rather than wrap. A counter that rolled over would report a long
        ; hold as a short one, and a test cannot tell the two apart after the fact.
        lda HOLD_FRAMES
        cmp #$ff
        beq +
        inc HOLD_FRAMES
+
        ; A press has already moved the circle this frame, so the delay starts here.
        ; Adding a second direction to a held one restarts it, which is what makes a
        ; diagonal begin as one movement rather than mid-stride.
        lda EDGE_MASK
        and #$0f
        beq repeat_running
        lda #REPEAT_DELAY
        sta REPEAT_TTL
        rts

repeat_running:
        ; A direction can be held with no edge behind it: `settle` takes whatever is
        ; down as the baseline, so a direction already held when the loop opens never
        ; produced one. Arming here gives that hold the same delay a press gets,
        ; instead of decrementing zero into 255 and stalling for five seconds.
        lda REPEAT_TTL
        bne repeat_countdown
        lda #REPEAT_DELAY
        sta REPEAT_TTL

repeat_countdown:
        dec REPEAT_TTL
        bne repeat_done
        lda #REPEAT_RATE
        sta REPEAT_TTL
        jsr repeat_move
repeat_done:
        rts

; Same shape as `apply_edges`, and for the same reason: every bit is re-read from
; memory because the handlers use A.
repeat_move:
        inc REPEATS
        lda REPEAT_MASK
        and #$01
        beq +
        jsr move_up
+       lda REPEAT_MASK
        and #$02
        beq +
        jsr move_down
+       lda REPEAT_MASK
        and #$04
        beq +
        jsr move_left
+       lda REPEAT_MASK
        and #$08
        beq +
        jsr move_right
+       rts

; --- movement -----------------------------------------------------------------
; Each direction erases the circle where it was, moves, and redraws. Clamped at
; every edge: a circle that walked off the screen would wrap into the next row and
; the position a test read back would no longer describe what is on screen.
;
; The per-direction counter is bumped whether or not the circle could move, so it
; counts direction events and `MOVES` counts cells travelled. Reached by both
; `apply_edges` and `repeat_move`, so a repeat is counted exactly like a press.
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
        sta REPEATS
        sta HOLD_FRAMES
        sta REPEAT_TTL
        sta REPEAT_MASK
        ; The cadence the loop below will actually use, taken from the same two
        ; constants, so what a harness reads cannot describe a different program.
        lda #REPEAT_DELAY
        sta REPEAT_DELAY_F
        lda #REPEAT_RATE
        sta REPEAT_RATE_F
        ; Written last, so a test that sees the magic knows every other field has
        ; already been initialised rather than catching the block half-written.
        lda #$4a
        sta MAGIC1
        lda #$50
        sta MAGIC2
        rts
