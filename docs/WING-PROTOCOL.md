# Talking to the WING: what this app uses and why

Notes gathered while building the app, with the source for each point.

## Console settings

- **Setup → Remote → Remote lock** must be **OFF for OSC** (and for TCP, if the native link
  should ever write). With the lock on, the console answers every query but silently ignores
  every change: the app reads the desk perfectly and "the fader did not move".
  Sources: Mixing Station WING docs ("disabled for tcp … otherwise the app will be in read-only
  mode"); behringer-wing-mcp README ("if this stays ON … mute/fader changes do nothing").

## Discovery (UDP 2222)

Send the 5 bytes `WING?` to the subnet broadcast (and 255.255.255.255) on UDP 2222.
Reply: `WING,<ip>,<name>,<model>,<serial>,<firmware>`. Source: libwing Discovery.md.

The app searches on every local network the phone has and binds each socket to the network
whose address range contains the mixer. A phone on a Wi-Fi without internet sends normal
traffic over mobile data; an unbound socket would never reach the mixer.

## OSC (UDP 2223)

- Read: send the address alone (no type tag). Reply `,sff` (text, raw 0..1, value) for floats,
  `,sfi` for ints, `,s` for strings.
- Write: `/ch/2/fdr ,f -3.0` (dB). Ints: `/ch/1/mute ,i 1`. Strings: `,s`.
  Node form: `/ch/1 ,s "fdr=4,mute=1"` returns `OK` or an error string.
- The console does **not** echo single-value writes; it only answers on error.
- Subscription: `/*S`, renewed every ~9 s (one subscriber at a time; it dies after 10 s).
  Source: Bitfocus Companion WING module (connection-handler.ts).
- Display names/colours as shown on the desk: `/ch/N/$name`, `/ch/N/$col`; solo `/ch/N/$solo`.
- No meters over OSC.

## Native protocol (TCP 2222 + UDP for meters)

Used by Behringer's own apps; binary, escape byte `0xDF`. This app uses it only for meters
(read only). Layout from libwing `console.rs`:

| purpose | bytes |
|---|---|
| keep-alive | `DF D1` every 7 s |
| meter request | `DF D3 D3 pp pp D4 ii ii pp pp DC {group n}… DE DF D1` |
| meter keep-alive | `DF D3 D4 ii ii pp pp DF D1` every 3 s per id |
| meter packet (UDP) | `ii ii ?? ??` then int16 BE, 8 per strip; `[2]`,`[3]` = L/R in 1/256 dB |

Groups: `A0` channel (0-based), `A1` aux, `A2` bus, `A3` main, `A4` matrix, `A5` DCA,
`A6` FX, `A7` source, `A8` output, `A9` monitor, `AA` RTA.

## Parameter map

`wing-params.json` holds ranges and options for one strip of each kind (`/ch/1/…`, `/aux/1/…`,
`/bus/1/…`, `/main/1/…`, `/mtx/1/…`, `/dca/1/…`), the inputs (`/io/in/LCL/1/…`, `/io/in/A/1/…`),
the player and recorder (`/play/…`, `/rec/…`). Extracted from libwing's `propmap.jsonl`
(firmware 3.0.5). Newer firmware can add options; the native protocol can ask the console for
its own definitions when exact lists matter.

Highlights used by the screens:

- Gain lives on the input: local inputs `-2.5…45 dB` in 2.5 dB steps; AES50 `-3…45.5` in 0.5 dB
  steps. The channel mirrors its active source's gain and phantom at `/ch/N/in/set/$g`, `$vph`.
- Main/Alt: `/ch/N/in/conn/{grp,in,altgrp,altin}`, switch `/ch/N/in/set/altsrc`.
- Channel input: trim ±18, balance ±9, phase `inv`, delay `dlyon` + `dly` (0.1–150 m) with
  `dlymode` M / FT / MS / SMP, input mode M / ST / M/S.
- Filters: `flt/lc` + `lcf` 20–2000 Hz + slope 6/12/18/24; `flt/hc` + `hcf` 50–20000 + slope 6/12;
  tool filter TILT / MAXER / AP 90 / AP 180.
- EQ (STD): bands L, 1–4, H; gain ±15, Q 0.44–10; L/H can be PEQ or shelving.
- Gate (GATE): thr −80…0, range 3–60, att 0–120, hold 1–200, rel 4–4000 (log), accent 0–100 %,
  ratio 1:1.5 / 1:2 / 1:3 / 1:4 / gate. Key: `gatesc/type` OFF / LP12 / HP12 / BP, `f`, `q`,
  `src` SELF / CH.n…, `tap` IN / FILT / 3 / 4 / 5 / PFL / AFL / POST.
- Dynamic EQ in the gate slot (`gate/mdl = DEQ`): thr, ratio 1.2–10:1, att, rel, gain ±15,
  freq, Q, filter, mode below/above.
- Compressor (COMP): thr −60…0, ratio list, knee 0–5, detector PEAK/RMS, att, hold, rel,
  envelope LIN/LOG, auto; plus `dyn/mix` and `dyn/gain`.
- Sends: `send/N/{on,lvl,pon,mode,plink,pan}`; mode PRE / POST / GRP (the "send vs group" choice).
- Recorder: `/rec/$action` (STOP/REC/PAUSE/NEWFILE), `channels` 2/4, `resolution` 16/24;
  player `/play/$action`, `$pos`, `$total`, song/artist, `repeat`.
