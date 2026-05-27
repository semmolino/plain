/**
 * Mahnungswesen (Dunning) — business logic
 */
const { sendMail }         = require("./emailService");
const { renderMahnungPdf } = require("../services_pdf_render");

const DEFAULT_SETTINGS = [
  { mahnstufe: 1, label: "Zahlungserinnerung", days_after_due: 7,  days_after_prev: 0,  fee: 0  },
  { mahnstufe: 2, label: "1. Mahnung",          days_after_due: 14, days_after_prev: 14, fee: 0  },
  { mahnstufe: 3, label: "2. Mahnung",          days_after_due: 21, days_after_prev: 14, fee: 20 },
  { mahnstufe: 4, label: "3. Mahnung",          days_after_due: 28, days_after_prev: 14, fee: 40 },
];

// ── List ─────────────────────────────────────────────────────────────────────

async function listMahnungen(supabase, { tenantId }) {
  const today = new Date().toISOString().slice(0, 10);

  const [
    { data: invoices  },
    { data: pps       },
    { data: mahnungen },
    { data: history   },
  ] = await Promise.all([
    supabase
      .from("INVOICE")
      .select("ID, INVOICE_NUMBER, INVOICE_DATE, DUE_DATE, TOTAL_AMOUNT_GROSS, PROJECT_ID, CONTRACT_ID, ADDRESS_NAME_1, CONTACT, EMPLOYEE_ID, INVOICE_TYPE")
      .eq("TENANT_ID", tenantId)
      .eq("STATUS_ID", 2)
      .not("DUE_DATE", "is", null)
      .lt("DUE_DATE", today)
      .neq("INVOICE_TYPE", "stornorechnung"),

    supabase
      .from("PARTIAL_PAYMENT")
      .select("ID, PARTIAL_PAYMENT_NUMBER, PARTIAL_PAYMENT_DATE, DUE_DATE, TOTAL_AMOUNT_GROSS, PROJECT_ID, CONTRACT_ID, ADDRESS_NAME_1, CONTACT, EMPLOYEE_ID")
      .eq("TENANT_ID", tenantId)
      .eq("STATUS_ID", 2)
      .not("DUE_DATE", "is", null)
      .lt("DUE_DATE", today)
      .is("CANCELS_PARTIAL_PAYMENT_ID", null),

    supabase
      .from("MAHNUNG")
      .select("*")
      .eq("TENANT_ID", tenantId),

    supabase
      .from("MAHNUNG_HISTORY")
      .select("MAHNUNG_ID, MAHNSTUFE, DATE_ACTION, EMAIL_SENT, FEE_AMOUNT, EMAIL_TO, EMAIL_SUBJECT, EMPLOYEE_ID")
      .eq("TENANT_ID", tenantId)
      .order("DATE_ACTION", { ascending: false }),
  ]);

  // Index: mahnungId → list of history entries
  const historyByMahnung = {};
  for (const h of (history || [])) {
    if (!historyByMahnung[h.MAHNUNG_ID]) historyByMahnung[h.MAHNUNG_ID] = [];
    historyByMahnung[h.MAHNUNG_ID].push(h);
  }

  // Index: invoice_id / pp_id → mahnung
  const mahnungByInvoice = {};
  const mahnungByPp      = {};
  for (const m of (mahnungen || [])) {
    if (m.INVOICE_ID) mahnungByInvoice[m.INVOICE_ID] = m;
    if (m.PP_ID)      mahnungByPp[m.PP_ID]            = m;
  }

  const rows = [];

  for (const inv of (invoices || [])) {
    const m = mahnungByInvoice[inv.ID] || null;
    rows.push(buildRow("invoice", inv.ID, {
      number:      inv.INVOICE_NUMBER,
      invoiceDate: inv.INVOICE_DATE,
      dueDate:     inv.DUE_DATE,
      totalGross:  inv.TOTAL_AMOUNT_GROSS,
      projectId:   inv.PROJECT_ID,
      contractId:  inv.CONTRACT_ID,
      addressName1: inv.ADDRESS_NAME_1,
      contact:     inv.CONTACT,
    }, m, historyByMahnung, today));
  }

  for (const pp of (pps || [])) {
    const m = mahnungByPp[pp.ID] || null;
    rows.push(buildRow("pp", pp.ID, {
      number:      pp.PARTIAL_PAYMENT_NUMBER,
      invoiceDate: pp.PARTIAL_PAYMENT_DATE,
      dueDate:     pp.DUE_DATE,
      totalGross:  pp.TOTAL_AMOUNT_GROSS,
      projectId:   pp.PROJECT_ID,
      contractId:  pp.CONTRACT_ID,
      addressName1: pp.ADDRESS_NAME_1,
      contact:     pp.CONTACT,
    }, m, historyByMahnung, today));
  }

  rows.sort((a, b) => a.dueDate < b.dueDate ? -1 : 1);
  return rows;
}

function buildRow(sourceType, sourceId, src, m, historyByMahnung, today) {
  const daysOverdue = Math.floor((new Date(today) - new Date(src.dueDate)) / 86400000);
  const hist = m ? (historyByMahnung[m.ID] || []) : [];
  return {
    sourceType,
    sourceId,
    number:      src.number,
    invoiceDate: src.invoiceDate,
    dueDate:     src.dueDate,
    daysOverdue,
    totalGross:  src.totalGross,
    projectId:   src.projectId,
    contractId:  src.contractId,
    addressName1: src.addressName1,
    contact:     src.contact,
    // Mahnung state
    mahnungId:              m ? m.ID : null,
    mahnstufe:              m ? m.MAHNSTUFE : 0,
    lastMahnungDate:        m ? m.LAST_MAHNUNG_DATE : null,
    nextMahnungDate:        m ? m.NEXT_MAHNUNG_DATE : null,
    responsibleEmployeeId:  m ? m.RESPONSIBLE_EMPLOYEE_ID : null,
    isClosed:               m ? m.IS_CLOSED : false,
    closeReason:            m ? m.CLOSE_REASON : null,
    inKlaerung:             m ? m.IN_KLAERUNG : false,
    notes:                  m ? m.NOTES : null,
    history: hist.map(h => ({
      mahnstufe:     h.MAHNSTUFE,
      dateAction:    h.DATE_ACTION,
      emailSent:     h.EMAIL_SENT,
      emailTo:       h.EMAIL_TO,
      emailSubject:  h.EMAIL_SUBJECT,
      feeAmount:     h.FEE_AMOUNT,
    })),
  };
}

// ── Upsert ───────────────────────────────────────────────────────────────────

async function upsertMahnung(supabase, { body, tenantId, employeeId }) {
  const {
    invoice_id, pp_id,
    mahnstufe, last_mahnung_date, next_mahnung_date,
    responsible_employee_id, is_closed, close_reason, in_klaerung, notes,
  } = body;

  if (!invoice_id && !pp_id) {
    throw { status: 400, message: "invoice_id oder pp_id erforderlich" };
  }

  // Load existing record (if any)
  let existing = null;
  if (invoice_id) {
    const { data } = await supabase.from("MAHNUNG").select("*").eq("TENANT_ID", tenantId).eq("INVOICE_ID", invoice_id).maybeSingle();
    existing = data;
  } else {
    const { data } = await supabase.from("MAHNUNG").select("*").eq("TENANT_ID", tenantId).eq("PP_ID", pp_id).maybeSingle();
    existing = data;
  }

  const prevStufe = existing ? existing.MAHNSTUFE : 0;
  const newStufe  = mahnstufe ?? prevStufe;

  // Upsert MAHNUNG
  const payload = {
    TENANT_ID:               tenantId,
    MAHNSTUFE:               newStufe,
    LAST_MAHNUNG_DATE:       last_mahnung_date  ?? existing?.LAST_MAHNUNG_DATE  ?? null,
    NEXT_MAHNUNG_DATE:       next_mahnung_date  ?? existing?.NEXT_MAHNUNG_DATE  ?? null,
    RESPONSIBLE_EMPLOYEE_ID: responsible_employee_id ?? existing?.RESPONSIBLE_EMPLOYEE_ID ?? null,
    IS_CLOSED:               is_closed   ?? existing?.IS_CLOSED   ?? false,
    CLOSE_REASON:            close_reason ?? existing?.CLOSE_REASON ?? null,
    IN_KLAERUNG:             in_klaerung ?? existing?.IN_KLAERUNG ?? false,
    NOTES:                   notes ?? existing?.NOTES ?? null,
    UPDATED_AT:              new Date().toISOString(),
    ...(invoice_id ? { INVOICE_ID: invoice_id } : { PP_ID: pp_id }),
  };

  let mahnungId;
  if (existing) {
    const { error } = await supabase.from("MAHNUNG").update(payload).eq("ID", existing.ID);
    if (error) throw error;
    mahnungId = existing.ID;
  } else {
    const { data, error } = await supabase.from("MAHNUNG").insert(payload).select("ID").single();
    if (error) throw error;
    mahnungId = data.ID;
  }

  // Log history entry when mahnstufe changes (and new level > 0)
  if (newStufe > 0 && newStufe !== prevStufe) {
    // Get fee from settings
    const { data: settings } = await supabase
      .from("MAHNUNG_SETTINGS")
      .select("FEE")
      .eq("TENANT_ID", tenantId)
      .eq("MAHNSTUFE", newStufe)
      .maybeSingle();
    const fee = settings ? Number(settings.FEE) : 0;

    await supabase.from("MAHNUNG_HISTORY").insert({
      TENANT_ID:   tenantId,
      MAHNUNG_ID:  mahnungId,
      MAHNSTUFE:   newStufe,
      EMPLOYEE_ID: employeeId || null,
      EMAIL_SENT:  false,
      FEE_AMOUNT:  fee,
    });
  }

  return { id: mahnungId };
}

// ── Send Email ────────────────────────────────────────────────────────────────

async function sendMahnungEmail(supabase, { mahnungId, emailTo, emailSubject, emailBody, tenantId, employeeId }) {
  // Load MAHNUNG record
  const { data: mahnung, error: mErr } = await supabase
    .from("MAHNUNG")
    .select("*")
    .eq("ID", mahnungId)
    .eq("TENANT_ID", tenantId)
    .single();
  if (mErr || !mahnung) throw { status: 404, message: "Mahnung nicht gefunden" };

  // Load settings for fee
  const { data: settings } = await supabase
    .from("MAHNUNG_SETTINGS")
    .select("FEE, LABEL")
    .eq("TENANT_ID", tenantId)
    .eq("MAHNSTUFE", mahnung.MAHNSTUFE)
    .maybeSingle();
  const fee = settings ? Number(settings.FEE) : 0;

  // Generate PDF
  const pdfBuffer = await renderMahnungPdf(supabase, {
    invoiceId: mahnung.INVOICE_ID || null,
    ppId:      mahnung.PP_ID || null,
    mahnstufe: mahnung.MAHNSTUFE,
    tenantId,
  });

  // Derive filename
  const today = new Date().toISOString().slice(0, 10);
  const stufeLabel = settings ? settings.LABEL.replace(/\s/g, "_") : `Mahnstufe_${mahnung.MAHNSTUFE}`;
  const filename = `Mahnung_${stufeLabel}_${today}.pdf`;

  // Send
  await sendMail({
    to:      emailTo,
    subject: emailSubject,
    html:    emailBody ? `<pre style="font-family:inherit;white-space:pre-wrap">${emailBody}</pre>` : undefined,
    text:    emailBody,
    attachments: [{ filename, content: pdfBuffer, contentType: "application/pdf" }],
  });

  // Log to history
  await supabase.from("MAHNUNG_HISTORY").insert({
    TENANT_ID:     tenantId,
    MAHNUNG_ID:    mahnungId,
    MAHNSTUFE:     mahnung.MAHNSTUFE,
    EMPLOYEE_ID:   employeeId || null,
    EMAIL_TO:      emailTo,
    EMAIL_SUBJECT: emailSubject,
    EMAIL_SENT:    true,
    FEE_AMOUNT:    fee,
  });

  // Update last mahnung date
  await supabase.from("MAHNUNG").update({
    LAST_MAHNUNG_DATE: today,
    UPDATED_AT: new Date().toISOString(),
  }).eq("ID", mahnungId);

  return { sent: true };
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function getSettings(supabase, { tenantId }) {
  const { data } = await supabase
    .from("MAHNUNG_SETTINGS")
    .select("*")
    .eq("TENANT_ID", tenantId)
    .order("MAHNSTUFE");

  // Fill missing levels with defaults
  const byLevel = {};
  for (const row of (data || [])) byLevel[row.MAHNSTUFE] = row;

  return DEFAULT_SETTINGS.map(def => {
    const row = byLevel[def.mahnstufe];
    return row ? {
      mahnstufe:     row.MAHNSTUFE,
      label:         row.LABEL,
      daysAfterDue:  row.DAYS_AFTER_DUE,
      daysAfterPrev: row.DAYS_AFTER_PREV,
      fee:           Number(row.FEE),
      headerText:    row.HEADER_TEXT,
      footerText:    row.FOOTER_TEXT,
    } : {
      mahnstufe:     def.mahnstufe,
      label:         def.label,
      daysAfterDue:  def.days_after_due,
      daysAfterPrev: def.days_after_prev,
      fee:           def.fee,
      headerText:    null,
      footerText:    null,
    };
  });
}

async function saveSettings(supabase, { tenantId, levels }) {
  if (!Array.isArray(levels)) throw { status: 400, message: "levels array erforderlich" };
  for (const lv of levels) {
    await supabase.from("MAHNUNG_SETTINGS").upsert({
      TENANT_ID:      tenantId,
      MAHNSTUFE:      lv.mahnstufe,
      LABEL:          lv.label,
      DAYS_AFTER_DUE: lv.daysAfterDue,
      DAYS_AFTER_PREV: lv.daysAfterPrev,
      FEE:            lv.fee,
      HEADER_TEXT:    lv.headerText ?? null,
      FOOTER_TEXT:    lv.footerText ?? null,
    }, { onConflict: "TENANT_ID,MAHNSTUFE" });
  }
  return { ok: true };
}

// ── Text Templates ────────────────────────────────────────────────────────────

async function getTextTemplates(supabase, { tenantId }) {
  const { data } = await supabase
    .from("TEXT_TEMPLATE")
    .select("DOCUMENT_TYPE, HEADER_TEXT, FOOTER_TEXT")
    .eq("TENANT_ID", tenantId);
  return (data || []).map(r => ({
    documentType: r.DOCUMENT_TYPE,
    headerText:   r.HEADER_TEXT,
    footerText:   r.FOOTER_TEXT,
  }));
}

async function saveTextTemplate(supabase, { tenantId, documentType, headerText, footerText }) {
  const { error } = await supabase.from("TEXT_TEMPLATE").upsert({
    TENANT_ID:     tenantId,
    DOCUMENT_TYPE: documentType,
    HEADER_TEXT:   headerText ?? null,
    FOOTER_TEXT:   footerText ?? null,
  }, { onConflict: "TENANT_ID,DOCUMENT_TYPE" });
  if (error) throw error;
  return { ok: true };
}

// ── History ───────────────────────────────────────────────────────────────────

async function getMahnungHistory(supabase, { mahnungId, tenantId }) {
  const { data, error } = await supabase
    .from("MAHNUNG_HISTORY")
    .select("ID, MAHNSTUFE, DATE_ACTION, EMAIL_TO, EMAIL_SUBJECT, EMAIL_SENT, FEE_AMOUNT")
    .eq("MAHNUNG_ID", mahnungId)
    .eq("TENANT_ID", tenantId)
    .order("DATE_ACTION", { ascending: false });
  if (error) throw error;
  return (data || []).map(h => ({
    id:           h.ID,
    mahnstufe:    h.MAHNSTUFE,
    dateAction:   h.DATE_ACTION,
    emailTo:      h.EMAIL_TO,
    emailSubject: h.EMAIL_SUBJECT,
    emailSent:    h.EMAIL_SENT,
    feeAmount:    Number(h.FEE_AMOUNT),
  }));
}

module.exports = {
  listMahnungen,
  upsertMahnung,
  sendMahnungEmail,
  getSettings,
  saveSettings,
  getTextTemplates,
  saveTextTemplate,
  getMahnungHistory,
};
