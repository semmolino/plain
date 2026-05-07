const jwt = require("jsonwebtoken");

module.exports = (_supabase) => {
  return function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!token) {
      return res.status(401).json({ error: "Nicht authentifiziert" });
    }

    const secret = process.env.JWT_SECRET || "plain-dev-secret-change-me";
    try {
      const decoded = jwt.verify(token, secret);
      req.userId     = decoded.employee_id;
      req.employeeId = decoded.employee_id;
      req.tenantId   = decoded.tenant_id;
      next();
    } catch {
      return res.status(401).json({ error: "Sitzung abgelaufen oder ungültig. Bitte neu anmelden." });
    }
  };
};
