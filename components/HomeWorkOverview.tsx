import Link from "next/link";
import type { HomeIllustrationId, HomeWorkArea } from "@/lib/home-presentation";
import { SITE_COPY } from "@/lib/copy";
import styles from "./HomeWorkOverview.module.css";

// Illustrative objects, not product screenshots, telemetry, or measured results.
function WorkIllustration({ kind }: { kind: HomeIllustrationId }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 240 160" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path className={styles.baseline} d="M18 144h204" />
      {kind === "terminal" ? (
        <>
          <path className={styles.wash} d="M29 24h152v99H29z" />
          <rect x="24" y="18" width="152" height="104" rx="5" />
          <path d="M24 38h152M36 28h2m8 0h2m8 0h2M42 57l10 9-10 9m20 0h22M82 123v16m34-16v16m-47 0h60" />
          <rect className={styles.paper} x="133" y="78" width="77" height="54" rx="4" />
          <path d="M145 96h39m-39 9h24m-24 9h32M195 94v23m-4-8h8" />
          <path className={styles.accent} d="M90 61h51m-51 10h35" />
        </>
      ) : kind === "notebook" ? (
        <>
          <path className={styles.wash} d="M53 22h127v119H53z" />
          <path className={styles.paper} d="m48 17 126 9v113l-126-9z" />
          <path d="M68 19v113M42 33h13m-13 22h13m-13 22h13m-13 22h13m-13 22h13M82 43l8 7-8 6m18-5h35M83 72h66m-66 10h43" />
          <rect x="82" y="98" width="12" height="12" rx="1" />
          <path className={styles.accent} d="m84 104 3 3 6-7m9 4h37" />
          <path className={styles.paper} d="m184 49 10 4-29 74-10 12 1-17z" />
          <path d="m183 55 9 4m-36 63 9 5" />
        </>
      ) : kind === "study" ? (
        <>
          <path className={styles.wash} d="M48 23h113v116H48z" />
          <path className={styles.paper} d="M41 17h91l22 22v96H41z" />
          <path d="M132 17v22h22M58 49h50m-50 10h67M58 113h44" />
          <path className={styles.accent} d="M58 93h12V78h21v15h17V68h27" />
          <circle className={styles.paper} cx="153" cy="95" r="28" />
          <path d="m174 116 24 25m-19-30 24 25" />
          <path className={styles.accent} d="M135 99h10V85h13v14h13" />
          <path d="M175 39h24m-24 7h16M172 44l-9 9" />
        </>
      ) : (
        <>
          <path className={styles.wash} d="M30 24h139v82H30z" />
          <path className={styles.paper} d="M25 19h139v82H25z" />
          <path d="M21 15h147M95 102v27m0-10-18 20m18-20 18 20M41 38h45m-45 10h29" />
          <path className={styles.accent} d="m108 39 30 18-30 18zM42 79h41" />
          <rect className={styles.paper} x="181" y="66" width="17" height="34" rx="8.5" />
          <path d="M175 88v5a14.5 14.5 0 0 0 29 0v-5m-14.5 20v29m-14 0h28M185 74h9m-9 6h9" />
        </>
      )}
    </svg>
  );
}

export function HomeWorkOverview({ areas }: { areas: HomeWorkArea[] }) {
  return (
    <nav className={styles.overview} aria-labelledby="home-work-title" data-work-overview>
      <h2 id="home-work-title">{SITE_COPY.home["selected-heading"]}</h2>
      <ul className={styles.areas}>
        {areas.map((area) => (
          <li key={area.id} data-bucket={area.id}>
            <Link href={area.href} prefetch={false}>
              <WorkIllustration kind={area.illustrationId} />
              <span className={styles.label}>{area.title}<span aria-hidden="true">↗</span></span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
