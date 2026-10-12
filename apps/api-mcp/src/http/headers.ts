/** First value of a repeated header, or the header itself when it appears once. */
export function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
