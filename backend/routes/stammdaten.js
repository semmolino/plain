const express = require("express");

module.exports = (supabase) => {
  const router = express.Router();

  // Save PROJECT_STATUS
  router.post("/status", async (req, res) => {
    const name_short = req.body.name_short;

    if (!name_short || typeof name_short !== "string") {
      return res.status(400).json({ error: "name_short is required" });
    }

    const { data, error } = await supabase
      .from("PROJECT_STATUS")
      .insert([{ "NAME_SHORT": name_short }]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // Save PROJECT_TYPE
  router.post("/typ", async (req, res) => {
    const name_short = req.body.name_short;

    if (!name_short || typeof name_short !== "string") {
      return res.status(400).json({ error: "name_short is required" });
    }

    const { data, error } = await supabase
      .from("PROJECT_TYPE")
      .insert([{ "NAME_SHORT": name_short }]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List COUNTRIES (for dropdowns)
  router.get("/countries", async (req, res) => {
    const { data, error } = await supabase
      .from("COUNTRY")
      .select("ID, NAME_SHORT, NAME_LONG")
      .order("NAME_LONG", { ascending: true, nullsFirst: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List BILLING_TYPE (for dropdowns)
  // Table: BILLING_TYPE, Display column: BILLING_TYPE
  router.get("/billing-types", async (req, res) => {
    const { data, error } = await supabase
      .from("BILLING_TYPE")
      .select("ID, BILLING_TYPE")
      .order("BILLING_TYPE", { ascending: true, nullsFirst: false });

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List COMPANY (for dropdowns)
  // Table: COMPANY, Display column: COMPANY_NAME_1
  router.get("/companies", async (req, res) => {
    const { data, error } = await supabase
      .from("COMPANY")
      .select("ID, COMPANY_NAME_1")
      .order("COMPANY_NAME_1", { ascending: true, nullsFirst: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // Save COMPANY master data
  router.post("/company", async (req, res) => {
    const {
      company_name_1,
      company_name_2,
      street,
      post_code,
      city,
      country_id,
      tax_id
    } = req.body || {};

    // Minimal validation
    if (!company_name_1 || typeof company_name_1 !== "string") {
      return res.status(400).json({ error: "company_name_1 is required" });
    }
    if (!street || typeof street !== "string") {
      return res.status(400).json({ error: "street is required" });
    }
    if (!post_code || typeof post_code !== "string") {
      return res.status(400).json({ error: "post_code is required" });
    }
    if (!city || typeof city !== "string") {
      return res.status(400).json({ error: "city is required" });
    }
    if (!country_id || typeof country_id !== "string") {
      return res.status(400).json({ error: "country_id is required" });
    }

    const insertRow = {
      COMPANY_NAME_1: company_name_1.trim(),
      COMPANY_NAME_2: (company_name_2 || "").trim() || null,
      STREET: street.trim(),
      POST_CODE: post_code.trim(),
      CITY: city.trim(),
      COUNTRY_ID: country_id.trim(),
      "TAX-ID": (tax_id || "").trim() || null
    };

    const { data, error } = await supabase
      .from("COMPANY")
      .insert([insertRow]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // Save ADDRESS master data
  router.post("/address", async (req, res) => {
    const {
      address_name_1,
      address_name_2,
      street,
      post_code,
      city,
      post_office_box,
      country_id,
      customer_number,
      tax_id,
      buyer_reference
    } = req.body || {};

    if (!address_name_1 || typeof address_name_1 !== "string") {
      return res.status(400).json({ error: "address_name_1 is required" });
    }

    const parsedCountryId =
      typeof country_id === "number" ? country_id : parseInt(country_id, 10);

    if (!parsedCountryId || Number.isNaN(parsedCountryId)) {
      return res.status(400).json({ error: "country_id is required" });
    }

    const insertRow = {
      ADDRESS_NAME_1: address_name_1.trim(),
      ADDRESS_NAME_2: (address_name_2 || "").trim() || null,
      STREET: (street || "").trim() || null,
      POST_CODE: (post_code || "").trim() || null,
      CITY: (city || "").trim() || null,
      POST_OFFICE_BOX: (post_office_box || "").trim() || null,
      COUNTRY_ID: parsedCountryId,
      CUSTOMER_NUMBER: (customer_number || "").trim() || null,
      "TAX-ID": (tax_id || "").trim() || null,
      BUYER_REFERENCE: (buyer_reference || "").trim() || null
    };

    const { data, error } = await supabase
      .from("ADDRESS")
      .insert([insertRow]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // Save Rollen master data
  // Note: Some schemas use a dedicated table (e.g. ROLE/ROLE_TYPE). If that table
  // is not present, we fall back to ADDRESS to align with the user's stated table.
  router.post("/rollen", async (req, res) => {
    const { name_short, name_long } = req.body || {};

    if (!name_short || typeof name_short !== "string") {
      return res.status(400).json({ error: "name_short is required" });
    }

    const insertRow = {
      NAME_SHORT: name_short.trim(),
      NAME_LONG: (name_long || "").trim() || null
    };

    // Try ROLE first (most likely for "Rollen"), then fall back to ADDRESS
    let data, error, usedTable;

    ({ data, error } = await supabase.from("ROLE").insert([insertRow]));
    usedTable = "ROLE";

    if (error) {
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("relation") || msg.toLowerCase().includes("not found")) {
        ({ data, error } = await supabase.from("ADDRESS").insert([insertRow]));
        usedTable = "ADDRESS";
      }
    }

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data, table: usedTable });
  });
// Load SALUTATION for dropdowns
// Table: SALUTATION, Display column: SALUTATION
router.get("/salutations", async (req, res) => {
  const { data, error } = await supabase
    .from("SALUTATION")
    .select("ID, SALUTATION")
    .order("SALUTATION", { ascending: true, nullsFirst: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Normalize to {ID, NAME_LONG} expected by the frontend
  const normalized = (data || []).map((r) => ({
    ID: r.ID,
    NAME_LONG: r.SALUTATION ?? null
  }));

  res.json({ data: normalized });
});
// Load GENDER for dropdowns
// Table: GENDER, Display column: GENDER
router.get("/genders", async (req, res) => {
  const { data, error } = await supabase
    .from("GENDER")
    .select("ID, GENDER")
    .order("GENDER", { ascending: true, nullsFirst: false });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Normalize to {ID, NAME_LONG} expected by the frontend
  const normalized = (data || []).map((r) => ({
    ID: r.ID,
    NAME_LONG: r.GENDER ?? null
  }));

  res.json({ data: normalized });
});


  // Search ADDRESS by ADDRESS_NAME_1 (for contacts)


  router.get("/addresses/search", async (req, res) => {
    const q = (req.query.q || "").toString().trim();

    if (!q || q.length < 2) {
      return res.json({ data: [] });
    }

    const { data, error } = await supabase
      .from("ADDRESS")
      .select("ID, ADDRESS_NAME_1")
      .ilike("ADDRESS_NAME_1", `%${q}%`)
      .limit(20);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List ADDRESS (for Anschriftenliste)
  router.get("/addresses/list", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "2000", 10) || 2000, 5000);

    const { data: addresses, error: aErr } = await supabase
      .from("ADDRESS")
      .select('ID, ADDRESS_NAME_1, ADDRESS_NAME_2, STREET, POST_CODE, CITY, POST_OFFICE_BOX, COUNTRY_ID, CUSTOMER_NUMBER, "TAX-ID", BUYER_REFERENCE')
      .order("ADDRESS_NAME_1", { ascending: true })
      .limit(limit);

    if (aErr) return res.status(500).json({ error: aErr.message });

    // Load country names for display (safe even without FK relationships)
    const { data: countries, error: cErr } = await supabase
      .from("COUNTRY")
      .select("ID, NAME_LONG, NAME_SHORT")
      .order("NAME_LONG", { ascending: true })
      .limit(5000);

    if (cErr) return res.status(500).json({ error: cErr.message });

    const countryMap = new Map((countries || []).map(c => [String(c.ID), (c.NAME_LONG || c.NAME_SHORT || "").toString()]));

    const normalized = (addresses || []).map((r) => ({
      ...r,
      TAX_ID: r["TAX-ID"] ?? null,
      COUNTRY: countryMap.get(String(r.COUNTRY_ID)) || "",
    }));

    res.json({ data: normalized });
  });

  // Update ADDRESS (for Anschriftenliste edit modal)
  router.patch("/addresses/:id", async (req, res) => {
    const id = req.params.id;
    const {
      address_name_1,
      address_name_2,
      street,
      post_code,
      city,
      post_office_box,
      country_id,
      customer_number,
      tax_id,
      buyer_reference,
    } = req.body || {};

    if (!address_name_1 || !country_id) {
      return res.status(400).json({ error: "ADDRESS_NAME_1 und COUNTRY_ID sind erforderlich" });
    }

    const updateRow = {
      ADDRESS_NAME_1: address_name_1,
      ADDRESS_NAME_2: address_name_2 || null,
      STREET: street || null,
      POST_CODE: post_code || null,
      CITY: city || null,
      POST_OFFICE_BOX: post_office_box || null,
      COUNTRY_ID: parseInt(country_id, 10),
      CUSTOMER_NUMBER: customer_number || null,
      "TAX-ID": tax_id || null,
      BUYER_REFERENCE: buyer_reference || null,
    };

    const { data, error } = await supabase
      .from("ADDRESS")
      .update(updateRow)
      .eq("ID", id)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Add COUNTRY + TAX_ID normalization for frontend consistency
    let countryName = "";
    const { data: cData } = await supabase.from("COUNTRY").select("NAME_LONG, NAME_SHORT").eq("ID", data.COUNTRY_ID).maybeSingle();
    if (cData) countryName = cData.NAME_LONG || cData.NAME_SHORT || "";

    res.json({
      data: {
        ...data,
        TAX_ID: data["TAX-ID"] ?? null,
        COUNTRY: countryName,
      },
    });
  });

  // Search CONTACTS by FIRST_NAME / LAST_NAME, filtered by ADDRESS_ID (for Projekte -> Kontakt)
  router.get("/contacts/search", async (req, res) => {
    const q = (req.query.q || "").toString().trim();
    const addressIdRaw = (req.query.address_id || "").toString().trim();

    if (!addressIdRaw) {
      return res.json({ data: [] });
    }

    const parsedAddressId = parseInt(addressIdRaw, 10);
    if (!parsedAddressId || Number.isNaN(parsedAddressId)) {
      return res.json({ data: [] });
    }

    if (!q || q.length < 2) {
      return res.json({ data: [] });
    }

    const { data, error } = await supabase
      .from("CONTACTS")
      .select("ID, FIRST_NAME, LAST_NAME, ADDRESS_ID")
      .eq("ADDRESS_ID", parsedAddressId)
      .or(`FIRST_NAME.ilike.%${q}%,LAST_NAME.ilike.%${q}%`)
      .order("LAST_NAME", { ascending: true })
      .limit(20);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  // List CONTACTS (for Kontaktliste)
  router.get("/contacts/list", async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || "2000", 10) || 2000, 5000);

    const { data: contacts, error: cErr } = await supabase
      .from("CONTACTS")
      .select("ID, TITLE, FIRST_NAME, LAST_NAME, EMAIL, MOBILE, SALUTATION_ID, GENDER_ID, ADDRESS_ID")
      .order("LAST_NAME", { ascending: true })
      .limit(limit);
    if (cErr) return res.status(500).json({ error: cErr.message });

    const [{ data: salutations, error: sErr }, { data: genders, error: gErr }, { data: addresses, error: aErr }] = await Promise.all([
      supabase.from("SALUTATION").select("ID, SALUTATION").limit(5000),
      supabase.from("GENDER").select("ID, GENDER").limit(5000),
      supabase.from("ADDRESS").select("ID, ADDRESS_NAME_1").limit(5000),
    ]);

    if (sErr) return res.status(500).json({ error: sErr.message });
    if (gErr) return res.status(500).json({ error: gErr.message });
    if (aErr) return res.status(500).json({ error: aErr.message });

    const salMap = new Map((salutations || []).map(s => [String(s.ID), (s.SALUTATION || "").toString()]));
    const genMap = new Map((genders || []).map(g => [String(g.ID), (g.GENDER || "").toString()]));
    const addrMap = new Map((addresses || []).map(a => [String(a.ID), (a.ADDRESS_NAME_1 || "").toString()]));

    const normalized = (contacts || []).map((r) => ({
      ...r,
      NAME: `${r.FIRST_NAME || ""} ${r.LAST_NAME || ""}`.trim(),
      SALUTATION: salMap.get(String(r.SALUTATION_ID)) || "",
      GENDER: genMap.get(String(r.GENDER_ID)) || "",
      ADDRESS: addrMap.get(String(r.ADDRESS_ID)) || "",
    }));

    res.json({ data: normalized });
  });

  // Update CONTACTS (for Kontaktliste edit modal)
  router.patch("/contacts/:id", async (req, res) => {
    const id = req.params.id;
    const {
      title,
      first_name,
      last_name,
      email,
      mobile,
      salutation_id,
      gender_id,
      address_id,
    } = req.body || {};

    if (!first_name || !last_name || !salutation_id || !gender_id || !address_id) {
      return res.status(400).json({ error: "Vorname, Nachname, Anrede, Geschlecht und Adresse sind erforderlich" });
    }

    const updateRow = {
      TITLE: title || null,
      FIRST_NAME: first_name,
      LAST_NAME: last_name,
      EMAIL: email || null,
      MOBILE: mobile || null,
      SALUTATION_ID: parseInt(salutation_id, 10),
      GENDER_ID: parseInt(gender_id, 10),
      ADDRESS_ID: parseInt(address_id, 10),
    };

    const { data, error } = await supabase
      .from("CONTACTS")
      .update(updateRow)
      .eq("ID", id)
      .select('*')
      .single();
    if (error) return res.status(500).json({ error: error.message });

    // hydrate display fields
    const [{ data: s }, { data: g }, { data: a }] = await Promise.all([
      supabase.from("SALUTATION").select("SALUTATION").eq("ID", data.SALUTATION_ID).maybeSingle(),
      supabase.from("GENDER").select("GENDER").eq("ID", data.GENDER_ID).maybeSingle(),
      supabase.from("ADDRESS").select("ADDRESS_NAME_1").eq("ID", data.ADDRESS_ID).maybeSingle(),
    ]);

    res.json({
      data: {
        ...data,
        NAME: `${data.FIRST_NAME || ""} ${data.LAST_NAME || ""}`.trim(),
        SALUTATION: s?.SALUTATION || "",
        GENDER: g?.GENDER || "",
        ADDRESS: a?.ADDRESS_NAME_1 || "",
      },
    });
  });

  // Search VAT (for Abschlagsrechnungen wizard)
  // Table: VAT, columns: VAT, VAT_PERCENT
  router.get("/vat/search", async (req, res) => {
    const q = (req.query.q || "").toString().trim();
    if (!q || q.length < 1) return res.json({ data: [] });

    const { data, error } = await supabase
      .from("VAT")
      .select("ID, VAT, VAT_PERCENT")
      .ilike("VAT", `%${q}%`)
      .order("VAT_PERCENT", { ascending: true })
      .limit(20);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // Search PAYMENT_MEANS (for Abschlagsrechnungen wizard)
  // Table: PAYMENT_MEANS, columns: NAME_SHORT, NAME_LONG
  router.get("/payment-means/search", async (req, res) => {
    const q = (req.query.q || "").toString().trim();
    if (!q || q.length < 2) return res.json({ data: [] });

    const { data, error } = await supabase
      .from("PAYMENT_MEANS")
      .select("ID, NAME_SHORT, NAME_LONG")
      .or(`NAME_SHORT.ilike.%${q}%,NAME_LONG.ilike.%${q}%`)
      .order("NAME_SHORT", { ascending: true })
      .limit(20);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ data });
  });

  // Save CONTACTS
  router.post("/contacts", async (req, res) => {
    const {
      title,
      first_name,
      last_name,
      email,
      mobile,
      salutation_id,
      gender_id,
      address_id
    } = req.body || {};

    if (!first_name || typeof first_name !== "string" || !first_name.trim()) {
      return res.status(400).json({ error: "first_name is required" });
    }

    if (!last_name || typeof last_name !== "string" || !last_name.trim()) {
      return res.status(400).json({ error: "last_name is required" });
    }

    const parsedSalutationId =
      typeof salutation_id === "number"
        ? salutation_id
        : parseInt(salutation_id, 10);

    const parsedGenderId =
      typeof gender_id === "number" ? gender_id : parseInt(gender_id, 10);

    const parsedAddressId =
      typeof address_id === "number" ? address_id : parseInt(address_id, 10);

    if (!parsedSalutationId || Number.isNaN(parsedSalutationId)) {
      return res.status(400).json({ error: "salutation_id is required" });
    }

    if (!parsedGenderId || Number.isNaN(parsedGenderId)) {
      return res.status(400).json({ error: "gender_id is required" });
    }

    if (!parsedAddressId || Number.isNaN(parsedAddressId)) {
      return res.status(400).json({ error: "address_id is required" });
    }

    const insertRow = {
      TITLE: (title || "").trim() || null,
      FIRST_NAME: first_name.trim(),
      LAST_NAME: last_name.trim(),
      EMAIL: (email || "").trim() || null,
      MOBILE: (mobile || "").trim() || null,
      SALUTATION_ID: parsedSalutationId,
      GENDER_ID: parsedGenderId,
      ADDRESS_ID: parsedAddressId
    };

    const { data, error } = await supabase.from("CONTACTS").insert([insertRow]);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ data });
  });

  return router;
};
