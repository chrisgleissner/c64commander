; C64 Audio/Video Sync Test (Space-triggered)
;
; Derived from c64stream's tools/c64/av-sync.asm (space -> flash + tone) and
; av-sync-auto.asm (precise one-frame, raster-aligned A/V "pop"). Each time SPACE is
; newly pressed (rising edge, de-bounced) it emits exactly ONE frame-aligned white
; flash + SID tone — the same discrete pop the C64 Commander A/V sync analyzer detects
; for the automatic program, but on demand. C64 Commander sends the space key over
; Remote Input (machine:input) and measures the time from that press to seeing/hearing
; the resulting pop, and the audio<->video offset of the pop.
;
; RAM-resident, self-contained. Load at $0801 (BASIC SYS 2062), run via run_prg.

*=$0801
basic_stub:
        .word basic_end         ; pointer to next line
        .word 10                ; line number 10
        .byte $9e               ; SYS token
        .byte " "
        .text format("%4d", start)  ; SYS address auto-calculated
        .byte 0                 ; end of BASIC line
basic_end:
        .word 0                 ; end of BASIC program

start:
        sei                     ; disable interrupts

        ; Ensure I/O is mapped in ($D000-$DFFF)
        lda #$37
        sta $01

        ; CIA1 keyboard port directions: port A output (column select),
        ; port B input (row read). (KERNAL sets these at boot; set explicitly.)
        lda #$ff
        sta $dc02
        lda #$00
        sta $dc03

        ; Clear screen to spaces first
        jsr clear_screen

        ; Make entire screen white (color RAM) so the pop frame flips to true white.
        jsr clear_color_ram

        lda #$00
        sta $d020               ; border black
        sta $d021               ; background black
        sta $d015               ; disable all sprites

        ; Initialize SID - clear all registers first
        ldx #$18
clear_sid:
        sta $d400,x
        dex
        bpl clear_sid

        ; Set up ADSR for voice 1: instant attack, high sustain
        lda #$00
        sta $d405               ; ADSR: attack=0, decay=0
        lda #$f0
        sta $d406               ; ADSR: sustain=max, release=0

        lda #$00
        sta flash_active
        sta space_was_down

        ; Detect PAL/NTSC to compute the end-of-frame raster line.
        jsr detect_video_standard

        ; Set up IRQ vector
        lda #<irq_handler
        sta $0314
        lda #>irq_handler
        sta $0315

        lda #$7f
        sta $dc0d               ; disable CIA1 interrupts
        sta $dd0d               ; disable CIA2 interrupts
        lda $dc0d               ; clear pending CIA1 interrupts
        lda $dd0d               ; clear pending CIA2 interrupts

        lda #$01
        sta $d01a               ; enable raster IRQ

        jsr schedule_irq_end_line

        lda #$01
        sta $d019               ; acknowledge any pending VIC IRQs

        cli                     ; enable interrupts

main_loop:
        jmp main_loop

;--------------------------
; Clear screen memory to spaces ($20)
;--------------------------
clear_screen:
        lda #$20
        ldx #$00
clear_loop_first_232:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        cpx #$e8                ; 232 bytes
        bne clear_loop_first_232

clear_loop_last_24:
        sta $0400,x
        sta $0500,x
        sta $0600,x
        inx
        bne clear_loop_last_24
        rts

;--------------------------
; Set full screen color RAM to white ($01)
;--------------------------
clear_color_ram:
        lda #$01
        ldx #$00
ccr_loop_first_232:
        sta $d800,x
        sta $d900,x
        sta $da00,x
        sta $db00,x
        inx
        cpx #$e8
        bne ccr_loop_first_232

ccr_loop_last_24:
        sta $d800,x
        sta $d900,x
        sta $da00,x
        inx
        bne ccr_loop_last_24
        rts

;--------------------------
; Raster IRQ handler
;--------------------------
irq_handler:
        ; Hook the KERNAL IRQ vector ($0314/$0315); ROM already saved registers.
        ; JMP $EA81 at the end to restore + RTI (do NOT use RTI here).

        lda irq_phase
        beq irq_at_end_line

        ; ----- IRQ at line 0 -----
        lda flash_active
        beq irq_line0_done

        cmp #$01
        beq irq_mark_white_frame

        ; flash_active == 2 -> stop on first row of next frame
        jsr av_pop_stop
        lda #$00
        sta flash_active
        jmp irq_line0_done

irq_mark_white_frame:
        lda #$02
        sta flash_active

irq_line0_done:
        lda #$00
        sta irq_phase
        jsr schedule_irq_end_line
        jmp irq_done

        ; ----- IRQ at end-of-frame -----
irq_at_end_line:
        lda flash_active
        cmp #$02
        beq irq_endline_keep_white

        ; Space rising-edge detection (CIA1 keyboard matrix row 7, col 4).
        lda #%01111111
        sta $dc00               ; drive keyboard row 7 low
        lda $dc01               ; read row bits
        and #%00010000          ; col 4 = SPACE; 0 => pressed
        bne space_released

        ; SPACE is down now.
        lda space_was_down
        bne irq_endline_done    ; still held from last frame -> no new pop
        lda #$01
        sta space_was_down
        jsr av_pop_start
        lda #$01
        sta flash_active
        lda #$01
        sta irq_phase
        jsr schedule_irq_line0
        jmp irq_done

space_released:
        lda #$00
        sta space_was_down
        jmp irq_endline_done

irq_endline_done:
        jmp irq_done

irq_endline_keep_white:
        ; In the full white frame; schedule line 0 of the next frame to stop it.
        lda #$01
        sta irq_phase
        jsr schedule_irq_line0

irq_done:
        lda #$01
        sta $d019               ; acknowledge raster IRQ
        jmp $ea81

;--------------------------
; One-frame A/V pop
;--------------------------
av_pop_start:
        lda #$37
        sta $01                 ; ensure I/O visible

        lda #$01
        sta $d020               ; border white
        sta $d021               ; background white

        lda #$0f
        sta $d418               ; SID volume max

        lda #$28
        sta $d400               ; voice 1 freq lo
        lda #$00
        sta $d401               ; voice 1 freq hi
        lda #%00010001          ; triangle waveform + gate on
        sta $d404
        rts

av_pop_stop:
        lda #$37
        sta $01

        lda #%00010000          ; triangle, gate off
        sta $d404
        lda #$00
        sta $d418               ; volume off
        sta $d020               ; border black
        sta $d021               ; background black
        rts

;--------------------------
; IRQ scheduling helpers
;--------------------------
schedule_irq_line0:
        lda #$00
        sta $d012
        lda $d011
        and #%01111111
        sta $d011
        rts

schedule_irq_end_line:
        lda end_line_low
        sta $d012
        lda $d011
        and #%01111111
        ora end_line_high
        sta $d011
        rts

;--------------------------
; Detect PAL vs NTSC and compute end-of-frame line (max_raster-2)
;--------------------------
detect_video_standard:
        lda #$00
wait_raster0:
        cmp $d012
        bne wait_raster0
wait_raster1:
        lda $d012
        beq wait_raster1

wait_high_bit:
        lda $d011
        bpl wait_high_bit

check_pal:
        lda $d012
        cmp #$20
        bcs set_pal
        lda $d011
        bmi check_pal

        ; NTSC: end_line = 260 (0x104)
        lda #$04
        sta end_line_low
        lda #$80
        sta end_line_high
        rts

set_pal:
        ; PAL: end_line = 309 (0x135)
        lda #$35
        sta end_line_low
        lda #$80
        sta end_line_high
        rts

; Variables
flash_active:  .byte 0
irq_phase:     .byte 0
space_was_down: .byte 0
end_line_low:  .byte $00
end_line_high: .byte $00
