// lifeinc-report.mjs — weekly SEO report for Life Inc, emailed via Resend.
// Auth: GA_KEY_JSON env (full service-account JSON) or ./.ga-key.json.
// Send: RESEND_API_KEY env. Preview (no send): MODE=preview → writes ./scripts/_preview.html
import { createSign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const KEY = process.env.GA_KEY_JSON ? JSON.parse(process.env.GA_KEY_JSON)
  : JSON.parse(readFileSync(new URL('./.ga-key.json', import.meta.url), 'utf8'));
const SITE = 'https://lifeinc.com.sg/';
// Scheduled runs (no REPORT_TO) go to the client; manual test runs pass REPORT_TO to send to yourself first.
const TO = (process.env.REPORT_TO && process.env.REPORT_TO.trim()) || 'hello@lifeinc.com.sg';
const GREET = 'Hi Iris \u{1F44B}';
const n = v => Number(v) || 0, iso = d => d.toISOString().slice(0, 10);
const b64 = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function token(scope) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = b64(JSON.stringify({ iss: KEY.client_email, scope, aud: KEY.token_uri, iat: now, exp: now + 3600 }));
  const s = createSign('RSA-SHA256'); s.update(h + '.' + c); s.end();
  const jwt = h + '.' + c + '.' + b64(s.sign(KEY.private_key));
  const r = await (await fetch(KEY.token_uri, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) })).json();
  if (!r.access_token) throw new Error('token: ' + JSON.stringify(r));
  return r.access_token;
}
async function gsc(T, body) {
  const r = await (await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (r.error) throw new Error('gsc: ' + r.error.message); return r.rows || [];
}

const T = await token('https://www.googleapis.com/auth/webmasters.readonly');
const today = new Date();
const end = new Date(today.getTime() - 2 * 864e5);        // GSC lags ~2d
const start = new Date(end.getTime() - 6 * 864e5);         // last 7d
const pEnd = new Date(start.getTime() - 1 * 864e5), pStart = new Date(pEnd.getTime() - 6 * 864e5); // prior 7d
const sum = async (a, b) => (await gsc(T, { startDate: iso(a), endDate: iso(b), dimensions: [], type: 'web' }))[0] || {};
const cur = await sum(start, end), prev = await sum(pStart, pEnd);
const q = await gsc(T, { startDate: iso(start), endDate: iso(end), dimensions: ['query'], type: 'web', rowLimit: 1000 });
const p = await gsc(T, { startDate: iso(start), endDate: iso(end), dimensions: ['page'], type: 'web', rowLimit: 50 });
const topQ = q.sort((a, b) => n(b.impressions) - n(a.impressions)).slice(0, 8);
const topP = p.sort((a, b) => n(b.impressions) - n(a.impressions)).slice(0, 6);
const fmtWk = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const delta = (c, pv, inv = false) => { if (!pv) return c ? '<span style="color:#0ea968">new</span>' : ''; const d = Math.round((c - pv) / pv * 100); if (d === 0) return '<span style="color:#9aa0ad">&plusmn;0%</span>'; const up = d > 0; const good = inv ? !up : up; return '<span style="color:' + (good ? '#0ea968' : '#e0424f') + '">' + (up ? '&#9650;' : '&#9660;') + ' ' + Math.abs(d) + '%</span>'; };
const data = {
  impr: n(cur.impressions), clk: n(cur.clicks), pos: +n(cur.position).toFixed(1), ctr: +(n(cur.ctr) * 100).toFixed(1),
  pImpr: n(prev.impressions), pClk: n(prev.clicks), pPos: +n(prev.position).toFixed(1)
};

const cell = (label, val, d) => `<td style="padding:14px 8px;text-align:center;border:1px solid #e7e9ef;background:#fff">
  <div style="font-size:26px;font-weight:800;color:#1e2432;line-height:1">${val}</div>
  <div style="font-size:11px;color:#6b7280;margin-top:4px;text-transform:uppercase;letter-spacing:.04em">${label}</div>
  <div style="font-size:12px;margin-top:3px">${d || '&nbsp;'}</div></td>`;
const summary = data.impr === 0
  ? `Your site is live and indexed, but Google hasn&rsquo;t shown it in many searches yet this week &mdash; normal for a newer site. As we add content and links, impressions start to climb.`
  : `Your site appeared in Google <b>${data.impr.toLocaleString()}</b> times this week, and was clicked <b>${data.clk}</b> time${data.clk === 1 ? '' : 's'}. An average position of ${data.pos} means you&rsquo;re typically on ${data.pos <= 10 ? 'page 1' : data.pos <= 20 ? 'page 2' : 'page ' + Math.ceil(data.pos / 10)} &mdash; ${data.pos <= 15 ? 'close to the top' : 'and climbing'}.`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e2432">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
  <div style="text-align:center;padding:6px 0 18px"><span style="font-weight:800;font-size:15px;color:#5b57d6">HeyAda</span></div>
  <div style="background:#fff;border:1px solid #e7e9ef;border-radius:16px;overflow:hidden">
    <div style="background:#5b57d6;padding:22px 24px">
      <div style="color:#c7c5f5;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Weekly site report</div>
      <div style="color:#ffffff;font-size:22px;font-weight:800;margin-top:4px">Life Inc &mdash; how your site is doing</div>
      <div style="color:#c7c5f5;font-size:13px;margin-top:4px">lifeinc.com.sg &middot; week of ${fmtWk(start)}&ndash;${fmtWk(end)} 2026</div>
    </div>
    <div style="padding:22px 24px">
      <p style="margin:0 0 14px;font-size:15px">${GREET} Here&rsquo;s a quick snapshot of how Life Inc&rsquo;s website performed on Google search this week.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;margin:6px 0 4px">
        <tr>${cell('Impressions', data.impr.toLocaleString(), delta(data.impr, data.pImpr))}${cell('Clicks', data.clk, delta(data.clk, data.pClk))}${cell('Avg. position', data.pos || '&mdash;', delta(data.pos, data.pPos, true))}</tr>
      </table>
      <p style="font-size:11px;color:#9aa0ad;margin:6px 0 16px">Impressions = times you showed up in Google. Clicks = visits from search. Position = your average ranking (lower is better).</p>
      <div style="background:#eef0fc;border-left:3px solid #5b57d6;border-radius:8px;padding:12px 15px;font-size:14px;line-height:1.55;color:#3a4256">${summary}</div>
      ${topQ.length ? `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:22px 0 8px">Top searches you appeared for</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13.5px">
        ${topQ.map(r => `<tr><td style="padding:7px 6px;border-bottom:1px solid #eef0f3">${r.keys[0]}</td><td style="padding:7px 6px;border-bottom:1px solid #eef0f3;text-align:right;color:#6b7280;white-space:nowrap">${n(r.impressions)} impr &middot; pos ${Math.round(n(r.position))}</td></tr>`).join('')}
      </table>` : ''}
      ${topP.length ? `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:22px 0 8px">Most-seen pages</h3>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:13.5px">
        ${topP.map(r => `<tr><td style="padding:7px 6px;border-bottom:1px solid #eef0f3">${(r.keys[0].replace('https://lifeinc.com.sg', '') || '/')}</td><td style="padding:7px 6px;border-bottom:1px solid #eef0f3;text-align:right;color:#6b7280;white-space:nowrap">${n(r.impressions)} impr</td></tr>`).join('')}
      </table>` : ''}
      <p style="margin:22px 0 0;font-size:14px;line-height:1.55">Questions about any of this &mdash; or want to push a particular service or area? Just reply to this email and I&rsquo;ll help.</p>
      <p style="margin:14px 0 0;font-size:14px">&mdash; Eugene, HeyAda</p>
    </div>
  </div>
  <div style="text-align:center;color:#9aa0ad;font-size:11px;padding:16px 8px;line-height:1.5">
    Prepared by HeyAda for Life Inc &middot; data from Google Search Console<br>
    Reply to reach us &middot; <a href="mailto:eugeneteo1988@gmail.com?subject=Unsubscribe Life Inc report" style="color:#9aa0ad">unsubscribe</a>
  </div>
</div></body></html>`;

const text = `HeyAda site report - Life Inc\nlifeinc.com.sg - week of ${fmtWk(start)}-${fmtWk(end)} 2026\n\nHi Iris\n\nImpressions: ${data.impr}\nClicks: ${data.clk}\nAvg position: ${data.pos}\n\n${summary.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ')}\n\nTop searches:\n${topQ.map(r => `- ${r.keys[0]} (${n(r.impressions)} impr, pos ${Math.round(n(r.position))})`).join('\n') || '(none yet)'}\n\n- Eugene, HeyAda`;

if (process.env.MODE === 'preview') {
  writeFileSync(new URL('./_preview.html', import.meta.url), html);
  console.log('PREVIEW written | impr', data.impr, 'clk', data.clk, 'pos', data.pos, '| queries', topQ.length, '| pages', topP.length);
} else {
  const r = await (await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'HeyAda <reports@heyada.io>', to: [TO], reply_to: ['eugeneteo1988@gmail.com'], subject: '\u{1F4CA} Your site report — Life Inc', html, text, headers: { 'List-Unsubscribe': '<mailto:eugeneteo1988@gmail.com?subject=Unsubscribe Life Inc report>' } })
  })).json();
  console.log('SENT:', JSON.stringify(r));
}
