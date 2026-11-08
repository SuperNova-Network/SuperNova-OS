import { test } from "node:test";
import assert from "node:assert/strict";
import { createPolicy } from "../src/policy.js";
import config from "../config.js";

const policy = createPolicy(config.filter);

test("listed hosts are blocked, including subdomains and www", () => {
  assert.equal(policy.checkHost("pornhub.com"), "host");
  assert.equal(policy.checkHost("www.xvideos.com"), "host");
  assert.equal(policy.checkHost("a.b.c.pornhub.com"), "host");
  assert.equal(policy.checkHost("PORNHUB.COM"), "host", "case-insensitive");
  assert.equal(policy.checkHost("pornhub.com."), "host", "trailing dot");
});

test("a host that merely ends with a blocked name is not blocked", () => {
  assert.equal(policy.checkHost("notxvideos.com"), null);
  assert.equal(policy.checkHost("xvideos.com.example.org"), null);
});

test("blocked top-level domains", () => {
  assert.equal(policy.checkHost("anything.xxx"), "tld");
  assert.equal(policy.checkHost("shop.adult"), "tld");
});

test("keyword blocking applies to hostnames only and spares innocent words", () => {
  assert.equal(policy.checkHost("free-porn-tube.net"), "keyword");
  for (const ok of ["essex.ac.uk", "sussex.edu", "middlesexhospital.org", "adult-education.org", "sextant.example", "wikipedia.org", "example.com"]) {
    assert.equal(policy.checkHost(ok), null, ok);
  }
});

test("search queries are matched by whole word", () => {
  assert.equal(policy.checkQuery("free porn"), "query");
  assert.equal(policy.checkQuery("PORN"), "query");
  assert.equal(policy.checkQuery("nude beach"), "query");
  assert.equal(policy.checkQuery("sex education curriculum"), null, "health education is allowed");
  assert.equal(policy.checkQuery("pornography law"), null, "whole words only");
  assert.equal(policy.checkQuery("sussex weather"), null);
  assert.equal(policy.checkQuery("pornhub"), null, "hostnames are handled by checkHost");
});

test("a disabled policy blocks nothing", () => {
  const off = createPolicy({ ...config.filter, enabled: false });
  assert.equal(off.checkHost("pornhub.com"), null);
  assert.equal(off.checkQuery("porn"), null);
  assert.equal(off.wispBlacklist(), null);
});

test("the Wisp blacklist agrees with checkHost", () => {
  const patterns = policy.wispBlacklist();
  const blocked = (host) => patterns.some((re) => re.test(host));
  for (const host of ["pornhub.com", "cdn.xvideos.com", "foo.xxx", "free-porn-tube.net"]) assert.equal(blocked(host), true, host);
  for (const host of ["essex.ac.uk", "example.com", "notxvideos.com", "xvideos.com.example.org"]) assert.equal(blocked(host), false, host);
});

test("extra hosts can be supplied by the operator", () => {
  const custom = createPolicy({ hosts: ["Games.Example"] });
  assert.equal(custom.checkHost("play.games.example"), "host");
  assert.equal(custom.checkHost("example"), null);
});
