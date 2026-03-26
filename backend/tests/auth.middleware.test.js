"use strict";

const authMiddlewareFactory = require("../middleware/auth");

function makeSupabase({ user = null, error = null } = {}) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user }, error }),
    },
  };
}

function makeReqRes(authHeader) {
  const req = { headers: { authorization: authHeader || "" } };
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe("authMiddleware", () => {
  it("rejects with 401 when no Authorization header", async () => {
    const supabase = makeSupabase();
    const middleware = authMiddlewareFactory(supabase);
    const { req, res, next } = makeReqRes("");

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects with 401 when token is invalid (Supabase returns error)", async () => {
    const supabase = makeSupabase({ error: new Error("invalid token") });
    const middleware = authMiddlewareFactory(supabase);
    const { req, res, next } = makeReqRes("Bearer bad-token");

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() and injects req.userId + req.tenantId on valid token", async () => {
    const fakeUser = {
      id: "user-123",
      app_metadata: { tenant_id: 42 },
    };
    const supabase = makeSupabase({ user: fakeUser });
    const middleware = authMiddlewareFactory(supabase);
    const { req, res, next } = makeReqRes("Bearer valid-token");

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe("user-123");
    expect(req.tenantId).toBe(42);
    expect(req.user).toBe(fakeUser);
  });

  it("sets tenantId to null when app_metadata has no tenant_id", async () => {
    const fakeUser = { id: "user-456", app_metadata: {} };
    const supabase = makeSupabase({ user: fakeUser });
    const middleware = authMiddlewareFactory(supabase);
    const { req, res, next } = makeReqRes("Bearer valid-token");

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.tenantId).toBeNull();
  });
});
