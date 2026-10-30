/* Supabase sign-in landing (served at /auth/callback). The access
 * token arrives in the URL fragment, which only the browser can read:
 * hand it to the server, then go home. A file, not an inline script,
 * so the site's CSP can refuse inline scripts. */
const t = new URLSearchParams(location.hash.slice(1)).get("access_token");
history.replaceState(null, "", "/auth/callback");
fetch("/auth/supabase", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ access_token: t })
})
  .then(async r => {
    if (r.status === 403) {
      // Google proved the address but it is not invited: keep it for the waitlist offer.
      const d = await r.json().catch(() => ({}));
      try { if (d.email) sessionStorage.setItem("arya.notinvited", d.email); } catch (e) { /* storage unavailable */ }
      location.replace("/?signin=notinvited");
      return;
    }
    location.replace(r.ok ? "/" : "/?signin=failed");
  })
  .catch(() => { location.replace("/?signin=failed"); });
