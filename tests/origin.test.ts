import { it, expect } from "vitest";
import { assertSameOrigin } from "../src/lib/request-origin";
it("accepts matching external Host behind an internal Next.js proxy", () => {
  expect(() =>
    assertSameOrigin(
      new Request("http://0.0.0.0:3002/api/admin", {
        headers: { origin: "http://localhost:3002", host: "localhost:3002" },
      }),
    ),
  ).not.toThrow();
});
it("rejects missing or cross-origin browser requests", () => {
  for (const origin of ["", "null", "https://evil.example"])
    expect(() =>
      assertSameOrigin(
        new Request("https://myshift.example/api/admin", {
          headers: { origin, host: "myshift.example" },
        }),
      ),
    ).toThrow();
});
it("rejects cross-site fetch metadata even with a matching host", () => {
  expect(() =>
    assertSameOrigin(
      new Request("https://myshift.example/api/admin", {
        headers: {
          origin: "https://myshift.example",
          host: "myshift.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    ),
  ).toThrow();
});
