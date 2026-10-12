import type { ReactNode } from "react";

import { LEGAL_UPDATED } from "../lib/legal";

export function LegalDocument({
  title,
  lede,
  children,
}: {
  readonly title: string;
  readonly lede: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="container page legal">
      <header className="page-head">
        <h1 className="display-small">{title}</h1>
        <p className="section-lede">
          {lede} Last updated {LEGAL_UPDATED}.
        </p>
      </header>
      {children}
    </div>
  );
}
