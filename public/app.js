/**
 * LocalFingerprint Edge-Native Web Client
 * Connects to /api/search via Server-Sent Events (SSE), renders real-time OSINT discoveries,
 * and visualizes identity relationship graphs and edge passive telemetry.
 */
document.addEventListener("DOMContentLoaded", () => {
  // Navigation Tabs
  const navBtns = document.querySelectorAll(".nav-btn");
  const tabPanes = document.querySelectorAll(".tab-pane");

  navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      navBtns.forEach(b => b.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const target = document.getElementById(btn.dataset.tab);
      if (target) {
        target.classList.add("active");
        if (btn.dataset.tab === "graph-view") {
          fetchAndRenderGraph();
        } else if (btn.dataset.tab === "edge-view") {
          fetchEdgeTelemetry();
        }
      }
    });
  });

  // Search Type Tabs
  const searchTabBtns = document.querySelectorAll(".search-tab-btn");
  const inputPrefix = document.getElementById("input-prefix");
  const queryInput = document.getElementById("query-input");
  const seedMatrixPanel = document.getElementById("seed-matrix-panel");
  const candidatesContainer = document.getElementById("candidates-container");
  const candidatePills = document.getElementById("candidate-pills");
  let currentSearchType = "username";
  let lastSearchQuery = "";
  let lastSearchType = "username";

  function setSearchType(type) {
    if (currentSearchType === type) return;
    currentSearchType = type;
    searchTabBtns.forEach(b => {
      b.classList.toggle("active", b.dataset.type === type);
    });

    if (currentSearchType === "username") {
      inputPrefix.textContent = "@";
      queryInput.placeholder = "Enter username (e.g. torvalds)...";
      if (seedMatrixPanel) seedMatrixPanel.classList.add("hidden");
    } else if (currentSearchType === "person") {
      inputPrefix.textContent = "👤";
      queryInput.placeholder = "Enter full name (e.g. Harsh Kumar)...";
      if (seedMatrixPanel) seedMatrixPanel.classList.remove("hidden");
    } else if (currentSearchType === "email") {
      inputPrefix.textContent = "✉";
      queryInput.placeholder = "Enter email address (e.g. target@example.com)...";
      if (seedMatrixPanel) seedMatrixPanel.classList.add("hidden");
    } else if (currentSearchType === "phone") {
      inputPrefix.textContent = "📞";
      queryInput.placeholder = "Enter phone number in international format (+14155550123)...";
      if (seedMatrixPanel) seedMatrixPanel.classList.add("hidden");
    }
  }

  let userExplicitlySelectedTab = false;

  searchTabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      userExplicitlySelectedTab = true;
      setSearchType(btn.dataset.type);
      queryInput.focus();
    });
  });

  // Search Elements
  const searchForm = document.getElementById("search-form");
  const submitBtn = document.getElementById("submit-btn");
  const btnText = document.getElementById("btn-text");
  const btnSpinner = document.getElementById("btn-spinner");
  const clearBtn = document.getElementById("clear-btn");
  const digToggle = document.getElementById("dig-toggle");
  const depthSelect = document.getElementById("depth-select");
  const digTypeSelect = document.getElementById("dig-type-select");
  const extendedToggle = document.getElementById("extended-toggle");

  // Stream Bar Elements
  const streamBar = document.getElementById("stream-bar");
  const foundCountEl = document.getElementById("found-count");
  const elapsedTimeEl = document.getElementById("elapsed-time");
  const checkedCountEl = document.getElementById("checked-count");
  const totalCountEl = document.getElementById("total-count");
  const progressBar = document.getElementById("progress-bar");
  const digLeadsContainer = document.getElementById("dig-leads-container");
  const digPills = document.getElementById("dig-pills");

  // Results & Filters Elements
  const resultsControls = document.getElementById("results-controls");
  const resultsContainer = document.getElementById("results-container");
  const emptyState = document.getElementById("empty-state");
  const filterInput = document.getElementById("filter-input");
  const filterChips = document.querySelectorAll(".filter-chip");

  // State
  let eventSource = null;
  let allResults = [];
  let discoveredLeads = new Set();
  let startTime = 0;
  let timerInterval = null;
  let activeFilterChips = new Set();
  let checkedTotal = 0;
  let platformsTotal = 0;

  // Clear Button & Input Type Detection logic
  queryInput.addEventListener("input", () => {
    const val = queryInput.value.trim();
    clearBtn.style.display = val ? "block" : "none";

    // If user hasn't locked in a tab explicitly, auto-switch based on input format
    if (!userExplicitlySelectedTab && val) {
      if (val.startsWith("+") || (/^\d[\d\s\-().]{6,}/.test(val) && val.replace(/\D/g, "").length >= 7)) {
        setSearchType("phone");
      } else if (val.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        setSearchType("email");
      } else if (val.includes(" ") && !val.includes("@") && !val.startsWith("+") && val.length >= 4) {
        setSearchType("person");
      }
    }
  });

  clearBtn.addEventListener("click", () => {
    queryInput.value = "";
    clearBtn.style.display = "none";
    queryInput.focus();
  });

  // Form Submission
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = queryInput.value.trim();
    if (!query) return;

    startSearch(query, currentSearchType);
  });

  function startSearch(query, type) {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    lastSearchQuery = query;
    lastSearchType = type;

    allResults = [];
    discoveredLeads.clear();
    resultsContainer.innerHTML = "";
    digPills.innerHTML = "";
    digLeadsContainer.classList.add("hidden");
    if (candidatePills) candidatePills.innerHTML = "";
    if (candidatesContainer) candidatesContainer.classList.add("hidden");
    const targetDossierPanel = document.getElementById("target-dossier-panel");
    if (targetDossierPanel) {
      targetDossierPanel.innerHTML = "";
      targetDossierPanel.classList.add("hidden");
    }
    emptyState.classList.add("hidden");
    streamBar.classList.remove("hidden");
    resultsControls.classList.remove("hidden");

    foundCountEl.textContent = "0";
    checkedCountEl.textContent = "0";
    totalCountEl.textContent = "0";
    progressBar.style.width = "0%";
    checkedTotal = 0;
    platformsTotal = 0;

    btnText.textContent = "Searching...";
    btnSpinner.classList.remove("hidden");
    submitBtn.disabled = true;

    startTime = Date.now();
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      elapsedTimeEl.textContent = ((Date.now() - startTime) / 1000).toFixed(1);
    }, 100);

    const dig = digToggle.checked;
    const depth = depthSelect.value;
    const digType = digTypeSelect ? digTypeSelect.value : "both";
    const extended = extendedToggle.checked;
    const deepRea = document.getElementById("deep-rea-toggle")?.checked ?? true;

    let seedQueryPart = "";
    if (type === "person") {
      const fn = document.getElementById("seed-first-name")?.value.trim() || query.split(/\s+/)[0] || "";
      const ln = document.getElementById("seed-last-name")?.value.trim() || query.split(/\s+/).slice(1).join(" ") || "";
      const num = document.getElementById("seed-numbers")?.value.trim() || "";
      const nick = document.getElementById("seed-nicknames")?.value.trim() || "";
      const kw = document.getElementById("seed-keywords")?.value.trim() || "";
      const loc = document.getElementById("seed-location")?.value.trim() || "";
      seedQueryPart = `&first_name=${encodeURIComponent(fn)}&last_name=${encodeURIComponent(ln)}&numbers=${encodeURIComponent(num)}&nicknames=${encodeURIComponent(nick)}&keywords=${encodeURIComponent(kw)}&location=${encodeURIComponent(loc)}`;
    }

    const streamUrl = `/api/search?query=${encodeURIComponent(query)}&type=${type}&dig=${dig}&dig_depth=${depth}&dig_type=${digType}&extended=${extended}&deep_rea=${deepRea}${seedQueryPart}`;

    eventSource = new EventSource(streamUrl);

    eventSource.addEventListener("connected", (e) => {
      console.log("[SSE] Connected to local edge stream");
    });

    eventSource.addEventListener("candidates", (e) => {
      try {
        const data = JSON.parse(e.data);
        if (candidatesContainer && candidatePills && data.candidates) {
          candidatesContainer.classList.remove("hidden");
          candidatePills.innerHTML = "";
          for (const cand of data.candidates) {
            const pill = document.createElement("span");
            pill.className = "dig-lead-badge";
            pill.style.borderColor = cand.isHomonymRisk ? "#ff5252" : "#00e676";
            pill.style.color = cand.isHomonymRisk ? "#ff5252" : "#00e676";
            pill.textContent = `@${cand.username}`;
            pill.title = `Prior Weight: ${cand.priorWeight} | Pattern: ${cand.pattern}`;
            candidatePills.appendChild(pill);
          }
        }
      } catch {}
    });

    eventSource.addEventListener("start", (e) => {
      try {
        const data = JSON.parse(e.data);
        platformsTotal = data.total || 30;
        totalCountEl.textContent = platformsTotal;
      } catch {}
    });

    eventSource.addEventListener("checked", (e) => {
      try {
        const data = JSON.parse(e.data);
        checkedTotal += data.total || 1;
        checkedCountEl.textContent = checkedTotal;
        const pct = Math.min(100, Math.round((checkedTotal / (platformsTotal || 1)) * 100));
        progressBar.style.width = `${pct}%`;
      } catch {}
    });

    eventSource.addEventListener("result", (e) => {
      try {
        const result = JSON.parse(e.data);
        allResults.push(result);
        foundCountEl.textContent = allResults.length;
        renderCard(result);
      } catch (err) {
        console.error("Failed to parse result payload:", err);
      }
    });

    eventSource.addEventListener("dig", (e) => {
      try {
        const lead = JSON.parse(e.data);
        const leadKey = `${lead.queryType}:${lead.username}`;
        if (!discoveredLeads.has(leadKey)) {
          discoveredLeads.add(leadKey);
          renderDigPill(lead);
        }
      } catch {}
    });

    eventSource.addEventListener("avatar_match", (e) => {
      try {
        const twin = JSON.parse(e.data);
        // Find existing cards and update with visual twin indicator
        const cards = document.querySelectorAll(".profile-card");
        cards.forEach(card => {
          const plat = card.querySelector(".card-platform")?.textContent.replace(/^📸\s*/, "").trim();
          const user = card.querySelector(".card-username")?.textContent.replace(/^@/, "").split(/\s+/)[0].trim();
          if ((plat === twin.source?.platform && user === twin.source?.username) ||
              (plat === twin.target?.platform && user === twin.target?.username)) {
            const row = card.querySelector(".card-platform-row");
            if (row && !card.querySelector(".badge-visual-twin")) {
              const twinBadge = document.createElement("span");
              twinBadge.className = "badge-visual-twin";
              twinBadge.textContent = `🖼️ Twin: @${twin.source.username} <=> @${twin.target.username}`;
              row.appendChild(twinBadge);
            }
          }
        });
      } catch {}
    });

    eventSource.addEventListener("done", () => {
      finishSearch();
    });

    eventSource.addEventListener("error", () => {
      finishSearch();
    });
  }

  function finishSearch() {
    clearInterval(timerInterval);
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    btnText.textContent = "Search";
    btnSpinner.classList.add("hidden");
    submitBtn.disabled = false;
    progressBar.style.width = "100%";
    checkedCountEl.textContent = platformsTotal || checkedTotal;

    if (allResults.length === 0) {
      emptyState.classList.remove("hidden");
      emptyState.querySelector("h3").textContent = "No profiles found";
      emptyState.querySelector("p").textContent = "No public accounts were verified for this query across checked platforms.";
    } else {
      renderTargetDossier(allResults, lastSearchQuery, lastSearchType);
    }
  }

  function renderDigPill(lead) {
    digLeadsContainer.classList.remove("hidden");
    const pill = document.createElement("button");
    pill.className = "dig-lead-badge";
    const isCrypto = lead.entityType === "crypto_wallet";
    if (isCrypto) {
      pill.style.borderColor = "#ffd600";
      pill.style.background = "rgba(255, 214, 0, 0.15)";
      pill.innerHTML = `💰 <strong>${lead.username.slice(0, 10)}...</strong> on ${lead.foundOn}`;
      pill.title = `Cryptocurrency Wallet Address: ${lead.username}`;
    } else {
      pill.innerHTML = `<strong>@${lead.username}</strong> on ${lead.foundOn}`;
      pill.title = `Click to launch investigation for @${lead.username}`;
      pill.addEventListener("click", () => {
        queryInput.value = lead.username;
        searchTabBtns.forEach(b => b.classList.remove("active"));
        document.querySelector(`.search-tab-btn[data-type="${lead.queryType || "username"}"]`)?.classList.add("active");
        currentSearchType = lead.queryType || "username";
        startSearch(lead.username, currentSearchType);
      });
    }
    digPills.appendChild(pill);
  }

  function renderCard(result) {
    const card = document.createElement("div");
    card.className = "profile-card";
    card.dataset.platform = (result.platform || "").toLowerCase();
    card.dataset.username = (result.username || "").toLowerCase();
    card.dataset.verified = result.isVerified ? "true" : "false";
    card.dataset.hasBio = result.bio ? "true" : "false";
    card.dataset.hasLocation = result.location ? "true" : "false";

    let disambiguationBadge = "";
    if (result.disambiguation) {
      card.dataset.isTarget = result.disambiguation.isTargetMatch ? "true" : "false";
      card.dataset.isHomonym = result.disambiguation.isHomonym ? "true" : "false";
      const pct = Math.round(result.disambiguation.confidenceScore * 100);
      if (result.disambiguation.isTargetMatch) {
        disambiguationBadge = `<span class="badge-target">🎯 TARGET MATCH (${pct}%)</span>`;
      } else if (result.disambiguation.isHomonym) {
        disambiguationBadge = `<span class="badge-homonym">⚠️ UNRELATED HOMONYM (${pct}%)</span>`;
      } else {
        disambiguationBadge = `<span class="badge-lead">🔍 POSSIBLE LEAD (${pct}%)</span>`;
      }
    }

    const pfpSrc = result.pfpUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(result.displayName || result.username)}&background=20222c&color=00e5ff`;

    let linkedAccountsHtml = "";
    const allLinked = [...(result.extras?.linkedAccounts || [])];
    if (result.extras?.threadsHandle && !allLinked.some(l => l.platform?.toLowerCase() === "threads")) {
      allLinked.push({
        platform: "Threads",
        username: result.extras.threadsHandle,
        url: `https://threads.net/@${result.extras.threadsHandle}`
      });
    }

    if (allLinked.length > 0) {
      linkedAccountsHtml = `
        <div class="linked-accounts-box" style="margin-top:8px;padding:6px 10px;background:rgba(56,189,248,0.06);border:1px solid rgba(56,189,248,0.25);border-radius:6px;font-size:11px;">
          <div style="font-weight:600;color:#38bdf8;margin-bottom:5px;display:flex;align-items:center;gap:4px;">
            <span>🔗 Connected Social Identities:</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${allLinked.map(acc => `
              <span class="linked-acc-chip" style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;background:rgba(0,0,0,0.3);border:1px solid rgba(56,189,248,0.3);border-radius:4px;">
                <strong style="color:#7dd3fc;">${escapeHtml(acc.platform)}:</strong>
                <a href="${escapeHtml(acc.url)}" target="_blank" rel="noopener noreferrer" style="color:#f1f5f9;text-decoration:none;">@${escapeHtml(acc.username)}</a>
                <button type="button" class="pivot-btn" data-username="${escapeHtml(acc.username)}" title="Pivot search this handle" style="background:none;border:none;color:#38bdf8;cursor:pointer;padding:0 2px;font-size:10px;">🔍</button>
              </span>
            `).join("")}
          </div>
        </div>
      `;
    }

    let outlinksHtml = "";
    const allOutlinks = Array.from(new Set([
      ...(result.website ? [result.website] : []),
      ...(result.extras?.outlinks || [])
    ])).filter(Boolean);

    if (allOutlinks.length > 0) {
      outlinksHtml = `
        <div class="outlinks-box" style="margin-top:8px;padding:6px 10px;background:rgba(224,64,251,0.06);border:1px solid rgba(224,64,251,0.25);border-radius:6px;font-size:11px;">
          <div style="font-weight:600;color:#e040fb;margin-bottom:5px;">🌐 Discovered External Web Presence:</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${allOutlinks.slice(0, 5).map(link => {
              const displayUrl = link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
              return `
                <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer" class="outlink-chip" style="display:inline-block;padding:2px 8px;background:rgba(0,0,0,0.3);border:1px solid rgba(224,64,251,0.3);border-radius:4px;color:#f0abfc;text-decoration:none;font-size:11px;" title="${escapeHtml(link)}">
                  ↗ ${escapeHtml(displayUrl.length > 30 ? displayUrl.slice(0, 28) + "…" : displayUrl)}
                </a>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }

    let dorksHtml = "";
    if (Array.isArray(result.extras?.dorks) && result.extras.dorks.length > 0) {
      dorksHtml = `
        <div class="dorks-box" style="margin-top:8px;padding:8px 10px;background:rgba(255,145,0,0.06);border:1px solid rgba(255,145,0,0.25);border-radius:6px;font-size:11px;">
          <div style="font-weight:600;color:#ff9100;margin-bottom:6px;display:flex;align-items:center;gap:4px;">
            <span>🎯 Automated OSINT Search Engine Dorks:</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            ${result.extras.dorks.map(d => `
              <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.3);padding:4px 8px;border-radius:4px;border:1px solid rgba(255,255,255,0.06);">
                <div style="font-weight:500;color:#e2e8f0;">${escapeHtml(d.title)}</div>
                <a href="${escapeHtml(d.googleUrl)}" target="_blank" rel="noopener noreferrer" style="color:#fbbf24;text-decoration:none;font-size:11px;padding:2px 8px;background:rgba(251,191,36,0.15);border-radius:3px;border:1px solid rgba(251,191,36,0.3);">
                  Launch Google Dork ↗
                </a>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }

    let telecomHtml = "";
    if (result.extras?.carrier || result.extras?.lineType) {
      telecomHtml = `
        <div class="telecom-box" style="margin-top:8px;padding:8px 10px;background:rgba(0,230,118,0.06);border:1px solid rgba(0,230,118,0.25);border-radius:6px;font-size:11px;">
          <div style="font-weight:600;color:#00e676;margin-bottom:4px;">📡 Telecom & Network Allocation:</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;color:#cbd5e1;">
            <div>Carrier: <strong style="color:#f1f5f9;">${escapeHtml(result.extras.carrier || "Regional")}</strong></div>
            <div>Line Type: <strong style="color:#f1f5f9;">${escapeHtml(result.extras.lineType || "Standard")}</strong></div>
            <div>Subdivision: <strong style="color:#f1f5f9;">${escapeHtml(result.extras.region || "National")}</strong></div>
            <div>Timezone: <strong style="color:#f1f5f9;">${escapeHtml(result.extras.timezone || "UTC")} (${escapeHtml(result.extras.utcOffset || "+00:00")})</strong></div>
          </div>
        </div>
      `;
    }

    const rawProfileUrl = result.profileUrl || "";
    let inspectUrl = rawProfileUrl;
    if (rawProfileUrl.startsWith("tel:")) {
      inspectUrl = result.extras?.truecallerSearchUrl ||
                   (result.extras?.nationalNumber ? `https://www.truecaller.com/search/${(result.extras.iso || "in").toLowerCase().split("/")[0]}/${result.extras.nationalNumber}` : `https://www.google.com/search?q=%22${encodeURIComponent(result.username)}%22`);
    } else if (rawProfileUrl.startsWith("viber:")) {
      inspectUrl = result.extras?.whatsappUrl || `https://www.google.com/search?q=%22${encodeURIComponent(result.username)}%22`;
    }

    card.innerHTML = `
      <div class="card-header">
        <div class="avatar-wrapper">
          <img src="${pfpSrc}" alt="${result.platform}" class="avatar-img" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(result.platform)}&background=20222c&color=00e5ff'">
        </div>
        <div class="card-titles">
          <div class="card-platform-row">
            <span class="card-platform ${result.platform === 'Instagram' ? 'badge-instagram' : ''}">${result.platform === 'Instagram' ? '📸 Instagram' : result.platform}</span>
            ${result.userId && result.platform === 'Instagram' ? `<span class="badge-userid" title="Instagram Internal User ID">ID: ${escapeHtml(result.userId)}</span>` : ''}
            ${result.extras?.category ? `<span class="badge-category" style="padding:2px 6px;background:rgba(255,255,255,0.08);border-radius:4px;font-size:10px;color:#94a3b8;">${escapeHtml(result.extras.category)}</span>` : ''}
            ${result.extras?.threadsHandle ? `<a href="https://threads.net/@${escapeHtml(result.extras.threadsHandle)}" target="_blank" rel="noopener noreferrer" style="padding:2px 6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.15);border-radius:4px;font-size:10px;color:#e2e8f0;text-decoration:none;">@${escapeHtml(result.extras.threadsHandle)} on Threads ↗</a>` : ''}
            ${result.extras?.registrationEst ? `<span class="badge" style="padding:2px 6px;background:rgba(59,130,246,0.15);color:#60a5fa;border:1px solid rgba(59,130,246,0.3);border-radius:4px;font-size:10px;">📅 Joined: ${escapeHtml(result.extras.registrationEst.period)}</span>` : ''}
            ${result.visualTwins?.length ? `<span class="badge-visual-twin" title="${escapeHtml(result.visualTwins[0].reason)}">🖼️ Twin: @${escapeHtml(result.visualTwins[0].username)} (${Math.round(result.visualTwins[0].similarity * 100)}%)</span>` : ''}
            ${result.isVerified ? '<span class="badge-verified">✔ Verified</span>' : ''}
            ${disambiguationBadge}
          </div>
          <div class="card-display-name">${escapeHtml(result.displayName || result.username)}</div>
          <div class="card-username">@${escapeHtml(result.username)} ${result.matchedCandidate ? `<span style="font-size:11px;color:var(--text-muted);">(from candidate: @${escapeHtml(result.matchedCandidate)})</span>` : ''}</div>
        </div>
      </div>
      ${result.disambiguation ? `
        <div class="disambiguation-info">
          ${result.disambiguation.reasons?.length ? `<div class="disambiguation-reason">Evidence: ${escapeHtml(result.disambiguation.reasons.join("; "))}</div>` : ''}
          ${result.disambiguation.flags?.length ? `<div class="disambiguation-flag">Note: ${escapeHtml(result.disambiguation.flags.join("; "))}</div>` : ''}
        </div>
      ` : ''}
      ${result.bio ? `<div class="card-bio">${escapeHtml(result.bio)}</div>` : ''}
      ${telecomHtml}
      ${linkedAccountsHtml}
      ${outlinksHtml}
      ${dorksHtml}
      ${result.provenance ? `
        <div class="provenance-box" style="margin-top:8px;padding:8px 10px;background:rgba(0,229,255,0.06);border:1px solid rgba(0,229,255,0.2);border-radius:4px;font-size:11px;">
          <div style="font-weight:600;color:var(--accent-cyan);margin-bottom:4px;">🔑 Cryptographic VCS Provenance:</div>
          ${result.provenance.timezone ? `<div>🕒 Commit Timezone: <strong>${escapeHtml(result.provenance.timezone.rawOffset)}</strong> (${escapeHtml(result.provenance.timezone.name)})</div>` : ''}
          ${result.provenance.commitEmails?.length ? `<div>✉ Commit Author Email: <strong style="color:#00e676;">${escapeHtml(result.provenance.commitEmails.join(", "))}</strong></div>` : ''}
          ${result.provenance.sshKeys?.length ? `<div>🔐 SSH Key: <code style="font-size:10px;color:#8b91a7;">${escapeHtml(result.provenance.sshKeys[0].fingerprint)}</code> (${escapeHtml(result.provenance.sshKeys[0].type)})</div>` : ''}
          ${result.provenance.repos?.length ? `<div>📦 Public Repos: <span style="color:#8b91a7;">${escapeHtml(result.provenance.repos.slice(0, 4).join(", "))}</span></div>` : ''}
        </div>
      ` : ''}
      ${result.reaEvidence ? `
        <div class="rea-evidence-badge" style="margin-top:8px;padding:8px 10px;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);border-radius:6px;font-size:11px;">
          <div style="font-weight:600;color:#60a5fa;display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
            <span>🔬 REA Browser Evidence Verified</span>
            <span style="font-size:10px;color:#94a3b8;">${escapeHtml(result.reaEvidence.evidenceId || "VERIFIED")}</span>
          </div>
          ${result.reaEvidence.screenshotUrl ? `
            <div style="margin:6px 0;border-radius:4px;overflow:hidden;max-height:130px;border:1px solid rgba(255,255,255,0.1);">
              <img src="${result.reaEvidence.screenshotUrl}" alt="REA Viewport" style="width:100%;display:block;cursor:pointer;" onclick="window.open('${result.reaEvidence.screenshotUrl}', '_blank')" title="Click to view full screenshot in new tab">
            </div>
          ` : ''}
          ${result.reaEvidence.extractedEmails?.length ? `<div>✉ REA Extracted Emails: <strong style="color:#00e676;">${escapeHtml(result.reaEvidence.extractedEmails.join(", "))}</strong></div>` : ''}
          ${result.reaEvidence.extractedLinks?.length ? `<div>🔗 Discovered Outlinks: <span style="color:#38bdf8;">${escapeHtml(result.reaEvidence.extractedLinks.slice(0, 3).join(", "))}</span></div>` : ''}
        </div>
      ` : ''}
      ${result.avatarFingerprint ? `
        <div style="font-size:10px;color:#8b91a7;margin-top:4px;">
          🖼 Visual pHash: <code>${result.avatarFingerprint.perceptualHash}</code> | SHA256: <code>${result.avatarFingerprint.sha256.slice(0, 12)}...</code>
        </div>
      ` : ''}
      <div class="card-metrics">
        ${result.followers !== null && result.followers !== undefined ? `<div>Followers: <span class="metric-val">${result.followers}</span></div>` : ''}
        ${result.following !== null && result.following !== undefined ? `<div>Following: <span class="metric-val">${result.following}</span></div>` : ''}
        ${result.posts !== null && result.posts !== undefined ? `<div>Posts: <span class="metric-val">${result.posts}</span></div>` : ''}
        ${result.location ? `<div class="location-tag">📍 ${escapeHtml(result.location)}</div>` : ''}
      </div>
      <div class="card-footer" style="display:flex;gap:8px;">
        <a href="${result.profileUrl}" target="_blank" rel="noopener noreferrer" class="card-link-btn" style="flex:1;text-align:center;">
          Open Profile ↗
        </a>
        <button type="button" class="card-link-btn rea-quick-inspect-btn" data-url="${escapeHtml(inspectUrl)}" style="background:rgba(59,130,246,0.15);color:#60a5fa;border:1px solid rgba(59,130,246,0.3);cursor:pointer;">
          🔬 REA Inspect
        </button>
      </div>
    `;

    resultsContainer.appendChild(card);

    // Pivot button handler
    card.querySelectorAll(".pivot-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const u = btn.dataset.username;
        if (u) {
          queryInput.value = u;
          searchTabBtns.forEach(b => b.classList.remove("active"));
          document.querySelector('.search-tab-btn[data-type="username"]')?.classList.add("active");
          currentSearchType = "username";
          startSearch(u, "username");
        }
      });
    });
  }

  function escapeHtml(text) {
    if (!text) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Filtering Logic
  filterInput.addEventListener("input", applyFilters);
  filterChips.forEach(chip => {
    chip.addEventListener("click", () => {
      const filterKey = chip.dataset.filter;
      if (activeFilterChips.has(filterKey)) {
        activeFilterChips.delete(filterKey);
        chip.classList.remove("active");
      } else {
        activeFilterChips.add(filterKey);
        chip.classList.add("active");
      }
      applyFilters();
    });
  });

  function applyFilters() {
    const q = filterInput.value.toLowerCase().trim();
    const cards = resultsContainer.querySelectorAll(".profile-card");

    cards.forEach(card => {
      let matches = true;

      if (q) {
        const text = card.textContent.toLowerCase();
        if (!text.includes(q)) matches = false;
      }

      if (activeFilterChips.has("target") && card.dataset.isTarget !== "true") matches = false;
      if (activeFilterChips.has("hide-homonym") && card.dataset.isHomonym === "true") matches = false;
      if (activeFilterChips.has("verified") && card.dataset.verified !== "true") matches = false;
      if (activeFilterChips.has("bio") && card.dataset.hasBio !== "true") matches = false;
      if (activeFilterChips.has("location") && card.dataset.hasLocation !== "true") matches = false;

      card.style.display = matches ? "flex" : "none";
    });
  }

  // Exports
  async function triggerExport(format) {
    if (allResults.length === 0) return alert("No results to export yet.");
    const query = queryInput.value.trim() || lastSearchQuery || "investigation";
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        results: allResults,
        query,
        type: currentSearchType,
        format
      })
    });

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ext = format === "html" ? "html" : (format === "md" ? "md" : (format === "csv" ? "csv" : (format === "txt" ? "txt" : "json")));
    a.download = `dossier_${query}_${Date.now()}.${ext}`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  const exportHtmlBtn = document.getElementById("export-html-btn");
  if (exportHtmlBtn) exportHtmlBtn.addEventListener("click", () => triggerExport("html"));
  document.getElementById("export-json-btn").addEventListener("click", () => triggerExport("json"));
  document.getElementById("export-csv-btn").addEventListener("click", () => triggerExport("csv"));
  const exportMdBtn = document.getElementById("export-md-btn");
  if (exportMdBtn) exportMdBtn.addEventListener("click", () => triggerExport("md"));
  document.getElementById("export-txt-btn").addEventListener("click", () => triggerExport("txt"));

  function renderTargetDossier(results, query, type) {
    const targetDossierPanel = document.getElementById("target-dossier-panel");
    if (!targetDossierPanel || !results || results.length === 0) return;

    // Pick top target profile
    const target = results.find(r => r.disambiguation?.isTargetMatch) ||
                   [...results].sort((a, b) => (b.disambiguation?.confidenceScore || 0) - (a.disambiguation?.confidenceScore || 0))[0] ||
                   results[0];

    const emails = new Set();
    const phones = new Set();
    const handles = new Set();
    const outlinks = new Set();
    let verifiedCount = 0;
    let visualTwinCount = 0;

    results.forEach(r => {
      if (r.isVerified) verifiedCount++;
      if (r.username) handles.add(`@${r.username}`);
      if (r.visualTwins?.length) visualTwinCount += r.visualTwins.length;
      (r.emails || []).forEach(e => emails.add(e));
      (r.phones || []).forEach(p => phones.add(p));
      (r.extras?.outlinks || []).forEach(u => outlinks.add(u));
    });

    const confidencePct = target.disambiguation?.confidenceScore
      ? Math.round(target.disambiguation.confidenceScore * 100)
      : (target.isVerified ? 90 : 75);

    const targetPfp = target.pfpUrl || (results.find(r => r.pfpUrl)?.pfpUrl) || `https://ui-avatars.com/api/?name=${encodeURIComponent(target.displayName || query)}&background=141721&color=00e5ff`;

    targetDossierPanel.innerHTML = `
      <div class="dossier-hero-row">
        <div class="dossier-avatar-wrap">
          <img src="${targetPfp}" alt="Subject Target Avatar" class="dossier-avatar-img" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(query)}&background=141721&color=00e5ff'">
        </div>
        <div class="dossier-target-title">
          <div class="dossier-target-name">
            <span>${escapeHtml(target.displayName || query)}</span>
            <span class="badge ${target.disambiguation?.isTargetMatch ? 'badge-verified' : ''}" style="background:rgba(0,230,118,0.2);color:#00e676;border:1px solid rgba(0,230,118,0.4);font-size:11px;padding:3px 8px;border-radius:4px;">
              🎯 ${confidencePct}% Target Confidence
            </span>
            ${target.visualTwins?.length ? `<span class="badge-visual-twin">🖼️ Visual Twin Network Confirmed</span>` : ''}
          </div>
          <div class="dossier-target-handles">
            Discovered Core Handles: ${Array.from(handles).slice(0, 5).map(h => `<span style="background:rgba(0,229,255,0.1);padding:2px 6px;border-radius:4px;margin-right:4px;">${escapeHtml(h)}</span>`).join("")}
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-left:auto;">
          <button type="button" class="export-btn" onclick="document.getElementById('export-html-btn').click()" style="background:rgba(0,229,255,0.2);color:var(--accent-cyan);border-color:rgba(0,229,255,0.5);font-weight:600;">
            📑 Full HTML Report
          </button>
        </div>
      </div>

      <div class="dossier-kpi-bar">
        <div class="dossier-kpi-pill">Verified Accounts: <strong>${results.length}</strong></div>
        <div class="dossier-kpi-pill">Discovered Emails: <strong>${emails.size}</strong></div>
        <div class="dossier-kpi-pill">Telecom Lines: <strong>${phones.size}</strong></div>
        <div class="dossier-kpi-pill">Visual Twin Links: <strong style="color:#ffd700;">${visualTwinCount}</strong></div>
        ${target.extras?.registrationEst ? `<div class="dossier-kpi-pill">Est. Origin: <strong style="color:#60a5fa;">${escapeHtml(target.extras.registrationEst.period)} (~${target.extras.registrationEst.accountAgeYears}y ago)</strong></div>` : ''}
      </div>

      <div class="dossier-data-grid">
        <div class="dossier-data-item">
          <span class="dossier-data-label">✉️ Discovered Communications</span>
          <div style="color:#f1f5f9;font-size:12px;">
            ${emails.size > 0 ? Array.from(emails).map(e => `<code style="color:#00e676;margin-right:4px;">${escapeHtml(e)}</code>`).join(" ") : '<span style="color:#64748b;">No public email addresses exposed</span>'}
          </div>
        </div>
        <div class="dossier-data-item">
          <span class="dossier-data-label">📞 Telecom & Messaging Vectors</span>
          <div style="color:#f1f5f9;font-size:12px;">
            ${phones.size > 0 ? Array.from(phones).map(p => `<code style="color:#ffd700;margin-right:4px;">${escapeHtml(p)}</code>`).join(" ") : '<span style="color:#64748b;">No phone numbers discovered</span>'}
            ${target.extras?.carrier ? `<div style="font-size:11px;color:#94a3b8;margin-top:2px;">Carrier: ${escapeHtml(target.extras.carrier)} (${escapeHtml(target.extras.region || "National")})</div>` : ''}
          </div>
        </div>
        <div class="dossier-data-item">
          <span class="dossier-data-label">🔑 Cryptographic Proof & Timezone</span>
          <div style="color:#f1f5f9;font-size:11px;">
            ${target.provenance?.sshKeys?.length ? `<div>SSH: <code>${escapeHtml(target.provenance.sshKeys[0].fingerprint.slice(0, 20))}...</code></div>` : ''}
            ${target.provenance?.timezone ? `<div>Timezone: <strong>${escapeHtml(target.provenance.timezone.name)}</strong></div>` : ''}
            ${!target.provenance ? '<span style="color:#64748b;">Passive correlation mode active</span>' : ''}
          </div>
        </div>
        <div class="dossier-data-item">
          <span class="dossier-data-label">🌐 Primary Hubs & Outlinks</span>
          <div style="color:#f1f5f9;font-size:11px;overflow:hidden;text-overflow:ellipsis;">
            ${outlinks.size > 0 ? Array.from(outlinks).slice(0, 3).map(u => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" style="display:block;color:#38bdf8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(u)} ↗</a>`).join("") : '<span style="color:#64748b;">No external portfolio hubs</span>'}
          </div>
        </div>
      </div>
    `;

    targetDossierPanel.classList.remove("hidden");
  }

  // Device Fingerprinting
  const scanDeviceBtn = document.getElementById("scan-device-btn");
  const deviceResults = document.getElementById("device-results");
  const visitorIdDisplay = document.getElementById("visitor-id-display");
  const componentsGrid = document.getElementById("components-grid");

  scanDeviceBtn.addEventListener("click", async () => {
    scanDeviceBtn.textContent = "Scanning Browser...";
    scanDeviceBtn.disabled = true;

    try {
      const fp = await window.LocalFingerprint.getFingerprint();
      const res = await fetch("/api/device-fingerprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fp.components)
      });
      const data = await res.json();

      visitorIdDisplay.textContent = data.visitorId;
      document.getElementById("visitor-confidence").textContent = `${Math.round(data.confidenceScore * 100)}%`;
      document.getElementById("visitor-bot").textContent = data.isBot ? "Bot / Automation Detected" : "Human / Genuine Client";
      document.getElementById("visitor-bot").style.color = data.isBot ? "#ff5252" : "#00e676";

      componentsGrid.innerHTML = "";
      for (const [key, val] of Object.entries(data.components)) {
        const item = document.createElement("div");
        item.className = "component-card";
        item.innerHTML = `
          <div class="component-title">${key}</div>
          <div class="component-val">${Array.isArray(val) ? val.join(", ") : String(val)}</div>
        `;
        componentsGrid.appendChild(item);
      }

      deviceResults.classList.remove("hidden");
    } catch (err) {
      alert("Device scan failed: " + err.message);
    } finally {
      scanDeviceBtn.textContent = "Re-scan Device";
      scanDeviceBtn.disabled = false;
    }
  });

  // Edge Telemetry Tab
  const refreshEdgeBtn = document.getElementById("refresh-edge-btn");
  refreshEdgeBtn.addEventListener("click", fetchEdgeTelemetry);

  async function fetchEdgeTelemetry() {
    try {
      const res = await fetch("/api/edge/telemetry");
      const data = await res.json();

      document.getElementById("edge-token-display").textContent = data.deviceToken || "None";
      document.getElementById("edge-token-status").textContent = data.tokenValid ? "Verified (HMAC-SHA256 Match)" : "Minted New Token";
      document.getElementById("edge-header-hash").textContent = data.headerOrderFingerprint || "---";

      const grid = document.getElementById("edge-telemetry-grid");
      grid.innerHTML = "";

      const fields = {
        "Client Remote IP": data.clientIp,
        "TLS Version": data.tlsVersion,
        "TLS Cipher Suite": data.tlsCipher,
        "JA3 TLS Fingerprint": data.ja3Hash,
        "Header Count": data.headerCount,
        "Sec-CH-UA Hints": data.secChUa || "None (Standard or CLI)",
        "Platform Hint": data.secChUaPlatform || "None",
        "Edge Bot Probability": `${Math.round(data.botScore * 100)}% (${data.isBot ? "BOT" : "HUMAN"})`,
        "Detection Flags": data.detectionFlags?.length ? data.detectionFlags.join("; ") : "None (Passed All Checks)",
        "Raw User-Agent": data.userAgent
      };

      for (const [k, v] of Object.entries(fields)) {
        const card = document.createElement("div");
        card.className = "component-card";
        card.innerHTML = `
          <div class="component-title">${k}</div>
          <div class="component-val">${v}</div>
        `;
        grid.appendChild(card);
      }
    } catch (err) {
      console.error("Failed to load edge telemetry:", err);
    }
  }

  // Identity Graph Canvas Visualization
  const canvas = document.getElementById("identity-canvas");
  const ctx = canvas.getContext("2d");
  document.getElementById("refresh-graph-btn").addEventListener("click", fetchAndRenderGraph);

  async function fetchAndRenderGraph() {
    try {
      const res = await fetch("/api/graph");
      const graph = await res.json();

      document.getElementById("graph-node-count").textContent = graph.nodeCount || 0;
      document.getElementById("graph-edge-count").textContent = graph.edgeCount || 0;

      renderIdentityCanvas(graph);
    } catch (err) {
      console.error("Failed to render graph:", err);
    }
  }

  function renderIdentityCanvas(graph) {
    if (!graph.nodes || graph.nodes.length === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#8b91a7";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("No active investigation graph data. Perform a search to generate nodes.", canvas.width / 2, canvas.height / 2);
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const minDim = Math.min(width, height);

    // Group nodes by tier/level
    const rootNode = graph.nodes.find(n => n.level === 0 || n.type === "target") || graph.nodes[0];
    rootNode.x = centerX;
    rootNode.y = centerY;

    const level1Nodes = graph.nodes.filter(n => n !== rootNode && (n.level === 1 || (!n.level && n.type === "profile")));
    const level2Nodes = graph.nodes.filter(n => n !== rootNode && (n.level === 2 || n.type === "lead" || n.type === "crypto" || n.type === "email" || n.type === "website" || n.type === "outlink" || n.type === "linked_account"));
    const level3Nodes = graph.nodes.filter(n => n !== rootNode && n.level === 3);

    // Position Level 1 (Direct platform hits) in inner orbit
    const r1 = minDim * 0.22;
    const step1 = (2 * Math.PI) / (level1Nodes.length || 1);
    level1Nodes.forEach((node, i) => {
      const angle = i * step1 - Math.PI / 2;
      node.x = centerX + Math.cos(angle) * r1;
      node.y = centerY + Math.sin(angle) * r1;
    });

    // Position Level 2 (Discovered leads, emails, crypto) in middle orbit
    const r2 = minDim * 0.35;
    const step2 = (2 * Math.PI) / (level2Nodes.length || 1);
    level2Nodes.forEach((node, i) => {
      const angle = i * step2 - Math.PI / 4;
      node.x = centerX + Math.cos(angle) * r2;
      node.y = centerY + Math.sin(angle) * r2;
    });

    // Position Level 3 (Deep recursive branch hits) in outer orbit
    const r3 = minDim * 0.44;
    const step3 = (2 * Math.PI) / (level3Nodes.length || 1);
    level3Nodes.forEach((node, i) => {
      const angle = i * step3;
      node.x = centerX + Math.cos(angle) * r3;
      node.y = centerY + Math.sin(angle) * r3;
    });

    // Fallback positioning for any unassigned nodes
    graph.nodes.forEach((n, idx) => {
      if (n.x === undefined || n.y === undefined) {
        const angle = (idx * 2 * Math.PI) / graph.nodes.length;
        n.x = centerX + Math.cos(angle) * (minDim * 0.38);
        n.y = centerY + Math.sin(angle) * (minDim * 0.38);
      }
    });

    // Draw Orbit Guide Rings
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    [r1, r2, r3].forEach(r => {
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, 0, 2 * Math.PI);
      ctx.stroke();
    });

    // Draw Edges
    for (const edge of graph.edges) {
      const s = graph.nodes.find(n => n.id === edge.source);
      const t = graph.nodes.find(n => n.id === edge.target);
      if (s && t) {
        ctx.beginPath();
        const isCorrelated = edge.relation === "mentions_identity" ||
                             edge.relation === "extracted_crypto_wallet" ||
                             edge.relation === "correlated_account";

        if (isCorrelated) {
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = edge.relation === "extracted_crypto_wallet"
            ? "rgba(0, 229, 255, 0.55)"
            : "rgba(255, 145, 0, 0.55)";
          ctx.lineWidth = 1.6;
        } else {
          ctx.setLineDash([]);
          ctx.strokeStyle = "rgba(0, 230, 118, 0.35)";
          ctx.lineWidth = 1.4;
        }

        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]); // Reset line dash

    // Draw Nodes
    for (const node of graph.nodes) {
      ctx.beginPath();
      let nodeRadius = 15;
      let color = "#00e5ff";

      if (node.level === 0 || node.type === "target") {
        nodeRadius = 24;
        color = "#ff0055"; // Crimson root
      } else if (node.type === "linked_account") {
        nodeRadius = 15;
        color = "#38bdf8"; // Sky Blue linked account
      } else if (node.type === "outlink") {
        nodeRadius = 14;
        color = "#e040fb"; // Neon Magenta outlink
      } else if (node.type === "crypto") {
        nodeRadius = 14;
        color = "#00e5ff"; // Cyan crypto
      } else if (node.type === "email") {
        nodeRadius = 14;
        color = "#00e5ff"; // Cyan email
      } else if (node.type === "website") {
        nodeRadius = 13;
        color = "#ffd600"; // Gold domain
      } else if (node.level === 3) {
        nodeRadius = 16;
        color = "#b388ff"; // Purple deep branch hit
      } else if (node.level === 2 || node.type === "lead") {
        nodeRadius = 14;
        color = "#ff9100"; // Amber correlated lead
      } else if (node.level === 1 || node.type === "profile") {
        nodeRadius = 18;
        color = "#00e676"; // Emerald direct platform hit
      }

      ctx.arc(node.x, node.y, nodeRadius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#161b22";
      ctx.lineWidth = 3;
      ctx.stroke();

      // Node Label
      ctx.fillStyle = "#ffffff";
      ctx.font = (node.level === 0 || node.type === "target") ? "bold 13px sans-serif" : "11px sans-serif";
      ctx.textAlign = "center";
      const displayLabel = node.label.length > 24 ? node.label.slice(0, 22) + "…" : node.label;
      ctx.fillText(displayLabel, node.x, node.y + nodeRadius + 14);
    }

    // Canvas Tier Legend
    const legend = [
      { label: "Target (L0)", color: "#ff0055" },
      { label: "Direct Hit (L1)", color: "#00e676" },
      { label: "Linked Account", color: "#38bdf8" },
      { label: "Outlink Hub", color: "#e040fb" },
      { label: "Lead / Handle (L2)", color: "#ff9100" },
      { label: "Email / Crypto", color: "#00e5ff" },
      { label: "Deep Recursive (L3)", color: "#b388ff" }
    ];

    let legX = 20;
    const legY = height - 25;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    for (const item of legend) {
      ctx.beginPath();
      ctx.arc(legX + 6, legY - 4, 6, 0, 2 * Math.PI);
      ctx.fillStyle = item.color;
      ctx.fill();
      ctx.fillStyle = "#8b91a7";
      ctx.fillText(item.label, legX + 16, legY);
      legX += ctx.measureText(item.label).width + 36;
    }
  }

  // ----------------------------------------------------
  // REA Deep Inspector & Browser Forensics Module
  // ----------------------------------------------------
  const reaInspectForm = document.getElementById("rea-inspect-form");
  const reaUrlInput = document.getElementById("rea-url-input");
  const reaSubmitBtn = document.getElementById("rea-submit-btn");
  const reaBtnText = document.getElementById("rea-btn-text");
  const reaSpinner = document.getElementById("rea-spinner");
  const reaBrowserDisplay = document.getElementById("rea-browser-display");
  const reaResultsContainer = document.getElementById("rea-results-container");
  const reaEvidenceId = document.getElementById("rea-evidence-id");
  const reaTargetUrl = document.getElementById("rea-target-url");
  const reaDuration = document.getElementById("rea-duration");
  const reaSha256 = document.getElementById("rea-sha256");
  const reaScreenshotImg = document.getElementById("rea-screenshot-img");
  const reaEmailsList = document.getElementById("rea-emails-list");
  const reaLinksList = document.getElementById("rea-links-list");
  const reaMetaBox = document.getElementById("rea-meta-box");
  const reaMetaTitle = document.getElementById("rea-meta-title");
  const reaMetaId = document.getElementById("rea-meta-id");
  const reaMetaDisplayName = document.getElementById("rea-meta-display-name");
  const reaMetaMetrics = document.getElementById("rea-meta-metrics");
  const reaMetaBio = document.getElementById("rea-meta-bio");

  const reaErrorBanner = document.getElementById("rea-error-banner");

  function showReaError(msg, targetUrl) {
    if (reaErrorBanner) {
      reaErrorBanner.classList.remove("hidden");
      reaErrorBanner.innerHTML = `
        <div style="background:rgba(255,82,82,0.12);border:1px solid rgba(255,82,82,0.4);padding:14px 18px;border-radius:8px;color:#fca5a5;font-size:13px;">
          <div style="font-weight:700;margin-bottom:6px;color:#ff5252;display:flex;align-items:center;gap:6px;">
            <span>⚠️ REA Inspection Notice</span>
          </div>
          <div>${escapeHtml(msg)}</div>
          <div style="margin-top:8px;font-size:11px;color:#94a3b8;line-height:1.4;">
            ${targetUrl ? `Target URL: <code>${escapeHtml(targetUrl)}</code><br>` : ''}
            Tip: REA Headless Chromium scenarios execute against HTTP(S) web endpoints. Non-HTTP schemes (like <code>tel:</code> and <code>viber:</code>) are automatically mapped to Truecaller or Google Dorks.
          </div>
        </div>
      `;
    }
    if (reaResultsContainer) reaResultsContainer.classList.add("hidden");
  }

  async function fetchReaStatus() {
    try {
      const res = await fetch("/api/rea/status");
      const data = await res.json();
      if (reaBrowserDisplay) {
        if (data.browser) {
          const browserName = data.browser.split("/").pop().replace(".app", "");
          reaBrowserDisplay.textContent = `${browserName} (Chromium Playwright Engine)`;
        } else {
          reaBrowserDisplay.textContent = "Chromium Binary Not Found";
          reaBrowserDisplay.style.color = "#ff5252";
        }
      }
    } catch {}
  }
  fetchReaStatus();

  async function runReaInspection(url) {
    if (!url) return;
    if (reaUrlInput) reaUrlInput.value = url;

    // Switch to REA tab
    navBtns.forEach(b => b.classList.remove("active"));
    tabPanes.forEach(p => p.classList.remove("active"));
    document.querySelector('.nav-btn[data-tab="rea-view"]')?.classList.add("active");
    document.getElementById("rea-view")?.classList.add("active");

    if (reaErrorBanner) {
      reaErrorBanner.innerHTML = "";
      reaErrorBanner.classList.add("hidden");
    }

    if (reaBtnText) reaBtnText.textContent = "Inspecting (Playwright)...";
    if (reaSpinner) reaSpinner.classList.remove("hidden");
    if (reaSubmitBtn) reaSubmitBtn.disabled = true;

    try {
      const res = await fetch("/api/rea/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await res.json();

      if (!data.success) {
        const errMsg = data.error || data.reason || "Failed to inspect target URL";
        showReaError(errMsg, data.targetUrl || url);
        return;
      }

      if (reaResultsContainer) reaResultsContainer.classList.remove("hidden");
      if (reaEvidenceId) reaEvidenceId.textContent = data.evidenceId || "REA-VERIFIED-PLAYWRIGHT";
      if (reaTargetUrl) reaTargetUrl.textContent = data.targetUrl;
      if (reaDuration) reaDuration.textContent = data.durationMs ? `${data.durationMs}ms` : "Completed";
      if (reaSha256) reaSha256.textContent = data.screenshotSha256 || "N/A";

      if (reaScreenshotImg && data.screenshotUrl) {
        reaScreenshotImg.src = `${data.screenshotUrl}?t=${Date.now()}`;
      }

      // Render Instagram & Meta intelligence if discovered
      if (reaMetaBox) {
        if (data.instagramMeta && (data.instagramMeta.displayName || data.instagramMeta.userId)) {
          reaMetaBox.classList.remove("hidden");
          if (reaMetaTitle) reaMetaTitle.textContent = "📸 Instagram Account Verified";
          if (reaMetaId) {
            if (data.instagramMeta.userId) {
              reaMetaId.style.display = "inline-block";
              reaMetaId.textContent = `ID: ${data.instagramMeta.userId}`;
            } else {
              reaMetaId.style.display = "none";
            }
          }
          if (reaMetaDisplayName) reaMetaDisplayName.textContent = data.instagramMeta.displayName || "Instagram User";
          if (reaMetaMetrics) {
            const parts = [];
            if (data.instagramMeta.followers !== null && data.instagramMeta.followers !== undefined) parts.push(`Followers: ${data.instagramMeta.followers}`);
            if (data.instagramMeta.following !== null && data.instagramMeta.following !== undefined) parts.push(`Following: ${data.instagramMeta.following}`);
            if (data.instagramMeta.posts !== null && data.instagramMeta.posts !== undefined) parts.push(`Posts: ${data.instagramMeta.posts}`);
            reaMetaMetrics.textContent = parts.join("  •  ");
          }
          if (reaMetaBio) reaMetaBio.textContent = data.instagramMeta.bio || "";
        } else if (data.metaInfo) {
          reaMetaBox.classList.remove("hidden");
          if (reaMetaTitle) reaMetaTitle.textContent = `🔷 ${data.metaInfo.platform} Profile Identified`;
          if (reaMetaId) reaMetaId.style.display = "none";
          if (reaMetaDisplayName) reaMetaDisplayName.textContent = data.metaInfo.title || "";
          if (reaMetaMetrics) reaMetaMetrics.textContent = "";
          if (reaMetaBio) reaMetaBio.textContent = data.metaInfo.description || "";
        } else {
          reaMetaBox.classList.add("hidden");
        }
      }

      if (reaEmailsList) {
        reaEmailsList.innerHTML = "";
        if (data.extractedEmails && data.extractedEmails.length > 0) {
          for (const email of data.extractedEmails) {
            const badge = document.createElement("span");
            badge.className = "dig-lead-badge";
            badge.style.borderColor = "#a855f7";
            badge.style.color = "#c084fc";
            badge.textContent = `✉ ${email}`;
            badge.title = "Click to search this email in LocalFingerprint";
            badge.style.cursor = "pointer";
            badge.addEventListener("click", () => {
              searchTabBtns.forEach(b => b.classList.remove("active"));
              document.querySelector('.search-tab-btn[data-type="email"]')?.classList.add("active");
              currentSearchType = "email";
              queryInput.value = email;
              navBtns.forEach(b => b.classList.remove("active"));
              tabPanes.forEach(p => p.classList.remove("active"));
              document.querySelector('.nav-btn[data-tab="search-view"]')?.classList.add("active");
              document.getElementById("search-view")?.classList.add("active");
              startSearch(email, "email");
            });
            reaEmailsList.appendChild(badge);
          }
        } else {
          reaEmailsList.innerHTML = `<span style="color: #64748b; font-size: 13px;">No plaintext emails exposed in DOM</span>`;
        }
      }

      if (reaLinksList) {
        reaLinksList.innerHTML = "";
        if (data.extractedLinks && data.extractedLinks.length > 0) {
          for (const link of data.extractedLinks) {
            const linkA = document.createElement("a");
            linkA.href = link;
            linkA.target = "_blank";
            linkA.rel = "noopener noreferrer";
            linkA.style.color = "#38bdf8";
            linkA.style.fontSize = "13px";
            linkA.style.textDecoration = "none";
            linkA.textContent = `↗ ${link}`;
            reaLinksList.appendChild(linkA);
          }
        } else {
          reaLinksList.innerHTML = `<span style="color: #64748b; font-size: 13px;">No external social outlinks found</span>`;
        }
      }
    } catch (err) {
      alert("Network error connecting to REA bridge: " + err.message);
    } finally {
      if (reaBtnText) reaBtnText.textContent = "Inspect with REA";
      if (reaSpinner) reaSpinner.classList.add("hidden");
      if (reaSubmitBtn) reaSubmitBtn.disabled = false;
    }
  }

  if (reaInspectForm) {
    reaInspectForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const url = reaUrlInput.value.trim();
      runReaInspection(url);
    });
  }

  // Quick Inspect click listener from search result cards
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".rea-quick-inspect-btn");
    if (btn && btn.dataset.url) {
      e.preventDefault();
      runReaInspection(btn.dataset.url);
    }
  });
});
