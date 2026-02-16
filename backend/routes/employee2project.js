const express = require("express");

module.exports = (supabase) => {
  const router = express.Router();

  // Returns preset values for a given employee + project pair from EMPLOYEE2PROJECT
  // GET /api/employee2project/preset?employee_id=1&project_id=2
  router.get("/preset", async (req, res) => {
    const employeeId = Number(req.query.employee_id);
    const projectId = Number(req.query.project_id);

    if (!employeeId || !projectId) {
      return res.status(400).json({ error: "employee_id and project_id are required" });
    }

    const { data, error } = await supabase
      .from("EMPLOYEE2PROJECT")
      .select("ROLE_ID, ROLE_NAME_SHORT, ROLE_NAME_LONG, SP_RATE")
      .eq("EMPLOYEE_ID", employeeId)
      .eq("PROJECT_ID", projectId)
      .limit(1);

    if (error) return res.status(500).json({ error: error.message });

    if (!data || !data.length) {
      return res.json({ found: false });
    }

    const row = data[0];
    return res.json({
      found: true,
      ROLE_ID: row.ROLE_ID ?? null,
      ROLE_NAME_SHORT: row.ROLE_NAME_SHORT ?? null,
      ROLE_NAME_LONG: row.ROLE_NAME_LONG ?? null,
      SP_RATE: row.SP_RATE ?? null,
    });
  });

  return router;
};
