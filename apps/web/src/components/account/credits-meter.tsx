interface CreditsMeterProps {
  readonly allowance: number;
  readonly used: number;
  readonly bonus: number;
  readonly resetsAt: string;
}

/** Monthly credits used against the plan allowance. Pack credits sit beside the bar. */
export function CreditsMeter({ allowance, used, bonus, resetsAt }: CreditsMeterProps) {
  const spent = Math.max(0, Math.min(Math.floor(used), Math.max(0, Math.floor(allowance))));
  const cap = Math.max(0, Math.floor(allowance));
  const percent = cap === 0 ? 0 : Math.min(100, (spent / cap) * 100);
  const pack = Math.max(0, Math.floor(bonus));

  return (
    <div className="usage-meter-block">
      <p className="usage-meta">
        {spent} of {cap} credits used
      </p>
      <div
        className="usage-meter"
        role="meter"
        aria-label="Credits used"
        aria-valuemin={0}
        aria-valuemax={cap}
        aria-valuenow={spent}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <p className="usage-meta">Resets {formatReset(resetsAt)}.</p>
      {pack > 0 ? <p className="usage-meta">{pack} pack credits are still on this account.</p> : null}
    </div>
  );
}

function formatReset(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
