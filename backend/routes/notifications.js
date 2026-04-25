"use strict";

const express = require("express");
const ctrl    = require("../controllers/notifications");

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/",              (req, res) => ctrl.listNotifications(req, res, supabase));
  router.post("/read-all",     (req, res) => ctrl.markAllRead(req, res, supabase));
  router.patch("/:id/read",    (req, res) => ctrl.markRead(req, res, supabase));

  return router;
};
