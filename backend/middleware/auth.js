/**
 * Auth middleware — verifies Supabase JWT, injects req.userId + req.tenantId.
 * TENANT_ID is read from the user's app_metadata (set server-side on signup,
 * cannot be forged by the client).
 */
module.exports = (supabase) => {
  return async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!token) {
      return res.status(401).json({ error: "Nicht authentifiziert" });
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: "Sitzung abgelaufen oder ungültig. Bitte neu anmelden." });
    }

    req.userId   = user.id;
    req.tenantId = user.app_metadata?.tenant_id ?? null;
    req.user     = user;
    next();
  };
};
