const INTERACTIVE = "a, button, input, textarea, select, label";

/**
 * Masks each word for a GSAP reveal. The caller keeps an unsplit accessible name
 * on the heading (`aria-label`). Links and form controls are never split.
 * Returns the word nodes, or an empty list when the element should stay whole.
 */
export function splitWords(element: HTMLElement): HTMLElement[] {
  if (element.dataset.motionSplit === "true") {
    return Array.from(element.querySelectorAll<HTMLElement>(".motion-word"));
  }
  if (element.querySelector(INTERACTIVE) !== null) return [];

  const text = element.textContent ?? "";
  const parts = text.split(/(\s+)/);
  element.textContent = "";

  const words: HTMLElement[] = [];
  for (const part of parts) {
    if (part.trim() === "") {
      element.append(document.createTextNode(part));
      continue;
    }
    const mask = document.createElement("span");
    const word = document.createElement("span");
    mask.className = "motion-word-mask";
    word.className = "motion-word";
    word.textContent = part;
    mask.append(word);
    element.append(mask);
    words.push(word);
  }

  element.dataset.motionSplit = "true";
  return words;
}
