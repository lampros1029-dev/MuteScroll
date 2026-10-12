import { languageName } from "./format";

/** Languages offered in the transcript form. The API accepts "auto" or any ISO 639-1 code. */
export const LANGUAGE_CODES = ["en", "el", "es", "fr", "de", "it", "pt", "nl", "sv", "pl", "tr", "ru", "ar", "hi", "ja", "ko", "zh"] as const;

export interface LanguageOption {
  readonly value: string;
  readonly label: string;
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = [
  { value: "auto", label: "Detect automatically" },
  ...LANGUAGE_CODES.map((code) => ({ value: code, label: languageName(code) ?? code })),
];
