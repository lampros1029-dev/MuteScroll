import Link from "next/link";

import { AccountNav } from "./account-nav";
import { SITE_NAME } from "../lib/site";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link href="/" className="wordmark" aria-label={`${SITE_NAME}, home`}>
          <svg className="wordmark-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3" y="5" width="18" height="2.6" rx="1.3" fill="currentColor" />
            <rect className="wordmark-accent" x="3" y="10.7" width="12" height="2.6" rx="1.3" />
            <rect x="3" y="16.4" width="15" height="2.6" rx="1.3" fill="currentColor" opacity="0.55" />
          </svg>
          <span>{SITE_NAME}</span>
        </Link>
        <nav aria-label="Primary" className="site-nav">
          <ul>
            <li className="hide-small">
              <Link href="/#how">How it works</Link>
            </li>
            <li className="hide-small">
              <Link href="/#connect">Use it in chat</Link>
            </li>
            <li>
              <Link href="/pricing">Pricing</Link>
            </li>
            <AccountNav />
            <li>
              <Link href="/try" className="btn btn-primary btn-small">
                Transcribe
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
