import {
  applyDesignAssist,
  planDesignAssist,
} from "@/wab/server/routes/design-assist";
import { userDbMgr } from "@/wab/server/routes/util";
import {
  getDesignAssistBearerToken,
  getDesignAssistWebhookUrl,
} from "@/wab/server/secrets";
import { BadRequestError } from "@/wab/shared/ApiErrors/errors";
import fetch from "node-fetch";

jest.mock("node-fetch", () => jest.fn());
jest.mock("@/wab/server/routes/util", () => ({
  userDbMgr: jest.fn(),
}));
jest.mock("@/wab/server/secrets", () => ({
  getDesignAssistWebhookUrl: jest.fn(),
  getDesignAssistBearerToken: jest.fn(),
}));

const mockFetch = fetch as unknown as jest.Mock;
const mockUserDbMgr = userDbMgr as jest.Mock;
const mockWebhookUrl = getDesignAssistWebhookUrl as jest.Mock;
const mockBearerToken = getDesignAssistBearerToken as jest.Mock;

function mkReq(body: Record<string, unknown>) {
  return { body } as any;
}

function mkRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mkUpstream(status: number, body: unknown) {
  return {
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe("design-assist proxy routes", () => {
  let checkProjectPerms: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    checkProjectPerms = jest.fn().mockResolvedValue(undefined);
    mockUserDbMgr.mockReturnValue({ checkProjectPerms });
    mockWebhookUrl.mockReturnValue("https://automate.test/webhook/design-assist");
    mockBearerToken.mockReturnValue("test-bearer");
  });

  it("plan rejects a missing request before any perm check or forward", async () => {
    await expect(
      planDesignAssist(mkReq({ projectId: "p1" }), mkRes())
    ).rejects.toThrow(BadRequestError);
    expect(checkProjectPerms).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("plan rejects an oversized request", async () => {
    await expect(
      planDesignAssist(
        mkReq({ projectId: "p1", request: "x".repeat(10_001) }),
        mkRes()
      )
    ).rejects.toThrow(BadRequestError);
  });

  it("apply rejects a missing planId", async () => {
    await expect(
      applyDesignAssist(mkReq({ projectId: "p1" }), mkRes())
    ).rejects.toThrow(BadRequestError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a missing projectId (no forward)", async () => {
    await expect(
      planDesignAssist(mkReq({ request: "make it nice" }), mkRes())
    ).rejects.toThrow(BadRequestError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("plan enforces content perms, injects action, forwards bearer, relays 200", async () => {
    mockFetch.mockResolvedValue(
      mkUpstream(200, { status: "ready", planId: "plan-1" })
    );
    const res = mkRes();
    await planDesignAssist(
      mkReq({ projectId: "p1", request: "add a hero" }),
      res
    );

    expect(checkProjectPerms).toHaveBeenCalledWith(
      "p1",
      "content",
      "run design-assist"
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://automate.test/webhook/design-assist");
    expect(init.headers.authorization).toBe("Bearer test-bearer");
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({
      action: "plan",
      projectId: "p1",
      request: "add a hero",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: "ready", planId: "plan-1" });
  });

  it("apply relays an upstream 409 REVISION_CONFLICT", async () => {
    mockFetch.mockResolvedValue(
      mkUpstream(409, { code: "REVISION_CONFLICT", headRevision: 4 })
    );
    const res = mkRes();
    await applyDesignAssist(
      mkReq({ projectId: "p1", planId: "plan-1" }),
      res
    );

    expect(checkProjectPerms).toHaveBeenCalledWith(
      "p1",
      "content",
      "run design-assist"
    );
    const sent = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sent).toMatchObject({ action: "apply", planId: "plan-1" });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      code: "REVISION_CONFLICT",
      headRevision: 4,
    });
  });

  it("denied perms propagate and nothing is forwarded", async () => {
    checkProjectPerms.mockRejectedValue(new Error("Forbidden"));
    await expect(
      planDesignAssist(mkReq({ projectId: "p1", request: "x" }), mkRes())
    ).rejects.toThrow("Forbidden");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 501 when the webhook is not configured", async () => {
    mockWebhookUrl.mockReturnValue(undefined);
    const res = mkRes();
    await planDesignAssist(mkReq({ projectId: "p1", request: "x" }), res);
    expect(res.status).toHaveBeenCalledWith(501);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "DESIGN_ASSIST_NOT_CONFIGURED" })
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("maps fetch failure/timeout to 504 DESIGN_ASSIST_UNAVAILABLE", async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error("aborted"), { name: "AbortError" })
    );
    const res = mkRes();
    await applyDesignAssist(mkReq({ projectId: "p1", planId: "plan-1" }), res);
    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "DESIGN_ASSIST_UNAVAILABLE" })
    );
  });

  it("handles a non-JSON upstream body without throwing", async () => {
    mockFetch.mockResolvedValue({
      status: 502,
      text: () => Promise.resolve("<html>Bad Gateway</html>"),
    });
    const res = mkRes();
    await planDesignAssist(mkReq({ projectId: "p1", request: "x" }), res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("Bad Gateway") })
    );
  });
});
