import Link from "next/link";
import { publicBundle } from "@/lib/content";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-lead">
        <span className="utility-label">Anish Shah · New York</span>
        <p>Build the thing. Teach the thing. Put the work in public.</p>
      </div>
      <nav className="footer-links" aria-label="Public profiles">
        {publicBundle.profile.links.slice(0, 5).map((link) => (
          <a href={link.href} key={link.href} rel="noreferrer" target="_blank">
            {link.label} <span aria-hidden="true">↗</span>
          </a>
        ))}
      </nav>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Anish Shah</span>
        <span>Public work, carefully attributed.</span>
        <Link href="/privacy">Privacy</Link>
        <Link href="/studio">Owner studio</Link>
      </div>
    </footer>
  );
}
