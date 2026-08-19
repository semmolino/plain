"use strict";

const express = require("express");
const ctrl    = require("../controllers/push");

module.exports = (supabase) => {
  const router = express.Router();

  router.get("/public-key",  (req, res) => ctrl.publicKey(req, res));
  router.get("/status",      (req, res) => ctrl.status(req, res, supabase));
  router.post("/subscribe",  (req, res) => ctrl.subscribe(req, res, supabase));
  router.post("/unsubscribe",(req, res) => ctrl.unsubscribe(req, res, supabase));
  // Ohne Permission-Gate: schickt ausschliesslich an die eigenen Geraete des
  // angemeldeten Kontos (req.userId), erreicht also niemanden sonst.
  router.post("/test",       (req, res) => ctrl.test(req, res, supabase));

  return router;
};
