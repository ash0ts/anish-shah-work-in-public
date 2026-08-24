import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { HomeTopicIcon } from "@/components/HomeVisualIcons";
import { aboutCareerPhases } from "@/lib/about-career";
import { aboutSpeakerProfileFrom } from "@/lib/about-speaker";
import { SITE_COPY } from "@/lib/copy";
import { requestCspNonce } from "@/lib/server/csp";
import { getPublicContentView } from "@/lib/server/public-content";
import {
  absoluteSiteUrl,
  buildAboutStructuredData,
  publicPageMetadata,
  safeJsonLd,
} from "@/lib/seo";
import { AboutSpeakerCopyButton } from "./AboutSpeakerCopyButton";
import styles from "./about.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata({
  title: SITE_COPY.about["seo-title"],
  description: SITE_COPY.about["seo-description"],
  path: "/about",
  type: "profile",
});

function publicLinkedInUrl(
  links: readonly { label: string; href: string }[],
): string | null {
  const candidate = links.find(
    ({ label }) => label.trim().toLowerCase() === "linkedin",
  );
  if (!candidate) return null;

  try {
    const url = new URL(candidate.href);
    return url.protocol === "https:" &&
      (url.hostname === "linkedin.com" || url.hostname === "www.linkedin.com") &&
      url.pathname.startsWith("/in/")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export default async function AboutPage() {
  const nonce = await requestCspNonce();
  const { bundle } = await getPublicContentView();
  const phases = aboutCareerPhases();
  const speakerProfile = aboutSpeakerProfileFrom(bundle);
  const linkedinUrl = publicLinkedInUrl(bundle.profile.links);
  const profileUrl = absoluteSiteUrl("/about");
  const speakerProfileText =
    speakerProfile.topics.length > 0
      ? [
          SITE_COPY.about["speaker-bio"],
          "",
          SITE_COPY.about["speaker-topics-heading"],
          ...speakerProfile.topics.map((topic) => `• ${topic.label}`),
          ...(linkedinUrl
            ? [
                "",
                `${SITE_COPY.about["speaker-linkedin-cta"]}: ${linkedinUrl}`,
              ]
            : []),
        ].join("\n")
      : "";
  const structuredData = buildAboutStructuredData(
    profileUrl,
    SITE_COPY.about["seo-title"],
    SITE_COPY.about["seo-description"],
  );

  return (
    <main id="main" className={`site-main ${styles.page}`}>
      <script
        nonce={nonce}
        suppressHydrationWarning
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(structuredData) }}
      />

      <header className={styles.introduction}>
        <div className={styles.thesis}>
          <p className={styles.eyebrow}>{SITE_COPY.about.eyebrow}</p>
          <h1>{SITE_COPY.about.headline}</h1>
        </div>
        <div className={styles.profileCopy}>
          <p>{SITE_COPY.about.body}</p>
          <p>{SITE_COPY.about["current-focus"]}</p>
          <div className={styles.actions}>
            <Link className={styles.primaryAction} href="/work" prefetch={false}>
              {SITE_COPY.about["work-cta"]}
              <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </header>

      <section className={styles.career} aria-labelledby="career-title">
        <header className={styles.careerHeading}>
          <h2 id="career-title">{SITE_COPY.about["career-heading"]}</h2>
        </header>
        <ol className={styles.chronology}>
          {phases.map((phase) => (
            <li className={styles.phase} key={phase.id}>
              <p className={styles.period}>{phase.period}</p>
              <span
                aria-hidden="true"
                className={styles.employerMark}
                data-artwork={phase.mark.asset ? "true" : undefined}
              >
                {phase.mark.asset ? (
                  <Image
                    alt=""
                    height={phase.mark.asset.height}
                    loading="lazy"
                    sizes="144px"
                    src={phase.mark.asset.assetPath}
                    unoptimized
                    width={phase.mark.asset.width}
                  />
                ) : (
                  phase.mark.label
                )}
              </span>
              <div className={styles.phaseCopy}>
                <h3>{phase.organization}</h3>
                <p className={styles.track}>{phase.track}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {speakerProfile.topics.length > 0 ? (
        <section className={styles.speaker} aria-labelledby="speaker-title">
          <header className={styles.speakerHeading}>
            <p className={styles.eyebrow}>
              {SITE_COPY.about["speaker-eyebrow"]}
            </p>
            <h2 id="speaker-title">{SITE_COPY.about["speaker-heading"]}</h2>
          </header>

          <div className={styles.speakerProfile}>
            <div className={styles.speakerSelection}>
              <p className={styles.speakerBio}>
                {SITE_COPY.about["speaker-bio"]}
              </p>

              <div className={styles.speakerTopics}>
                <h3>{SITE_COPY.about["speaker-topics-heading"]}</h3>
                <ul className={styles.topicList}>
                  {speakerProfile.topics.map((topic) => (
                    <li key={topic.id}>
                      <Link
                        className={styles.topicLink}
                        href={topic.href}
                        prefetch={false}
                      >
                        <HomeTopicIcon
                          className={styles.topicIcon}
                          topicId={topic.id}
                        />
                        <span>{topic.label}</span>
                        <span aria-hidden="true">↗</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className={styles.speakerActions}>
                <AboutSpeakerCopyButton
                  className={styles.copyButton}
                  label={SITE_COPY.about["speaker-copy-cta"]}
                  profileText={speakerProfileText}
                  statusClassName={styles.speakerStatus}
                />
                {linkedinUrl ? (
                  <a
                    className={styles.speakerLinkedIn}
                    href={linkedinUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <span className={styles.speakerLinkedInLabel}>
                      {SITE_COPY.about["speaker-linkedin-cta"]}
                      <span
                        aria-hidden="true"
                        className={styles.speakerLinkedInArrow}
                      >
                        ↗
                      </span>
                    </span>
                    <span className={styles.speakerLinkedInUrl}>
                      {linkedinUrl}
                    </span>
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
