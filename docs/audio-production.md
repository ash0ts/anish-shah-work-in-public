# Experience audio production

The Play room and Meet Me simulation share one optional, consent-gated audio
surface. Sound is flavor and feedback; it never carries required information,
changes scoring, or replaces a visible status.

## Runtime contract

- The root `ExperienceAudioProvider` is visible only on `/play/**` and
  `/simulation/**`.
- Audio starts only after the visitor presses **Sound on**. There is no
  autoplay, persisted consent, hidden iframe, or route-triggered unlock.
- Tone.js is dynamically imported from that button handler. It must not enter
  the initial Home, Work, Play, or Simulation bundle.
- Turning sound off immediately disposes the Web Audio graph. Leaving the site
  also disposes it.
- Mounting an official Spotify iframe lowers the experience bus from -18 dB to
  -42 dB over 120 ms. Closing or unmounting the iframe restores it over the
  same interval. This handoff does not inspect or infer Spotify playback.
- An unavailable audio context degrades to a short status message; every route
  and interaction remains usable.
- Motion preferences and sound consent are independent. Reduced motion may
  shorten a visual transition without enabling or disabling sound.

The checked-in source of truth is
`content/presentation/experience-audio.v1.json`. It contains 43 deliberately
quiet procedural placeholder cues. The strict validator requires the complete
slot set so a later composition pass can replace sounds without renaming the
gameplay contract.

### Cue-placement registry

| Surface | Cue slots | Placement status |
| --- | --- | --- |
| Shared room | `sound-on`, `room-enter`, `interface-confirm`, `interface-return` | Active in the shared provider and room platform. |
| Watch · Midnight Broadcast | `watch-power`, `watch-tune`, `watch-select` | Reserved for screen-level placement. |
| Read · Borrowed Shelf | `read-page`, `read-select` | Reserved for screen-level placement. |
| Listen · Pocket Player | `listen-boot`, `listen-nav`, `listen-open-close` | Active on boot, bounded navigation, and official-player open/close. |
| Collect · Crate Archive | `collect-crate`, `collect-sleeve`, `collect-select` | Reserved for screen-level placement. |
| Play · Desktop Library | `play-computer-boot`, `play-load`, `play-select` | Reserved for screen-level placement. |
| Move · Cardio Television | `move-belt`, `move-tv`, `move-status` | Reserved for screen-level placement. |
| Room-to-mind reveal | `simulation-reveal`, `memory-wafer`, `robot-arrival`, `robot-squash`, `robot-bite`, `robot-swallow`, `robot-crt-open`, `robot-mind-dive` | `simulation-reveal` is active; the detailed robot beats are reserved for the final authored timeline. |
| Simulation progression | `simulation-boot`, `simulation-act-1`, `simulation-act-2`, `simulation-act-3`, `simulation-boss` | Active only on stable wave-entry states. |
| Simulation interaction | `simulation-near-miss`, `simulation-hit`, `simulation-evidence`, `simulation-action`, `simulation-dialogue-ready`, `simulation-fallback` | Active on trusted state-machine and arena events, never raw model output. |
| Simulation resolution | `simulation-victory`, `simulation-recalibrate`, `simulation-ending` | Active on the boss result, deterministic reset, and ending state. |

“Reserved” is intentional: the cue IDs and safe placeholders exist now, but a
screen or game component must not fire them until it has one deterministic,
visible state transition to own the cue. Model text, generated tokens, pointer
movement, hover, and animation frames are not valid audio triggers.

Components request cues through `useExperienceAudio().playCue(id)`. They must
not import Tone.js, construct their own audio contexts, or schedule unregistered
cue names.

## Validate and build

From the repository root:

```bash
node scripts/validate-experience-audio.mjs
node scripts/build-experience-audio.mjs /tmp/anish-experience-audio
```

Validation is strict: unknown fields, unsupported voices, unsafe gain, malformed
notes, excessive event counts, or out-of-order timing fail the build. The build
command writes a canonical manifest and deterministic SHA-256 content hash. The
default `dist/experience-audio` output is generated and must not be hand-edited.

Before release, also confirm:

1. The initial `/play` and `/simulation` network traces contain no Tone.js
   request.
2. One explicit **Sound on** press requests Tone.js and produces one quiet cue.
3. **Sound off** stops subsequent cues without a reload.
4. Loading an official Spotify iframe ducks the experience bus; closing it
   restores the configured master level without attempting to detect playback.
5. Keyboard and screen-reader users receive the same visible and announced
   interaction states with sound disabled.
6. No provider data, account identifiers, query strings, or visitor interaction
   history are present in the audio manifest or logs.

## Replacing procedural placeholders

The v1 manifest is intentionally production-safe, not final composition. A
future audio asset PR may replace or layer cues only after a provenance and
performance review.

Preferred delivery package:

- 48 kHz, 24-bit WAV masters for archive and review.
- Browser deliverables in first-party, content-hashed Opus and AAC variants.
- One dry stem per cue plus a cue sheet naming the exact interaction.
- A signed license/provenance record for every sample, instrument, performer,
  and sound library.
- No recognizable copyrighted game, anime, television, console, or operating
  system sounds.
- No remote audio host, streaming SDK, tracking pixel, or analytics callback.

Production targets:

- Keep short UI cues under roughly 700 ms unless the transition itself is
  longer.
- Leave at least 6 dB of true-peak headroom per rendered cue before the runtime
  master gain.
- Avoid sudden broadband transients, sub-bass-heavy hits, and repeated loops.
- Keep the complete first-party audio payload small enough to load only after
  consent; do not preload inactive cues.
- Test laptop speakers, headphones at low volume, Safari/iOS, Chrome, and a
  suspended or denied audio context.

Any future sample renderer should generate a separate, validated asset manifest
from the same cue IDs. It must reject unregistered files and must not make audio
essential to navigation or comprehension.

## Adding a cue safely

1. Add the cue to `experience-audio.v1.json` using the existing bounded event
   contract.
2. Run the validator and focused audio tests.
3. Add the cue ID to the registry above and describe one semantic interaction.
4. Call `playCue` only from a user-visible interaction or its direct transition.
5. Verify that repeated activation cannot overlap into an uncomfortable level.
6. Include bundle evidence proving Tone.js remains deferred.

The current procedural act motifs are temporary music placeholders. Longer or
looping replacements must use the same consent gate, bus limits, visibility
pause, and documented provenance workflow. Do not add autoplay,
audio-reactive visuals, microphone input, Web Audio analysis, or behavioral
audio telemetry without a separate privacy, accessibility, and performance
RFC.
