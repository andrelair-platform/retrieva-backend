/**
 * isAllowedResearchUrl (ADR-0003, E5) — the SSRF / allow-list gate for the one outbound path.
 * Security-critical: these cases are the contract that keeps the research agent from being an SSRF
 * primitive. Pure, no network.
 */
import { describe, it, expect } from 'vitest';

const { isAllowedResearchUrl } = await import('../../services/research/urlGuard.js');

const ALLOW = ['notion.so', 'stripe.com'];

describe('isAllowedResearchUrl — allowed', () => {
  it('accepts an exact allow-listed host over https', () => {
    expect(isAllowedResearchUrl('https://notion.so/security', ALLOW)).toEqual({
      ok: true,
      host: 'notion.so',
    });
  });
  it('accepts a subdomain of an allow-listed domain', () => {
    const r = isAllowedResearchUrl('https://trust.notion.so/subprocessors', ALLOW);
    expect(r.ok).toBe(true);
    expect(r.host).toBe('trust.notion.so');
  });
  it('accepts the explicit default https port', () => {
    expect(isAllowedResearchUrl('https://stripe.com:443/legal', ALLOW).ok).toBe(true);
  });
});

describe('isAllowedResearchUrl — rejected (SSRF + allow-list)', () => {
  const rejects = {
    'plain http': 'http://notion.so/x',
    'a non-allow-listed host': 'https://evil.com/x',
    'a look-alike suffix (not a real subdomain)': 'https://evilnotion.so/x',
    'a host that merely contains the domain': 'https://notion.so.evil.com/x',
    'an IPv4 literal (metadata/loopback SSRF)': 'https://169.254.169.254/latest/meta-data',
    'loopback by IP': 'https://127.0.0.1/x',
    'an IPv6 literal': 'https://[::1]/x',
    'embedded credentials': 'https://user:pass@notion.so/x',
    'a non-default port': 'https://notion.so:8080/x',
    'a non-URL': 'not a url',
    'a file URL': 'file:///etc/passwd',
  };
  for (const [label, url] of Object.entries(rejects)) {
    it(`rejects ${label}`, () => {
      const r = isAllowedResearchUrl(url, ALLOW);
      expect(r.ok).toBe(false);
      expect(r.reason).toBeTruthy();
    });
  }

  it('rejects everything when the allow-list is empty', () => {
    expect(isAllowedResearchUrl('https://notion.so/x', []).ok).toBe(false);
  });
});
