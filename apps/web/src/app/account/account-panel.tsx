"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CopyButton } from "../../components/copy-button";
import {
  createApiKey,
  deleteAccount,
  fetchMe,
  listApiKeys,
  listGrants,
  revokeApiKey,
  revokeGrant,
  type ApiKeyRecord,
  type Me,
  type OauthGrant,
} from "../../lib/api/account";

export function AccountPanel() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [loadError, setLoadError] = useState("");
  const [keys, setKeys] = useState<readonly ApiKeyRecord[] | null>(null);
  const [keysError, setKeysError] = useState("");
  const [grants, setGrants] = useState<readonly OauthGrant[] | null>(null);
  const [grantsError, setGrantsError] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [account, keyList, grantList] = await Promise.all([
          fetchMe(controller.signal),
          listApiKeys(controller.signal),
          listGrants(controller.signal),
        ]);
        if (controller.signal.aborted) return;
        if (!account.ok) {
          setLoadError(account.error.message);
          setMe(null);
          return;
        }
        setMe(account.value);
        if (account.value === null) return;
        if (!keyList.ok) {
          setKeysError(keyList.error.message);
          setKeys([]);
        } else {
          setKeys(keyList.value);
        }
        if (!grantList.ok) {
          setGrantsError("Connected apps could not be loaded.");
          setGrants([]);
        } else {
          setGrants(grantList.value);
        }
      } catch {
        if (!controller.signal.aborted) setLoadError("The connection failed. Try again.");
      }
    })();
    return () => controller.abort();
  }, []);

  if (loadError !== "") {
    return (
      <p className="field-error" role="alert">
        {loadError}
      </p>
    );
  }
  if (me === undefined) {
    return <p>Loading your account.</p>;
  }
  if (me === null) {
    return (
      <p>
        <Link href="/login?next=/account">Sign in</Link> to see this account.
      </p>
    );
  }

  const team = me.plan.toLowerCase() === "team";

  async function createKey(): Promise<void> {
    setPending(true);
    setActionError("");
    const result = await createApiKey();
    setPending(false);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    setFreshKey(result.value.key);
    const keyList = await listApiKeys();
    if (keyList.ok) setKeys(keyList.value);
  }

  async function revokeKey(id: string): Promise<void> {
    setPending(true);
    setActionError("");
    const result = await revokeApiKey(id);
    setPending(false);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    setKeys((current) => (current ?? []).filter((key) => key.id !== id));
  }

  async function revokeConnection(id: string): Promise<void> {
    setPending(true);
    setActionError("");
    const result = await revokeGrant(id);
    setPending(false);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    setGrants((current) => (current ?? []).filter((grant) => grant.id !== id));
  }

  async function removeAccount(): Promise<void> {
    setPending(true);
    setActionError("");
    const result = await deleteAccount();
    setPending(false);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    window.location.assign("/");
  }

  return (
    <>
      <section className="section" aria-labelledby="account-summary">
        <h2 id="account-summary" className="section-title-small">
          This account
        </h2>
        <div className="table-scroll" role="region" aria-labelledby="account-summary" tabIndex={0}>
          <table className="data-table">
            <tbody>
              <tr>
                <th scope="row">Email</th>
                <td>{me.email}</td>
              </tr>
              <tr>
                <th scope="row">Plan</th>
                <td>{planLabel(me.plan)}</td>
              </tr>
              <tr>
                <th scope="row">Credits remaining</th>
                <td>{me.credits.remaining}</td>
              </tr>
              <tr>
                <th scope="row">Credits reset</th>
                <td>{formatWhen(me.credits.resets_at)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          <Link href="/library">Transcript library</Link>
        </p>
      </section>

      <section className="section" aria-labelledby="api-keys">
        <h2 id="api-keys" className="section-title-small">
          API keys
        </h2>
        {team ? (
          <p>Create a key for the REST API. It is shown once.</p>
        ) : (
          <p>API keys are included with Team. Any plan can connect ChatGPT, Claude, and Cursor with OAuth.</p>
        )}
        {keysError === "" ? null : (
          <p className="field-error" role="alert">
            {keysError}
          </p>
        )}
        {keys !== null && keys.length > 0 ? (
          <ul className="bullets">
            {keys.map((key) => (
              <li key={key.id}>
                <code>{key.prefix}</code>
                {key.created_at === "" ? null : ` · ${formatWhen(key.created_at)}`}
                <button className="btn btn-quiet" type="button" disabled={pending} onClick={() => void revokeKey(key.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {team && keys !== null && keys.length === 0 ? <p>No API keys yet.</p> : null}
        {team ? (
          <button className="btn btn-primary" type="button" disabled={pending} onClick={() => void createKey()}>
            Create API key
          </button>
        ) : null}
        {freshKey === null ? null : (
          <div className="paste">
            <p className="field-hint">Copy this key now. MuteScroll will not show it again.</p>
            <input className="field-input" readOnly value={freshKey} aria-label="New API key" spellCheck={false} />
            <CopyButton label="Copy API key" value={freshKey} />
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="connected-apps">
        <h2 id="connected-apps" className="section-title-small">
          Connected apps
        </h2>
        <p>ChatGPT, Claude, and Cursor connect with OAuth on every plan.</p>
        {grantsError === "" ? null : (
          <p className="field-error" role="alert">
            {grantsError}
          </p>
        )}
        {grants !== null && grants.length > 0 ? (
          <ul className="bullets">
            {grants.map((grant) => (
              <li key={grant.id}>
                {grant.client_name}
                {grant.scope === "" ? null : ` · ${grant.scope}`}
                {grant.created_at === "" ? null : ` · ${formatWhen(grant.created_at)}`}
                <button className="btn btn-quiet" type="button" disabled={pending} onClick={() => void revokeConnection(grant.id)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {grants !== null && grants.length === 0 && grantsError === "" ? <p>No assistant is connected.</p> : null}
      </section>

      <section className="section" aria-labelledby="delete-account">
        <h2 id="delete-account" className="section-title-small">
          Delete account
        </h2>
        {confirmDelete ? (
          <div className="paste">
            <p>This deletes the account and its transcripts. It cannot be undone.</p>
            <button className="btn btn-primary" type="button" disabled={pending} onClick={() => void removeAccount()}>
              Delete my account
            </button>
            <button className="btn btn-quiet" type="button" disabled={pending} onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn" type="button" onClick={() => setConfirmDelete(true)}>
            Delete account
          </button>
        )}
      </section>

      {actionError === "" ? null : (
        <p className="field-error" role="alert">
          {actionError}
        </p>
      )}
    </>
  );
}

function planLabel(plan: string): string {
  switch (plan.toLowerCase()) {
    case "free":
      return "Free";
    case "creator":
      return "Creator";
    case "pro":
      return "Pro";
    case "team":
      return "Team";
    default:
      return plan;
  }
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}
