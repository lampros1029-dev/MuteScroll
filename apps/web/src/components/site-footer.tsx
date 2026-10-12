import Link from "next/link";

import { CONTACT_EMAIL, SITE_NAME } from "../lib/site";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <div className="footer-brand">
          <p className="footer-name">{SITE_NAME}</p>
          <p className="footer-line">Read any video. Right in your AI chat.</p>
        </div>
        <nav aria-label="Footer" className="footer-nav">
          <ul>
            <li>
              <Link href="/try">Transcribe</Link>
            </li>
            <li>
              <Link href="/pricing">Pricing</Link>
            </li>
            <li>
              <Link href="/developers">Developers</Link>
            </li>
            <li>
              <Link href="/privacy">Privacy</Link>
            </li>
            <li>
              <Link href="/terms">Terms</Link>
            </li>
            <li>
              <Link href="/refunds">Refunds</Link>
            </li>
            <li>
              <Link href="/legal">Legal notice</Link>
            </li>
            <li>
              <Link href="/subprocessors">Subprocessors</Link>
            </li>
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
            </li>
          </ul>
        </nav>
        <p className="footer-fine">
          © {year} {SITE_NAME}.
        </p>
      </div>
    </footer>
  );
}
