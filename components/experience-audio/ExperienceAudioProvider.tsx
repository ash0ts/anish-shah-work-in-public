"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import audioManifestJson from "@/content/presentation/experience-audio.v1.json";
import { startAudioWithinDeadline } from "./audio-start";
import styles from "./ExperienceAudioProvider.module.css";

type ExperienceCueId = keyof typeof audioManifestJson.cues;
type AudioStatus = "off" | "loading" | "on" | "unavailable";
type ExternalMediaSource = "spotify";

type ToneDestination = {
  dispose(): void;
};

type ToneGainNode = ToneDestination & {
  gain: {
    rampTo(value: number, rampSeconds: number, startTime?: number): void;
  };
  toDestination(): ToneGainNode;
};

type ToneVoice = {
  connect(destination: ToneDestination): ToneVoice;
  dispose(): void;
  triggerAttackRelease(
    note: string,
    duration: number,
    time: number,
    velocity: number,
  ): void;
};

type ToneModule = {
  Gain: new (gain: number) => ToneGainNode;
  MembraneSynth: new (options: Record<string, unknown>) => ToneVoice;
  Synth: new (options: Record<string, unknown>) => ToneVoice;
  dbToGain(value: number): number;
  now(): number;
  start(): Promise<void>;
};

type AudioRuntime = {
  master: ToneGainNode;
  tone: ToneModule;
  voices: Record<"chip" | "bass", ToneVoice>;
};

function isAudioVoiceId(value: string): value is keyof AudioRuntime["voices"] {
  return value === "chip" || value === "bass";
}

type ExperienceAudioContextValue = {
  enabled: boolean;
  playCue(id: ExperienceCueId): void;
  registerEmbeddedControl(): () => void;
  setExternalMediaActive(source: ExternalMediaSource, active: boolean): void;
  setEnabled(enabled: boolean): Promise<void>;
  status: AudioStatus;
};

const ExperienceAudioContext = createContext<ExperienceAudioContextValue | null>(
  null,
);

function createRuntime(tone: ToneModule, externalMediaActive: boolean): AudioRuntime {
  const master = new tone.Gain(
    tone.dbToGain(
      externalMediaActive
        ? audioManifestJson.externalMediaDuckDb
        : audioManifestJson.masterGainDb,
    ),
  ).toDestination();
  const chip = new tone.Synth({
    oscillator: { type: "square8" },
    envelope: { attack: 0.005, decay: 0.05, sustain: 0.06, release: 0.08 },
  }).connect(master);
  const bass = new tone.MembraneSynth({
    pitchDecay: 0.028,
    octaves: 3,
    oscillator: { type: "sine" },
    envelope: { attack: 0.002, decay: 0.16, sustain: 0, release: 0.16 },
  }).connect(master);
  return { master, tone, voices: { chip, bass } };
}

function applyExternalMediaGain(runtime: AudioRuntime, active: boolean) {
  runtime.master.gain.rampTo(
    runtime.tone.dbToGain(
      active
        ? audioManifestJson.externalMediaDuckDb
        : audioManifestJson.masterGainDb,
    ),
    0.12,
    runtime.tone.now(),
  );
}

function disposeRuntime(runtime: AudioRuntime | null) {
  if (!runtime) return;
  runtime.voices.chip.dispose();
  runtime.voices.bass.dispose();
  runtime.master.dispose();
}

function scheduleCue(runtime: AudioRuntime, id: ExperienceCueId) {
  if (document.hidden) return;
  const cue = audioManifestJson.cues[id];
  const start = runtime.tone.now() + 0.015;
  for (const event of cue.events) {
    if (!isAudioVoiceId(event.voice)) continue;
    runtime.voices[event.voice].triggerAttackRelease(
      event.note,
      event.durationSeconds,
      start + event.offsetSeconds,
      event.velocity,
    );
  }
}

function experiencePath(pathname: string): boolean {
  return (
    pathname === "/play" ||
    pathname.startsWith("/play/") ||
    pathname === "/simulation" ||
    pathname.startsWith("/simulation/")
  );
}

export function ExperienceAudioProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const visible = experiencePath(pathname);
  const runtime = useRef<AudioRuntime | null>(null);
  const externalMedia = useRef(new Set<ExternalMediaSource>());
  const requestEpoch = useRef(0);
  const [embeddedControlCount, setEmbeddedControlCount] = useState(0);
  const [status, setStatus] = useState<AudioStatus>("off");

  const registerEmbeddedControl = useCallback(() => {
    let registered = true;
    setEmbeddedControlCount((count) => count + 1);
    return () => {
      if (!registered) return;
      registered = false;
      setEmbeddedControlCount((count) => Math.max(0, count - 1));
    };
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    const epoch = ++requestEpoch.current;
    if (!enabled) {
      disposeRuntime(runtime.current);
      runtime.current = null;
      setStatus("off");
      return;
    }
    if (runtime.current) {
      setStatus("on");
      return;
    }
    setStatus("loading");
    try {
      // Tone and its Web Audio graph are requested only from this explicit
      // visitor gesture. Bound the complete import-and-start operation so a
      // slow chunk can never strand the shared control in its loading state.
      const imported = await startAudioWithinDeadline(async () => {
        const tone = (await import("tone")) as unknown as ToneModule;
        await tone.start();
        return tone;
      });
      if (epoch !== requestEpoch.current) return;
      const nextRuntime = createRuntime(imported, externalMedia.current.size > 0);
      runtime.current = nextRuntime;
      setStatus("on");
      scheduleCue(nextRuntime, "sound-on");
    } catch {
      if (epoch === requestEpoch.current) setStatus("unavailable");
    }
  }, []);

  const playCue = useCallback((id: ExperienceCueId) => {
    if (!runtime.current) return;
    scheduleCue(runtime.current, id);
  }, []);

  const setExternalMediaActive = useCallback(
    (source: ExternalMediaSource, active: boolean) => {
      const wasActive = externalMedia.current.has(source);
      if (active) externalMedia.current.add(source);
      else externalMedia.current.delete(source);
      if (wasActive === active || !runtime.current) return;
      applyExternalMediaGain(runtime.current, externalMedia.current.size > 0);
    },
    [],
  );

  useEffect(
    () => () => {
      requestEpoch.current += 1;
      disposeRuntime(runtime.current);
      runtime.current = null;
    },
    [],
  );

  useEffect(() => {
    if (visible || status === "off") return;
    requestEpoch.current += 1;
    disposeRuntime(runtime.current);
    runtime.current = null;
    const frame = requestAnimationFrame(() => setStatus("off"));
    return () => cancelAnimationFrame(frame);
  }, [status, visible]);

  useEffect(() => {
    const handleVisibility = () => {
      const current = runtime.current;
      if (!current) return;
      current.master.gain.rampTo(
        current.tone.dbToGain(
          document.hidden
            ? -96
            : externalMedia.current.size > 0
              ? audioManifestJson.externalMediaDuckDb
              : audioManifestJson.masterGainDb,
        ),
        document.hidden ? 0.03 : 0.12,
        current.tone.now(),
      );
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const value = useMemo<ExperienceAudioContextValue>(
    () => ({
      enabled: status === "on",
      playCue,
      registerEmbeddedControl,
      setExternalMediaActive,
      setEnabled,
      status,
    }),
    [playCue, registerEmbeddedControl, setEnabled, setExternalMediaActive, status],
  );

  return (
    <ExperienceAudioContext.Provider value={value}>
      {children}
      {visible && embeddedControlCount === 0 ? (
        <ExperienceAudioControl placement="global" />
      ) : null}
    </ExperienceAudioContext.Provider>
  );
}

export function ExperienceAudioControl({
  className,
  placement = "embedded",
}: {
  className?: string;
  placement?: "embedded" | "global";
}) {
  const { registerEmbeddedControl, setEnabled, status } = useExperienceAudio();

  useEffect(() => {
    if (placement !== "embedded") return;
    return registerEmbeddedControl();
  }, [placement, registerEmbeddedControl]);

  const label =
    status === "loading"
      ? "Starting sound…"
      : status === "unavailable"
        ? "Retry sound"
        : status === "on"
          ? "Sound off"
          : "Sound on";

  return (
    <div
      className={[styles.control, styles[`${placement}Control`], className]
        .filter(Boolean)
        .join(" ")}
      data-experience-audio-control
      data-experience-audio-placement={placement}
    >
      <button
        aria-label={label}
        aria-pressed={status === "on"}
        disabled={status === "loading"}
        onClick={() => void setEnabled(status !== "on")}
        type="button"
      >
        <span className={styles.longLabel}>{label}</span>
        <span aria-hidden="true" className={styles.shortLabel}>
          {status === "on" ? "OFF" : status === "loading" ? "…" : "SND"}
        </span>
      </button>
      <p
        aria-atomic="true"
        aria-live="polite"
        className={styles.status}
        role="status"
      >
        {status === "on"
          ? "Experience sound is on."
          : status === "unavailable"
            ? "Experience sound could not start. The experience remains fully usable without it."
            : status === "loading"
              ? "Starting experience sound."
              : "Experience sound is off."}
      </p>
    </div>
  );
}

export function useExperienceAudio(): ExperienceAudioContextValue {
  const value = useContext(ExperienceAudioContext);
  if (!value) {
    throw new Error(
      "Experience audio controls must be rendered inside ExperienceAudioProvider.",
    );
  }
  return value;
}

export function useExperienceAudioHandoff(
  source: ExternalMediaSource,
  active: boolean,
) {
  const { setExternalMediaActive } = useExperienceAudio();
  useEffect(() => {
    setExternalMediaActive(source, active);
    return () => setExternalMediaActive(source, false);
  }, [active, setExternalMediaActive, source]);
}

export type { ExperienceCueId, ExternalMediaSource };
