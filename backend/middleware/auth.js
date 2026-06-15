const jwt = require("jsonwebtoken");

module.exports = (_supabase) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required");

  return function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!token) {
      return res.status(401).json({ error: "Nicht authentifiziert" });
    }

    try {
      const decoded = jwt.verify(token, secret);
      // Nur echte Session-Tokens akzeptieren. Spezial-Tokens (z.B. Passwort-Reset
      // mit purpose:"reset") duerfen NICHT als Sitzung verwendet werden.
      if (decoded.purpose) {
        return res.status(401).json({ error: "Ungültiges Token für diese Anfrage." });
      }
      req.userId     = decoded.employee_id;
      req.employeeId = decoded.employee_id;
      req.tenantId   = decoded.tenant_id;
      next();
    } catch {
      return res.status(401).json({ error: "Sitzung abgelaufen oder ungültig. Bitte neu anmelden." });
    }
  };
};
