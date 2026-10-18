import type { ReactNode } from "react";

import { LEGAL_UPDATED } from "../lib/legal";

export function LegalDocument({
  title,
  lede,
  updated = LEGAL_UPDATED,
  children,
}: {
  readonly title: string;
  readonly lede: string;
  readonly updated?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">{title}</h1>
        <p className="section-lede">
          {lede} Last updated {updated}.
        </p>
      </header>
      {children}
    </div>
  );
}
