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
  .then(r => { location.replace(r.ok ? "/" : "/?signin=failed"); })
  .catch(() => { location.replace("/?signin=failed"); });
