import type { Metadata } from "next";
import { headers } from "next/headers.js";
import { notFound } from "next/navigation.js";
import {
  isLocalDevelopmentRequest,
  safeAuthReturnPath,
} from "@/app/chatgpt-auth";
import styles from "../studio.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Local Studio setup · Anish Shah",
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ return_to?: string }>;
};

export default async function LocalStudioSetupPage({
  searchParams,
}: PageProps) {
  const requestHeaders = await headers();
  if (!isLocalDevelopmentRequest(requestHeaders)) notFound();

  const query = await searchParams;
  const returnTo = safeAuthReturnPath(query.return_to ?? "/studio");

  return (
    <main className={styles.shell}>
      <div className={styles.topline}>
        <span className={styles.wordmark}>AS / Local Studio</span>
        <span className={styles.localTag}>Access remains locked</span>
      </div>

      <section className={styles.notice}>
        <span>Local setup required</span>
        <h1>Configure the loopback-only owner.</h1>
        <p>
          The development server is working, but it will not grant Studio
          access until <code>LOCAL_OWNER_EMAIL</code> exactly matches an address
          in <code>OWNER_EMAILS</code>. This diagnostic page never authenticates
          you by itself.
        </p>
        <pre>
          <code>{`cd anish-site
test -f .env.local || cp .env.example .env.local
openssl rand -base64 32
# Put that local-only value in CONNECTOR_ENCRYPTION_KEY.
# Set the same email in OWNER_EMAILS and LOCAL_OWNER_EMAIL.
npm run dev:studio`}</code>
        </pre>
        <p>
          Restart the server after editing <code>.env.local</code>, then{" "}
          <a href={returnTo}>continue to the protected Studio</a>.
        </p>
      </section>
    </main>
  );
}
