"use strict";

const jwt = require("jsonwebtoken");

const TEST_SECRET = "test-secret-for-jest";

// Set JWT_SECRET before requiring the middleware
beforeAll(() => {
  process.env.JWT_SECRET = TEST_SECRET;
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

const authMiddlewareFactory = require("../middleware/auth");

function makeReqRes(authHeader) {
  const req = { headers: { authorization: authHeader || "" } };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

function signToken(payload, expiresIn = "8h") {
  return jwt.sign(payload, TEST_SECRET, { expiresIn });
}

describe("authMiddleware", () => {
  let middleware;

  beforeAll(() => {
    middleware = authMiddlewareFactory(null /* supabase not used */);
  });

  it("rejects with 401 when no Authorization header", () => {
    const { req, res, next } = makeReqRes("");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when token is malformed", () => {
    const { req, res, next } = makeReqRes("Bearer not.a.valid.jwt");
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when token is expired", () => {
    const token = signToken({ employee_id: 1, tenant_id: 10 }, "-1s");
    const { req, res, next } = makeReqRes(`Bearer ${token}`);
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when token signed with wrong secret", () => {
    const token = jwt.sign({ employee_id: 1, tenant_id: 10 }, "wrong-secret", { expiresIn: "8h" });
    const { req, res, next } = makeReqRes(`Bearer ${token}`);
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() and injects req.employeeId + req.tenantId on valid token", () => {
    const token = signToken({ employee_id: 99, tenant_id: 42 });
    const { req, res, next } = makeReqRes(`Bearer ${token}`);
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.employeeId).toBe(99);
    expect(req.userId).toBe(99);
    expect(req.tenantId).toBe(42);
  });

  it("rejects with 401 when token carries a non-session purpose (e.g. reset)", () => {
    const token = signToken({ employee_id: 1, tenant_id: 10, purpose: "reset" });
    const { req, res, next } = makeReqRes(`Bearer ${token}`);
    middleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when Bearer prefix has extra whitespace", () => {
    const token = signToken({ employee_id: 1, tenant_id: 5 });
    const { req, res, next } = makeReqRes(`Bearer  ${token}`);
    // trim() strips the extra space — should still verify
    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
