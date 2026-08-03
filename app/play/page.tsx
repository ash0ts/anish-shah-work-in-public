import type { Metadata } from "next";
import { PersonalStreams } from "@/components/PersonalStreams";
import {
  getPublicConnectorSnapshot,
  getSpotifyPublicFallback,
} from "@/lib/server/connectors";
import { getPublicContentView } from "@/lib/server/public-content";
import { publicPageMetadata } from "@/lib/seo";
import styles from "./play.module.css";
import {
  activePreviewFixtureRuntime,
  previewFixtureScenario,
} from "@/lib/server/preview-connector-fixtures";
import { streamIdFromValue } from "@/components/play/connector-model";
import { hasPublicQuery } from "@/lib/seo";

export const dynamic = "force-dynamic";

const playDescription =
  "Explore Anish Shah’s anime, reading, music, physical-media, gaming, and movement collections through bounded public snapshots.";

type PlaySearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<PlaySearchParams>;
}): Promise<Metadata> {
  const query = await searchParams;
  return publicPageMetadata({
    title: "Play",
    description: playDescription,
    path: "/play",
    noindex: hasPublicQuery(query),
  });
}

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<PlaySearchParams>;
}) {
  const query = await searchParams;
  const initialStream = streamIdFromValue(query.stream);
  const fixture = activePreviewFixtureRuntime()
    ? previewFixtureScenario(
        new URLSearchParams(
          typeof query.fixture === "string" ? { fixture: query.fixture } : {},
        ),
      )
    : undefined;
  const [{ bundle }, spotifySnapshot, spotifyFallback] = await Promise.all([
    getPublicContentView(),
    getPublicConnectorSnapshot("spotify"),
    getSpotifyPublicFallback(),
  ]);
  const narrative = bundle.narratives.find(
    (entry) => entry.id === "narrative:play:personal-streams",
  );
  const spotifyTracks =
    spotifySnapshot.status === "ready"
      ? noScriptSpotifyTracks(spotifySnapshot.payload)
      : [];
  const spotifyProfileUrl =
    spotifySnapshot.status === "ready" &&
    typeof spotifySnapshot.payload.profileUrl === "string"
      ? spotifySnapshot.payload.profileUrl
      : spotifyFallback.profileUrl;
  const spotifyFallbackUrl = spotifyFallback.fallbackEmbed
    ? `https://open.spotify.com/${spotifyFallback.fallbackEmbed.kind}/${encodeURIComponent(spotifyFallback.fallbackEmbed.spotifyId)}`
    : null;

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <header className={styles.intro}>
        <p className={styles.eyebrow}>
          Play · six optional public streams · pattern / gallery / groove
        </p>
        <h1>Outside the work.</h1>
        <p>
          {narrative?.body ??
            "Watch, read, listen, collect, play, and move—published from owner-controlled snapshots and consent-gated embeds."}{" "}
          A physical-media catalog joins the index only when Collect is opened.
        </p>
      </header>
      <PersonalStreams
        fixture={fixture}
        initialStream={initialStream}
        spotifyNoScript={
          <div className={styles.spotifyNoScript}>
            <p>
              Spotify-calculated Top Tracks for the last approximately four
              weeks, in returned order—not play counts.
            </p>
            {spotifyTracks.length ? (
              <ol>
                {spotifyTracks.map((track) => (
                  <li key={`${track.id}:${track.position}`}>
                    <span>{String(track.position).padStart(2, "0")}</span>
                    <a
                      href={`https://open.spotify.com/track/${encodeURIComponent(track.id)}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {track.title}
                    </a>
                    <small>{track.artists}</small>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No public Top Tracks snapshot is available.</p>
            )}
            {spotifyFallbackUrl ? (
              <p>
                <a href={spotifyFallbackUrl} rel="noreferrer" target="_blank">
                  Open the owner-selected Spotify {spotifyFallback.fallbackEmbed?.kind}
                </a>
              </p>
            ) : null}
            {spotifyProfileUrl ? (
              <p>
                <a href={spotifyProfileUrl} rel="noreferrer" target="_blank">
                  Open Spotify profile
                </a>
              </p>
            ) : null}
          </div>
        }
      />
    </main>
  );
}

type NoScriptSpotifyTrack = {
  id: string;
  position: number;
  title: string;
  artists: string;
};

function noScriptSpotifyTracks(
  payload: Record<string, unknown>,
): NoScriptSpotifyTrack[] {
  const windows = payload.windows;
  if (!isRecord(windows)) return [];
  const shortTerm = windows.short_term;
  if (!isRecord(shortTerm) || !Array.isArray(shortTerm.tracks)) return [];

  return shortTerm.tracks.slice(0, 12).flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const id = typeof value.id === "string" ? value.id : "";
    const title = typeof value.title === "string" ? value.title : "";
    const artists = Array.isArray(value.artists)
      ? value.artists
          .flatMap((artist) =>
            isRecord(artist) && typeof artist.name === "string"
              ? [artist.name]
              : [],
          )
          .join(", ")
      : "";
    if (!/^[A-Za-z0-9]{22}$/.test(id) || !title || !artists) return [];
    return [
      {
        id,
        position:
          typeof value.position === "number" &&
          Number.isSafeInteger(value.position) &&
          value.position > 0
            ? value.position
            : index + 1,
        title,
        artists,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
