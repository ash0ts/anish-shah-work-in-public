import Link from "next/link";

const navigation = [
  ["Work", "/work"],
  ["Play", "/play"],
  ["About", "/about"],
  ["Sources", "/sources"],
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="wordmark" href="/">
        <span>Anish—Shah</span>
        <i aria-hidden="true" />
      </Link>
      <nav className="primary-nav" aria-label="Primary navigation">
        {navigation.map(([label, href]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
      </nav>
      <Link className="header-index-link" href="/work">
        Public index <span aria-hidden="true">↗</span>
      </Link>
      <details className="mobile-menu">
        <summary>Menu</summary>
        <nav aria-label="Mobile navigation">
          {navigation.map(([label, href]) => (
            <Link key={href} href={href}>
              {label}
            </Link>
          ))}
        </nav>
      </details>
    </header>
  );
}
