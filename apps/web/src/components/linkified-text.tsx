import { Fragment } from "react";

const URL_PATTERN = /(https?:\/\/[^\s)]+)/g;

/** Renders plain text with any http(s) addresses turned into links. Never injects HTML. */
export function LinkifiedText({ text }: { readonly text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a key={index} href={part} rel="noopener noreferrer">
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
