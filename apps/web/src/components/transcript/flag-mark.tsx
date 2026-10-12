import { reasonExplanation, reasonLabel } from "../../lib/transcript/view-model";

interface FlagMarkProps {
  readonly id: string;
  readonly text: string;
  readonly reason: string;
}

/**
 * An uncertain word or phrase. The explanation is a tooltip that appears on hover, on keyboard
 * focus and on tap (the mark is focusable), and is linked to the mark for screen readers.
 */
export function FlagMark({ id, text, reason }: FlagMarkProps) {
  return (
    <span className="flag-wrap">
      <mark className="flag" tabIndex={0} aria-describedby={id}>
        {text}
      </mark>
      <span role="tooltip" id={id} className="flag-tip">
        <strong className="flag-tip-title">{reasonLabel(reason)}</strong>{" "}
        <span className="flag-tip-body">{reasonExplanation(reason)}</span>
      </span>
    </span>
  );
}
