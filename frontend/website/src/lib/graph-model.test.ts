// @vitest-environment node
import { expect, test } from "vitest";
import { detectNodeType, normalizeNodeInput } from "./graph-model";

const address = "0x658729879fca881d9526480b82ae00efc54b5c2d";
const mixedCase = "0x658729879FCA881D9526480B82AE00EFC54B5C2D";

test("pasted values are recognised as the right node type", () => {
  expect(detectNodeType(address)).toBe("wallet");
  expect(detectNodeType(`8453:${mixedCase}`)).toBe("wallet");
  expect(detectNodeType("metamask-verify.io")).toBe("domain");
  expect(detectNodeType("https://www.metamask-verify.io/")).toBe("domain");
  expect(detectNodeType("https://collector.example/api/v1")).toBe("endpoint");
  expect(detectNodeType("@ledgerhq/connect-kit@1.1.7")).toBe("package");
  expect(detectNodeType("pkg:npm/evil@1.0.0")).toBe("package");
  expect(detectNodeType("https://www.npmjs.com/package/evil/v/1.0.0")).toBe("package");
  expect(detectNodeType("owner/name")).toBe("repo");
  expect(detectNodeType("https://github.com/owner/name")).toBe("repo");
  expect(detectNodeType("not an id")).toBeNull();
  expect(detectNodeType("")).toBeNull();
});

test("inputs normalise to the canonical ids the API stores", () => {
  expect(normalizeNodeInput("wallet", mixedCase)).toEqual({ id: `1:${address}` });
  expect(normalizeNodeInput("wallet", address, 8453)).toEqual({ id: `8453:${address}` });
  expect(normalizeNodeInput("wallet", `010:${address}`)).toEqual({ id: `10:${address}` });
  expect(normalizeNodeInput("domain", "https://WWW.MetaMask-Verify.io/login?x=1")).toEqual({ id: "metamask-verify.io" });
  expect(normalizeNodeInput("package", "@ledgerhq/connect-kit@1.1.7")).toEqual({ id: "pkg:npm/@ledgerhq/connect-kit@1.1.7" });
  expect(normalizeNodeInput("package", "https://www.npmjs.com/package/@scope/x/v/2.0.1")).toEqual({ id: "pkg:npm/@scope/x@2.0.1" });
  expect(normalizeNodeInput("package", "PKG:NPM/evil@1.0.0")).toEqual({ id: "pkg:npm/evil@1.0.0" });
  expect(normalizeNodeInput("repo", "https://github.com/Owner/Name.git")).toEqual({ id: "github:owner/name" });
  expect(normalizeNodeInput("repo", "github:Owner/Name")).toEqual({ id: "github:owner/name" });
  expect(normalizeNodeInput("endpoint", "http://Collector.example/api/?q=1")).toEqual({ id: "http://collector.example/api" });
  expect(normalizeNodeInput("endpoint", "collector.example/api")).toEqual({ id: "https://collector.example/api" });
});

test("bad inputs explain what is expected", () => {
  expect(normalizeNodeInput("wallet", "0x1234").error).toMatch(/does not look like a wallet/);
  expect(normalizeNodeInput("package", "evil").error).toMatch(/Add the version, e.g. evil@1.0.0/);
  expect(normalizeNodeInput("package", "https://www.npmjs.com/package/evil").error).toMatch(/Add the version/);
  expect(normalizeNodeInput("domain", "").error).toMatch(/Enter a domain/);
  expect(normalizeNodeInput("endpoint", "ftp://x.example/a").error).toMatch(/does not look like an endpoint/);
});
