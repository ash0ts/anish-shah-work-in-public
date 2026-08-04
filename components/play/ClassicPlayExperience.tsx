import { PersonalStreams } from "@/components/PersonalStreams";
import type {
  PreviewFixtureScenario,
  StreamId,
} from "@/components/play/connector-model";
import {
  getPublicConnectorSnapshot,
  getSpotifyPublicFallback,
} from "@/lib/server/connectors";
import { SITE_COPY } from "@/lib/copy";
import styles from "@/app/play/play.module.css";

export async function ClassicPlayExperience({
  fixture,
  initialStream = "watch",
}: {
  fixture?: PreviewFixtureScenario;
  initialStream?: StreamId;
} = {}) {
  const [spotifySnapshot, spotifyFallback] = await Promise.all([
    getPublicConnectorSnapshot("spotify"),
    getSpotifyPublicFallback(),
  ]);
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
        <p className={styles.eyebrow}>{SITE_COPY.play["intro-eyebrow"]}</p>
        <h1>{SITE_COPY.play["intro-title"]}</h1>
        <p>{SITE_COPY.play["intro-summary"]}</p>
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
              <p>No Top Tracks are available right now.</p>
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
                  {SITE_COPY.play["profile-spotify"]}
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
