require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Auth
const authRoutes    = require("./routes/auth")(supabase);
const authMiddleware = require("./middleware/auth")(supabase);

// Public auth routes (no token required)
app.use("/api/v1/auth", authRoutes);

// All other API routes require a valid session
const stammdatenRoutes       = require("./routes/stammdaten")(supabase);
const mitarbeiterRoutes      = require("./routes/mitarbeiter")(supabase);
const projekteRoutes         = require("./routes/projekte")(supabase);
const buchungenRoutes        = require("./routes/buchungen")(supabase);
const employee2projectRoutes = require("./routes/employee2project")(supabase);
const partialPaymentsRoutes  = require("./routes/partialPayments")(supabase);
const invoicesRoutes         = require("./routes/invoices")(supabase);
const paymentsRoutes         = require("./routes/payments")(supabase);
const assetsRoutes           = require("./routes/assets")(supabase);
const documentTemplatesRoutes = require("./routes/documentTemplates")(supabase);
const documentsRoutes        = require("./routes/documents")(supabase);
const numberRangesRoutes     = require("./routes/numberRanges")(supabase);
const reportsRoutes          = require("./routes/reports")(supabase);
const finalInvoicesRoutes    = require("./routes/finalInvoices")(supabase);

app.use("/api/v1/stammdaten",        authMiddleware, stammdatenRoutes);
app.use("/api/v1/mitarbeiter",       authMiddleware, mitarbeiterRoutes);
app.use("/api/v1/projekte",          authMiddleware, projekteRoutes);
app.use("/api/v1/buchungen",         authMiddleware, buchungenRoutes);
app.use("/api/v1/employee2project",  authMiddleware, employee2projectRoutes);
app.use("/api/v1/partial-payments",  authMiddleware, partialPaymentsRoutes);
app.use("/api/v1/invoices",          authMiddleware, invoicesRoutes);
app.use("/api/v1/payments",          authMiddleware, paymentsRoutes);
app.use("/api/v1/assets",            authMiddleware, assetsRoutes);
app.use("/api/v1/document-templates",authMiddleware, documentTemplatesRoutes);
app.use("/api/v1/documents",         authMiddleware, documentsRoutes);
app.use("/api/v1/number-ranges",     authMiddleware, numberRangesRoutes);
app.use("/api/v1/reports",           authMiddleware, reportsRoutes);
app.use("/api/v1/final-invoices",    authMiddleware, finalInvoicesRoutes);




app.get("/", (req, res) => {
  res.send("Backend läuft ✅");
});

app.listen(port, () => {
  console.log(`✅ Backend läuft auf http://localhost:${port}`);
});


app.get("/test/genders", async (req, res) => {
  const { data, error } = await supabase
    .from("GENDER")
    .select("ID, GENDER");

  if (error) return res.status(500).json({ error: error.message });
  res.json({ data });
});

