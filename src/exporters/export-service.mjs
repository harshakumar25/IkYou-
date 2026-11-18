/**
 * Advanced Export Service for LocalFingerprint
 * Exports investigation findings to CSV, JSON, TXT, and Comprehensive Markdown Dossiers.
 */

export function exportToJson(results, query, type) {
  return JSON.stringify({
    query,
    type,
    generatedAt: new Date().toISOString(),
    totalMatches: results.length,
    results
  }, null, 2);
}

export function exportToCsv(results) {
  const headers = [
    "Platform", "Username", "DisplayName", "ProfileUrl", "Followers",
    "Following", "Verified", "Location", "Bio", "Website", "SourceQuery"
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const s = String(val).replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = results.map(r => [
    escapeCsv(r.platform),
    escapeCsv(r.username),
    escapeCsv(r.displayName),
    escapeCsv(r.profileUrl),
    escapeCsv(r.followers),
    escapeCsv(r.following),
    escapeCsv(r.isVerified ? "Yes" : "No"),
    escapeCsv(r.location),
    escapeCsv(r.bio),
    escapeCsv(r.website),
    escapeCsv(r.sourceQuery)
  ].join(","));

  return [headers.join(","), ...rows].join("\n");
}

export function exportToTextDossier(results, query, type) {
  const lines = [];
  lines.push("================================================================================");
  lines.push(" LOCALFINGERPRINT OSINT INVESTIGATION DOSSIER");
  lines.push(" Generated at: " + new Date().toUTCString());
  lines.push(` Target Query: ${query} (Type: ${type.toUpperCase()})`);
  lines.push(` Total Confirmed Profiles: ${results.length}`);
  lines.push("================================================================================\n");

  results.forEach((r, idx) => {
    lines.push(`[#${idx + 1}] PLATFORM: ${r.platform.toUpperCase()}`);
    lines.push(`  - Profile URL:   ${r.profileUrl}`);
    lines.push(`  - Username:      ${r.username}`);
    lines.push(`  - Display Name:  ${r.displayName}`);
    if (r.userId) lines.push(`  - User ID:       ${r.userId}`);
    if (r.isVerified) lines.push(`  - Verification:  VERIFIED`);
    if (r.isPrivate) lines.push(`  - Privacy:       PRIVATE ACCOUNT`);
    if (r.followers !== null && r.followers !== undefined) lines.push(`  - Followers:     ${r.followers}`);
    if (r.location) lines.push(`  - Location:      ${r.location}`);
    if (r.website) lines.push(`  - Website:       ${r.website}`);
    if (r.bio) lines.push(`  - Biography:     ${r.bio.replace(/\n/g, " ")}`);
    if (r.emails && r.emails.length) lines.push(`  - Emails:        ${r.emails.join(", ")}`);
    if (r.phones && r.phones.length) lines.push(`  - Phones:        ${r.phones.join(", ")}`);
    if (r.extras && Object.keys(r.extras).length) {
      lines.push(`  - Extras:        ${JSON.stringify(r.extras)}`);
    }
    if (r.discoveredUsernames && r.discoveredUsernames.length) {
      lines.push(`  - Discovered Linked Leads:`);
      r.discoveredUsernames.forEach(l => {
        lines.push(`      * ${l.username} (${l.entityType || "lead"} on ${l.foundOn})`);
      });
    }
    lines.push("--------------------------------------------------------------------------------");
  });

  return lines.join("\n");
}

export function exportToMarkdownDossier(results, query, type, graph = null) {
  const md = [];
  md.push(`# OSINT Intelligence Dossier: \`${query}\``);
  md.push(`*Generated on ${new Date().toUTCString()} by LocalFingerprint Edge Engine*\n`);

  // Exposure Scoring
  let verifiedCount = 0;
  const emails = new Set();
  const phones = new Set();
  const wallets = new Set();
  const secondaryLeads = new Set();

  results.forEach(r => {
    if (r.isVerified) verifiedCount++;
    (r.emails || []).forEach(e => emails.add(e));
    (r.phones || []).forEach(p => phones.add(p));
    (r.discoveredUsernames || []).forEach(l => {
      if (l.entityType === "crypto_wallet") wallets.add(l.username);
      else secondaryLeads.add(`${l.username} (${l.foundOn})`);
    });
  });

  const exposureScore = Math.min(100, (results.length * 4) + (emails.size * 10) + (wallets.size * 15) + (secondaryLeads.size * 5));

  md.push(`## 📊 Investigation Metrics`);
  md.push(`| Metric | Value |`);
  md.push(`| :--- | :--- |`);
  md.push(`| **Target Query** | \`${query}\` (${type.toUpperCase()}) |`);
  md.push(`| **Confirmed Accounts** | **${results.length}** platforms |`);
  md.push(`| **Verified Accounts** | **${verifiedCount}** |`);
  md.push(`| **Discovered Emails** | **${emails.size}** (${Array.from(emails).join(", ") || "None"}) |`);
  md.push(`| **Cryptocurrency Wallets** | **${wallets.size}** |`);
  md.push(`| **Digital Exposure Index** | **${exposureScore}/100** |`);
  md.push("");

  // Visual ASCII Identity Tree
  md.push(`## 🌳 Identity Correlation Tree`);
  md.push("```text");
  md.push(`Target [${query}]`);
  results.forEach((r, idx) => {
    const isLast = idx === results.length - 1;
    const branch = isLast ? "└──" : "├──";
    md.push(`${branch} [${r.platform}] @${r.username} (${r.profileUrl})`);
    if (r.discoveredUsernames && r.discoveredUsernames.length) {
      r.discoveredUsernames.forEach((l, lIdx) => {
        const subBranch = lIdx === r.discoveredUsernames.length - 1 ? "    └── 🔗 Discovered:" : "    ├── 🔗 Discovered:";
        md.push(`${subBranch} @${l.username} on ${l.foundOn}`);
      });
    }
  });
  md.push("```\n");

  // Detailed Accounts Table
  md.push(`## 📋 Confirmed Digital Accounts`);
  md.push(`| Platform | Handle | Display Name | Followers | Disambiguation | Link |`);
  md.push(`| :--- | :--- | :--- | :--- | :--- | :--- |`);
  results.forEach(r => {
    const link = `[Profile](${r.profileUrl})`;
    let disVerdict = "Public";
    if (r.disambiguation) {
      disVerdict = r.disambiguation.isTargetMatch
        ? `🎯 Target (${Math.round(r.disambiguation.confidenceScore * 100)}%)`
        : (r.disambiguation.isHomonym ? `⚠️ Homonym (${Math.round(r.disambiguation.confidenceScore * 100)}%)` : `🔍 Lead`);
    } else if (r.isVerified) {
      disVerdict = "✔ Verified";
    }
    md.push(`| **${r.platform}** | \`${r.username}\` | ${r.displayName || "-"} | ${r.followers ?? "-"} | ${disVerdict} | ${link} |`);
  });
  md.push("");

  // Cryptographic & VCS Forensics Section
  const provResults = results.filter(r => r.provenance && (r.provenance.sshKeys?.length || r.provenance.commitEmails?.length));
  if (provResults.length > 0) {
    md.push(`## 🔑 Cryptographic & VCS Provenance Forensics`);
    provResults.forEach(r => {
      const prov = r.provenance;
      md.push(`### Platform: ${r.platform} (@${r.username})`);
      if (prov.timezone) {
        md.push(`- **Commit Timezone & Local Clock**: \`${prov.timezone.rawOffset}\` — ${prov.timezone.name}`);
        md.push(`- **Latest Commit Date**: \`${prov.timezone.commitDate}\``);
      }
      if (prov.commitEmails?.length) {
        md.push(`- **Recovered Commit Author Emails**: ${prov.commitEmails.map(e => `\`${e}\``).join(", ")}`);
      }
      if (prov.commitAuthors?.length) {
        md.push(`- **Git Commit Author Names**: ${prov.commitAuthors.map(a => `\`${a}\``).join(", ")}`);
      }
      if (prov.sshKeys?.length) {
        md.push(`- **Public SSH Keys**:`);
        prov.sshKeys.forEach(k => {
          md.push(`  - \`${k.type}\` Fingerprint: \`${k.fingerprint}\` ${k.comment ? `(${k.comment})` : ""}`);
        });
      }
      if (prov.repos?.length) {
        md.push(`- **Public Repositories**: ${prov.repos.map(repo => `\`${repo}\``).join(", ")}`);
      }
      md.push("");
    });
  }

  // Visual Avatar Hashes Section
  const avatarResults = results.filter(r => r.avatarFingerprint);
  if (avatarResults.length > 0) {
    md.push(`## 🖼️ Visual Biometric Avatar Hashes`);
    md.push(`| Platform | Handle | SHA-256 Image Digest | Perceptual 64-bit Hash |`);
    md.push(`| :--- | :--- | :--- | :--- |`);
    avatarResults.forEach(r => {
      const fp = r.avatarFingerprint;
      md.push(`| **${r.platform}** | \`@${r.username}\` | \`${fp.sha256.slice(0, 16)}...\` | \`${fp.perceptualHash}\` |`);
    });
    md.push("");
  }

  return md.join("\n");
}

/**
 * Generate a self-contained, print-to-PDF ready Forensic HTML Investigation Dossier.
 * @param {Array<object>} results
 * @param {string} query
 * @param {string} type
 * @param {object} [graph=null]
 * @returns {string} Standalone HTML Document
 */
export function exportToHtmlDossier(results, query, type, graph = null) {
  const generatedAt = new Date().toUTCString();
  const caseId = "LP-" + Math.random().toString(36).substring(2, 10).toUpperCase();

  const emails = new Set();
  const phones = new Set();
  let verifiedCount = 0;
  let targetMatchCount = 0;
  let visualTwinsCount = 0;

  results.forEach(r => {
    if (r.isVerified) verifiedCount++;
    if (r.disambiguation?.isTargetMatch) targetMatchCount++;
    if (r.visualTwins?.length) visualTwinsCount += r.visualTwins.length;
    (r.emails || []).forEach(e => emails.add(e));
    (r.phones || []).forEach(p => phones.add(p));
  });

  const exposureScore = Math.min(100, (results.length * 4) + (emails.size * 10) + (phones.size * 10) + (verifiedCount * 8));

  const escapeHtml = (str) => {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OSINT Investigation Dossier - ${escapeHtml(query)} [${caseId}]</title>
  <style>
    :root {
      --bg: #0b0d13;
      --card-bg: #141721;
      --border: rgba(255,255,255,0.08);
      --accent-cyan: #00e5ff;
      --accent-green: #00e676;
      --accent-gold: #ffd700;
      --accent-red: #ff5252;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding: 32px 24px;
    }
    .dossier-wrapper { max-width: 1040px; margin: 0 auto; }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid var(--border);
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .header-title h1 { font-size: 26px; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
    .header-title .case-meta { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
    .print-actions button {
      background: rgba(0,229,255,0.15);
      color: var(--accent-cyan);
      border: 1px solid rgba(0,229,255,0.3);
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 13px;
    }
    .print-actions button:hover { background: rgba(0,229,255,0.25); }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 28px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      text-align: center;
    }
    .kpi-num { font-size: 24px; font-weight: 700; color: var(--accent-cyan); }
    .kpi-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-top: 4px; }
    .section-title {
      font-size: 17px;
      font-weight: 600;
      color: #fff;
      margin: 28px 0 12px 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow-x: auto;
      margin-bottom: 24px;
    }
    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    th { background: rgba(255,255,255,0.03); padding: 12px 14px; color: var(--text-muted); font-weight: 600; border-bottom: 1px solid var(--border); }
    td { padding: 12px 14px; border-bottom: 1px solid var(--border); color: #cbd5e1; vertical-align: top; }
    tr:last-child td { border-bottom: none; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-target { background: rgba(0,230,118,0.15); color: var(--accent-green); border: 1px solid rgba(0,230,118,0.3); }
    .badge-verified { background: rgba(0,229,255,0.15); color: var(--accent-cyan); border: 1px solid rgba(0,229,255,0.3); }
    .badge-homonym { background: rgba(255,82,82,0.15); color: var(--accent-red); border: 1px solid rgba(255,82,82,0.3); }
    .badge-twin { background: rgba(255,215,0,0.15); color: var(--accent-gold); border: 1px solid rgba(255,215,0,0.3); }
    .card-grid { display: grid; grid-template-columns: 1fr; gap: 14px; }
    .detail-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .detail-header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .avatar-thumb { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border); }
    .detail-bio { font-size: 12px; color: #cbd5e1; margin: 8px 0; background: rgba(0,0,0,0.2); padding: 8px 10px; border-radius: 6px; }
    .forensic-box { margin-top: 10px; padding: 10px; border-radius: 6px; font-size: 12px; }
    .box-git { background: rgba(0,229,255,0.05); border: 1px solid rgba(0,229,255,0.2); }
    .box-telecom { background: rgba(0,230,118,0.05); border: 1px solid rgba(0,230,118,0.2); }
    .box-twin { background: rgba(255,215,0,0.05); border: 1px solid rgba(255,215,0,0.2); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; background: rgba(255,255,255,0.06); padding: 2px 4px; border-radius: 3px; }
    a { color: var(--accent-cyan); text-decoration: none; }
    a:hover { text-decoration: underline; }
    @media print {
      body { background: #ffffff !important; color: #1e293b !important; padding: 0 !important; }
      .print-actions { display: none !important; }
      .header-title h1 { color: #0f172a !important; }
      .kpi-card, .table-container, .detail-card {
        background: #ffffff !important;
        border: 1px solid #cbd5e1 !important;
        color: #0f172a !important;
        page-break-inside: avoid;
      }
      th { background: #f8fafc !important; color: #475569 !important; border-bottom: 1px solid #cbd5e1 !important; }
      td { border-bottom: 1px solid #e2e8f0 !important; color: #1e293b !important; }
      .detail-bio, .forensic-box { background: #f8fafc !important; border-color: #e2e8f0 !important; color: #334155 !important; }
      code { background: #f1f5f9 !important; color: #0f172a !important; border: 1px solid #cbd5e1 !important; }
      a { color: #0284c7 !important; }
    }
  </style>
</head>
<body>
  <div class="dossier-wrapper">
    <header class="header-bar">
      <div class="header-title">
        <h1>OSINT Forensic Investigation Dossier</h1>
        <div class="case-meta">
          <strong>Case:</strong> ${escapeHtml(caseId)} &nbsp;|&nbsp;
          <strong>Target Query:</strong> \`${escapeHtml(query)}\` (${escapeHtml(type.toUpperCase())}) &nbsp;|&nbsp;
          <strong>Generated:</strong> ${escapeHtml(generatedAt)}
        </div>
      </div>
      <div class="print-actions">
        <button onclick="window.print()">🖨️ Print / Save as PDF</button>
      </div>
    </header>

    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-num">${results.length}</div>
        <div class="kpi-label">Confirmed Profiles</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:var(--accent-green);">${targetMatchCount}</div>
        <div class="kpi-label">Target Matches</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">${verifiedCount}</div>
        <div class="kpi-label">Platform Verified</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">${emails.size}</div>
        <div class="kpi-label">Recovered Emails</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">${phones.size}</div>
        <div class="kpi-label">Telecom Numbers</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num" style="color:var(--accent-gold);">${visualTwinsCount}</div>
        <div class="kpi-label">Visual Twins</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">${exposureScore}/100</div>
        <div class="kpi-label">Exposure Score</div>
      </div>
    </div>

    <h2 class="section-title">📋 Confirmed Digital Accounts Matrix</h2>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Platform</th>
            <th>Handle</th>
            <th>Display Name</th>
            <th>Verdict / Match</th>
            <th>Followers</th>
            <th>Outlinks / Assets</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          ${results.map(r => {
            let verdict = '<span class="badge" style="background:rgba(255,255,255,0.06);color:#94a3b8;">Public</span>';
            if (r.disambiguation?.isTargetMatch) {
              verdict = `<span class="badge badge-target">🎯 Target (${Math.round(r.disambiguation.confidenceScore * 100)}%)</span>`;
            } else if (r.disambiguation?.isHomonym) {
              verdict = `<span class="badge badge-homonym">⚠️ Homonym</span>`;
            } else if (r.isVerified) {
              verdict = `<span class="badge badge-verified">✔ Verified</span>`;
            }
            return `
              <tr>
                <td><strong>${escapeHtml(r.platform)}</strong></td>
                <td><code>@${escapeHtml(r.username)}</code></td>
                <td>${escapeHtml(r.displayName || "-")}</td>
                <td>${verdict}</td>
                <td>${r.followers !== null && r.followers !== undefined ? escapeHtml(String(r.followers)) : "-"}</td>
                <td style="font-size:11px;">
                  ${r.emails?.length ? `<div>✉ ${escapeHtml(r.emails.join(", "))}</div>` : ''}
                  ${r.phones?.length ? `<div>📞 ${escapeHtml(r.phones.join(", "))}</div>` : ''}
                  ${r.extras?.threadsHandle ? `<div>Threads: @${escapeHtml(r.extras.threadsHandle)}</div>` : ''}
                  ${r.extras?.registrationEst ? `<div>Est. Reg: ${escapeHtml(r.extras.registrationEst.period)}</div>` : ''}
                </td>
                <td><a href="${escapeHtml(r.profileUrl)}" target="_blank" rel="noopener noreferrer">Open ↗</a></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>

    <h2 class="section-title">🔬 Deep Account Forensic Profiles</h2>
    <div class="card-grid">
      ${results.map(r => `
        <div class="detail-card">
          <div class="detail-header">
            ${r.pfpUrl ? `<img src="${escapeHtml(r.pfpUrl)}" alt="${escapeHtml(r.platform)}" class="avatar-thumb" onerror="this.style.display='none'">` : ''}
            <div>
              <div style="font-size:15px;font-weight:600;color:#fff;">
                ${escapeHtml(r.displayName || r.username)}
                <span style="font-size:12px;color:var(--text-muted);font-weight:normal;">(@${escapeHtml(r.username)})</span>
                <span class="badge" style="margin-left:6px;background:rgba(255,255,255,0.08);color:#94a3b8;">${escapeHtml(r.platform)}</span>
                ${r.userId ? `<code style="margin-left:4px;">ID: ${escapeHtml(r.userId)}</code>` : ''}
                ${r.extras?.registrationEst ? `<span class="badge" style="background:rgba(59,130,246,0.15);color:#60a5fa;border:1px solid rgba(59,130,246,0.3);margin-left:4px;">📅 Reg: ${escapeHtml(r.extras.registrationEst.period)}</span>` : ''}
              </div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
                ${r.location ? `📍 ${escapeHtml(r.location)} &nbsp;|&nbsp; ` : ''}
                Profile: <a href="${escapeHtml(r.profileUrl)}" target="_blank">${escapeHtml(r.profileUrl)}</a>
              </div>
            </div>
          </div>
          ${r.bio ? `<div class="detail-bio">${escapeHtml(r.bio)}</div>` : ''}
          ${r.visualTwins?.length ? `
            <div class="forensic-box box-twin">
              <strong style="color:var(--accent-gold);">🖼️ Visual Biometric Twins Detected:</strong>
              ${r.visualTwins.map(t => `<div>• Matched with <strong>${escapeHtml(t.platform)}</strong> (@${escapeHtml(t.username)}) &mdash; ${Math.round(t.similarity * 100)}% visual match (${escapeHtml(t.reason)})</div>`).join("")}
            </div>
          ` : ''}
          ${r.provenance ? `
            <div class="forensic-box box-git">
              <strong style="color:var(--accent-cyan);">🔑 Cryptographic & Git VCS Provenance:</strong>
              ${r.provenance.timezone ? `<div>• Commit Timezone: <code>${escapeHtml(r.provenance.timezone.rawOffset)}</code> (${escapeHtml(r.provenance.timezone.name)})</div>` : ''}
              ${r.provenance.commitEmails?.length ? `<div>• Author Commit Emails: <strong>${escapeHtml(r.provenance.commitEmails.join(", "))}</strong></div>` : ''}
              ${r.provenance.sshKeys?.length ? `<div>• Public SSH Key: <code>${escapeHtml(r.provenance.sshKeys[0].fingerprint)}</code></div>` : ''}
            </div>
          ` : ''}
          ${r.extras?.carrier || r.extras?.lineType ? `
            <div class="forensic-box box-telecom">
              <strong style="color:var(--accent-green);">📡 Telecom & Carrier Allocation:</strong>
              <div>• Carrier: <strong>${escapeHtml(r.extras.carrier || "Regional")}</strong> &nbsp;|&nbsp; Line: <strong>${escapeHtml(r.extras.lineType || "Standard")}</strong> &nbsp;|&nbsp; Subdivision: <strong>${escapeHtml(r.extras.region || "National")}</strong> &nbsp;|&nbsp; Timezone: <strong>${escapeHtml(r.extras.timezone || "UTC")}</strong></div>
            </div>
          ` : ''}
        </div>
      `).join("")}
    </div>

    <footer style="margin-top:40px;padding-top:16px;border-top:1px solid var(--border);text-align:center;font-size:11px;color:var(--text-muted);">
      LocalFingerprint Edge Forensics Engine &bull; Non-authenticated passive OSINT verification &bull; Generated ${escapeHtml(generatedAt)}
    </footer>
  </div>
</body>
</html>`;
}
