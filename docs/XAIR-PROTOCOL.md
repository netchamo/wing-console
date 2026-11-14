# X-Air protocol notes (XR12 / XR16 / XR18, MR12 / MR18)

Collected in November 2026 from the official "X AIR Mixer Series Remote Control Protocol"
(firmware 1.11+), the community command list (`X-AirCmdList`, also on the behringer.world wiki)
and two open-source clients that are used with real mixers (Companion's `behringer-xair`
module, `xair-api-python`). **Nothing here was checked on the user's own XR16 yet** – items marked
`VERIFY` must be confirmed with the mixer report (Settings → "דוח מיקסר").

## Transport

- OSC over **UDP port 10024**. Replies go back to the sender's IP/port. No bundles.
- Floats are always **0.0 … 1.0** (normalized); ints are signed 32-bit; booleans are ints;
  strings NUL-terminated; everything big-endian and padded to 4 bytes.
- **Get** = the address with no arguments → the mixer answers with the same address and the value.
- **Set** = the address with one argument. The mixer does **not** echo a set back to the sender.
- `/xremote` (no args): the mixer then pushes every parameter change to this client, for
  **10 seconds**. Up to 8 clients. The app renews every 3 s.
- `/xinfo` (no args) → `/xinfo ,ssss  ip, name, model, firmware` (e.g. `XR16`, `1.18`).
  Sent to the broadcast address it finds every X-Air on the network → model auto-detect.
- `/status` → `active|standby`, ip, name.

## Meters

Subscribe: `/meters ,si "/meters/<id>" 0` (renew within 10 s). Answer: address `/meters/<id>`,
one blob: **little-endian** int32 count, then count × int16 (little-endian), unit **1/256 dB**.

| id | values |
|----|--------|
| 0 | one channel (arg = channel): pre L/R, gate GR, comp GR, post L/R, gate key, comp key |
| 1 | 40: 16 ch · aux L/R · FX rtn 4×L/R · 6 bus · 4 FX send (pre) · main L/R (post) · monitor L/R |
| 2 | 36: 16 mic in · 2 aux in · 18 USB in |
| 3 | 56: 4 × (2 in, 10 FX state, 2 out) |
| 4 | 100: RTA bins |
| 5 | 44: 6 aux out · main L/R · 16 P16 · 18 USB · phones L/R |
| 6 | 39: 16 gate GR · 16 ch comp GR · 6 bus comp GR · LR comp GR |
| 7 | 16 automix gains |
| 8 | 4 DCA |
| 9 | 4: recorder in L/R, player out L/R |

The app uses `/meters/1` for the mixer screen.

## Models

| model | inputs | buses | stick recorder/player | `/rtn/aux` is |
|-------|--------|-------|-----------------------|---------------|
| XR18 / X18 / MR18 | 16 (+ aux in 17/18) | 6 | **no** (18×18 USB audio instead) | Aux in 17/18 |
| XR16 | 16 (8 mic + 8 line) | 4 `VERIFY` | **yes** | USB player return |
| XR12 / MR12 | 12 (4 mic + 8 line) | 2 `VERIFY` | **yes** | USB player return |

`VERIFY` the bus count: some documents say every model has six internal buses. The app shows the
model's default and the mixer report probes buses 5–6 to settle it.

## Strips

| strip | base | fader | mute (`on`: 1 = open) | pan | solo switch `/-stat/solosw/NN` |
|-------|------|-------|------|-----|------|
| channel 1–16 | `/ch/01`…`/ch/16` | `mix/fader` | `mix/on` | `mix/pan` | 01–16 |
| aux / USB return | `/rtn/aux` | `mix/fader` | `mix/on` | `mix/pan` | 17 |
| FX return 1–4 | `/rtn/1`… | `mix/fader` | `mix/on` | `mix/pan` | 18–21 |
| bus 1–6 | `/bus/1`… | `mix/fader` | `mix/on` | `mix/pan` | 40–45 |
| FX send 1–4 | `/fxsend/1`… | `mix/fader` | `mix/on` | – | 46–49 |
| main LR | `/lr` | `mix/fader` | `mix/on` | `mix/pan` | 50 |
| DCA 1–4 | `/dca/1`… | `fader` | `on` | – | 51–54 |

- Name `config/name` (string), colour `config/color` (0–15: OFF RD GN YE BL MG CY WH, +8 = inverted).
  X-Air has **no icons**.
- Sends: `<base>/mix/NN/level` (+ `pan`, `tap`, `grpon`), NN = 01–06 buses, 07–10 FX sends.
  `VERIFY` the numbering on XR16 (4 buses).
- `/-stat/solo` = any solo active; `/-action/clearsolo` clears all.

## Value curves (float 0..1 ↔ shown value)

| value | steps | law |
|-------|-------|-----|
| fader (strip, DCA, FX send, bus master) | 1024 | 4 segments: ≥0.5 → 40f−30 dB · ≥0.25 → 80f−50 · ≥0.0625 → 160f−70 · else 480f−90 (0 = −∞) |
| send level, phones level | 161 | same law |
| pan | 101 | linear −100…+100 |
| EQ freq / filter freq | 201 | log 20…20000 Hz |
| EQ gain | 121 | linear −15…+15 dB |
| EQ Q | 72 | log 10…0.3 |
| low cut `preamp/hpf` | 101 | log 20…400 Hz (`VERIFY`: one list says 20…200) |
| head amp gain | 145 | linear −12…+60 dB (line inputs: −12…+20, 65 steps) |
| gate thr −80…0 · range 3…60 · attack 0…120 ms | lin | hold 0.02…2000 ms, release 5…4000 ms are log |
| comp thr −60…0 · knee 0…5 · makeup 0…24 dB · mix 0…100 % | lin | ratio is an enum of 12 |

The app keeps the **raw float from the mixer** and converts only for display. A value is written
only from a hand gesture, quantized to the step grid – never from a displayed/converted value.

## USB stick recorder / player (XR16, XR12 only)

- `/-stat/usbmounted` 0/1.
- `/-stat/tape/state` 0 STOP · 1 PLAY PAUSE · 2 PLAY · 3 REC PAUSE · 4 REC · 5 FF · 6 REW.
- `/-stat/tape/file` (string), `/-stat/tape/etime` seconds elapsed, `/-stat/tape/rtime` seconds
  left (negative while recording = −(dropouts+1)).
- Browser: `/-stat/usb/path` (get/set directory), `/-stat/usb/count`, `/-stat/usb/001/name`,
  `/-stat/usb/001/type` (0 file, 1 folder). `/-prefs/playnext` = play the next file automatically.
- Files: FAT32 stick, WAV 16-bit at the mixer's rate (44.1/48 kHz), about 3 h / 2 GB per file.
- Meters: `/meters/9`. The player's sound comes back on the `/rtn/aux` strip.

## Other groups (for the next stages)

`/ch/NN/preamp` (hpf, hpon, invert, rtnsw, rtntrim) · `/headamp/NN` (gain, phantom) ·
`/ch/NN/gate` · `/ch/NN/dyn` · `/ch/NN/eq` (4 bands; buses and LR 6 bands + `eq/mode` PEQ/GEQ/TEQ,
`geq`) · `/ch/NN/insert` (on, fxslot) · `/ch/NN/automix` · `/ch/NN/grp` (dca, mute bit masks) ·
`/fx/1..4` (`type` 0–60, `par/01..`, `insert`) · `/config` (chlink, buslink, mute groups, solo/
phones) · `/routing` (aux, main, p16, usb) · `/-snap` (64 snapshots) · `/-prefs` (network, clock
rate, name).

## How the app talks to the mixer

- The Android side is a plain UDP pipe (`XAirLink.kt`): the page builds and reads the OSC bytes
  itself, so protocol fixes arrive as a web update, without reinstalling the APK.
- Two locks keep it read-only until LIVE is on: the page's `set()` and the native pipe, which
  drops every packet that carries a value (except subscriptions) while live is off.
- Search: `/xinfo` to the last known address, to `192.168.1.1` (the mixer's own access point) and
  to every local broadcast address; the first known mixer that answers is connected, the model is
  taken from the answer and remembered.
