// Unit: Resend email provider — used when configured, truthful otherwise.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import ml from '../../src/lib/mailer.ts';

const { resendConfigured, sendMail } = ml;

const realFetch = globalThis.fetch;

function saveEnv() {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM: process.env.RESEND_FROM,
    SMTP_HOST: process.env.SMTP_HOST,
  };
}
function restoreEnv(saved) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('resendConfigured', () => {
  it('is false without a key', () => {
    const saved = saveEnv();
    delete process.env.RESEND_API_KEY;
    try {
      assert.equal(resendConfigured(), false);
    } finally {
      restoreEnv(saved);
    }
  });
});

describe('sendMail via Resend', () => {
  it('sends through the Resend API when a key is set', async () => {
    const saved = saveEnv();
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.SMTP_HOST;
    const calls = [];
    globalThis.fetch = (async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ id: 'test-id' }) };
    });
    try {
      const r = await sendMail({ to: 'ngo@example.org', subject: 'S', text: 'B' });
      assert.equal(r.channel, 'resend');
      assert.equal(r.ok, true);
      assert.equal(calls.length, 1);
      assert.match(String(calls[0].url), /api\.resend\.com\/emails/);
      const body = JSON.parse(calls[0].init.body);
      assert.equal(body.to, 'ngo@example.org');
    } finally {
      restoreEnv(saved);
    }
  });

  it('records Resend API rejections truthfully instead of claiming success', async () => {
    const saved = saveEnv();
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.SMTP_HOST;
    globalThis.fetch = (async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Can only send to your own email address' }),
    }));
    try {
      const r = await sendMail({ to: 'ngo@example.org', subject: 'S', text: 'B' });
      assert.equal(r.channel, 'resend');
      assert.equal(r.ok, false);
      assert.match(r.error ?? '', /own email address/);
    } finally {
      restoreEnv(saved);
    }
  });

  it('falls back to simulated delivery when neither Resend nor SMTP is set', async () => {
    const saved = saveEnv();
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    try {
      const r = await sendMail({ to: 'ngo@example.org', subject: 'S', text: 'B' });
      assert.equal(r.channel, 'simulated');
      assert.equal(r.ok, true);
    } finally {
      restoreEnv(saved);
    }
  });
});
