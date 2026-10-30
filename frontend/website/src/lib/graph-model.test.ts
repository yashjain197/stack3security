// @vitest-environment node
import { expect, test } from "vitest";
import { validateNodeId } from "./graph-model";

const seedWallet = "1:0x658729879fca881d9526480b82ae00efc54b5c2d";

test("node id validation matches the documented formats", () => {
  expect(validateNodeId("wallet", seedWallet)).toBeNull();
  expect(validateNodeId("domain", "metamask-verify.io")).toBeNull();
  expect(validateNodeId("package", "pkg:npm/@ledgerhq/connect-kit@1.1.7")).toBeNull();
  expect(validateNodeId("repo", "github:owner/name")).toBeNull();
  expect(validateNodeId("endpoint", "https://collector.example/api")).toBeNull();
  expect(validateNodeId("wallet", "0x1234")).toMatch(/does not look like a wallet id/);
  expect(validateNodeId("repo", "owner/name")).toMatch(/github:owner\/name/);
  expect(validateNodeId("endpoint", "http://insecure.example")).toMatch(/https:\/\//);
  expect(validateNodeId("domain", "")).toMatch(/Enter a domain id/);
});
