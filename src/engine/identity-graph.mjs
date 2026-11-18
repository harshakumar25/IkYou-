/**
 * Advanced Identity Knowledge Graph Builder
 * Converts raw platform matches, extracted credentials, crypto wallets,
 * and recursive Dig leads into a multi-tier connected entity graph.
 */

export class IdentityGraph {
  constructor(rootQuery, rootType = "username") {
    this.rootQuery = rootQuery;
    this.rootType = rootType;
    this.nodes = new Map();
    this.edges = [];

    // Add Root Target Node (Level 0)
    this.addNode({
      id: `root:${rootType}:${rootQuery}`,
      label: rootQuery,
      type: "target",
      category: "Root Subject",
      level: 0,
      metadata: { query: rootQuery, type: rootType }
    });
  }

  addNode(node) {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, {
        level: 1,
        ...node,
        createdTime: Date.now()
      });
    }
  }

  addEdge(sourceId, targetId, relation, metadata = {}) {
    const edgeKey = `${sourceId}->${targetId}:${relation}`;
    const exists = this.edges.some(e => `${e.source}->${e.target}:${e.relation}` === edgeKey);
    if (!exists) {
      this.edges.push({
        source: sourceId,
        target: targetId,
        relation,
        confidence: metadata.confidence || 0.9,
        metadata
      });
    }
  }

  /**
   * Ingest a verified profile match into the graph
   * @param {object} profile - Fingerprint profile object
   */
  ingestProfile(profile) {
    const profileNodeId = `profile:${profile.platform.toLowerCase()}:${profile.username}`;
    const rootNodeId = `root:${this.rootType}:${this.rootQuery}`;

    // Determine level: if profile matches root query, it's level 1 (direct hit), otherwise level 3 (recursive branch)
    const isDirectHit = profile.username.toLowerCase() === this.rootQuery.toLowerCase();
    const level = isDirectHit ? 1 : 3;

    // Add profile node
    this.addNode({
      id: profileNodeId,
      label: `${profile.platform}: ${profile.displayName || profile.username}`,
      type: "profile",
      category: profile.platform,
      level,
      pfpUrl: profile.pfpUrl || "",
      profileUrl: profile.profileUrl,
      metadata: {
        platform: profile.platform,
        username: profile.username,
        followers: profile.followers,
        isVerified: profile.isVerified,
        location: profile.location,
        bio: profile.bio
      }
    });

    // Edge from root (or originating lead)
    const sourceNodeId = isDirectHit ? rootNodeId : (this.findOriginatingNode(profile.username) || rootNodeId);
    this.addEdge(sourceNodeId, profileNodeId, isDirectHit ? "owns_account" : "correlated_account", {
      platform: profile.platform,
      confidence: isDirectHit ? 1.0 : 0.85
    });

    // Ingest extracted emails
    if (Array.isArray(profile.emails)) {
      for (const email of profile.emails) {
        const emailNodeId = `email:${email.toLowerCase()}`;
        this.addNode({
          id: emailNodeId,
          label: email,
          type: "email",
          category: "Contact",
          level: 2,
          metadata: { email }
        });
        this.addEdge(profileNodeId, emailNodeId, "associated_email", { confidence: 0.98 });
      }
    }

    // Ingest associated phones
    if (Array.isArray(profile.phones)) {
      for (const ph of profile.phones) {
        if (!ph) continue;
        const phNodeId = `phone:${ph}`;
        this.addNode({
          id: phNodeId,
          label: `📞 ${ph}`,
          type: "phone",
          category: "Telecom",
          level: 2,
          metadata: { phone: ph }
        });
        this.addEdge(profileNodeId, phNodeId, "associated_phone", { confidence: 0.98 });
      }
    }

    // Ingest personal website
    if (profile.website && profile.website.startsWith("http")) {
      const siteNodeId = `website:${profile.website}`;
      this.addNode({
        id: siteNodeId,
        label: profile.website.replace(/^https?:\/\//, "").replace(/\/$/, ""),
        type: "website",
        category: "Domain",
        level: 2,
        metadata: { url: profile.website }
      });
      this.addEdge(profileNodeId, siteNodeId, "links_website", { confidence: 0.95 });
    }

    // Ingest external outlinks
    if (Array.isArray(profile.extras?.outlinks)) {
      for (const outlink of profile.extras.outlinks) {
        if (outlink && typeof outlink === "string" && outlink.startsWith("http") && outlink !== profile.website) {
          const outlinkNodeId = `outlink:${outlink}`;
          this.addNode({
            id: outlinkNodeId,
            label: outlink.replace(/^https?:\/\//, "").replace(/\/$/, ""),
            type: "outlink",
            category: "External Outlink",
            level: 2,
            metadata: { url: outlink }
          });
          this.addEdge(profileNodeId, outlinkNodeId, "links_to_external", { confidence: 0.95 });
        }
      }
    }

    // Ingest verified linked accounts
    if (Array.isArray(profile.extras?.linkedAccounts)) {
      for (const acc of profile.extras.linkedAccounts) {
        if (acc && (acc.username || acc.url)) {
          const platformStr = (acc.platform || "Account").toLowerCase();
          const handleStr = acc.username || acc.url;
          const accNodeId = `account:${platformStr}:${handleStr}`;
          this.addNode({
            id: accNodeId,
            label: `${acc.platform || "Connected"}: ${acc.username ? "@" + acc.username : acc.url}`,
            type: "linked_account",
            category: "Connected Account",
            level: 2,
            metadata: acc
          });
          this.addEdge(profileNodeId, accNodeId, "verified_identity_proof", {
            confidence: acc.verified ? 1.0 : 0.9
          });
        }
      }
    }

    // Ingest VCS Cryptographic Provenance (SSH Keys & Commit Emails)
    if (profile.provenance) {
      if (Array.isArray(profile.provenance.sshKeys)) {
        for (const key of profile.provenance.sshKeys) {
          const keyNodeId = `ssh:${key.fingerprint}`;
          this.addNode({
            id: keyNodeId,
            label: `SSH: ${key.fingerprint.slice(0, 18)}...`,
            type: "crypto",
            category: "Cryptographic Key",
            level: 2,
            metadata: key
          });
          this.addEdge(profileNodeId, keyNodeId, "authorized_ssh_key", { confidence: 1.0 });
        }
      }

      if (Array.isArray(profile.provenance.commitEmails)) {
        for (const cEmail of profile.provenance.commitEmails) {
          const cEmailNodeId = `email:${cEmail.toLowerCase()}`;
          this.addNode({
            id: cEmailNodeId,
            label: cEmail,
            type: "email",
            category: "Commit Author Email",
            level: 2,
            metadata: { email: cEmail, source: "git_commit_patch" }
          });
          this.addEdge(profileNodeId, cEmailNodeId, "authored_git_commits", { confidence: 0.99 });
        }
      }
    }

    // Ingest Avatar Visual Fingerprint
    if (profile.avatarFingerprint?.perceptualHash) {
      const pfpNodeId = `avatar:${profile.avatarFingerprint.perceptualHash}`;
      this.addNode({
        id: pfpNodeId,
        label: `pfp:${profile.avatarFingerprint.perceptualHash.slice(0, 10)}`,
        type: "avatar",
        category: "Visual Biometric",
        level: 2,
        metadata: profile.avatarFingerprint
      });
      this.addEdge(profileNodeId, pfpNodeId, "uses_avatar_visual", { confidence: 0.95 });
    }

    // Ingest discovered dig leads
    if (Array.isArray(profile.discoveredUsernames)) {
      for (const lead of profile.discoveredUsernames) {
        this.ingestLead(lead, profileNodeId);
      }
    }
  }

  /**
   * Ingest a discovered lead from the Dig engine
   * @param {object} lead - { username, foundOn, from, queryType, confidence, entityType }
   * @param {string} [originNodeId]
   */
  ingestLead(lead, originNodeId = null) {
    const isCrypto = lead.queryType === "crypto" || lead.entityType === "crypto_wallet";
    const leadNodeId = isCrypto
      ? `crypto:${lead.username.slice(0, 10)}`
      : `lead:${lead.queryType}:${lead.username.toLowerCase()}`;

    this.addNode({
      id: leadNodeId,
      label: isCrypto ? `${lead.username.slice(0, 8)}...` : `@${lead.username}`,
      type: isCrypto ? "crypto" : "lead",
      category: isCrypto ? "Crypto Wallet" : "Correlated Identity",
      level: 2,
      metadata: {
        identifier: lead.username,
        foundOn: lead.foundOn,
        from: lead.from,
        queryType: lead.queryType,
        entityType: lead.entityType,
        confidence: lead.confidence || 0.9
      }
    });

    const source = originNodeId || `profile:${(lead.from || "").toLowerCase()}`;
    const relation = isCrypto ? "extracted_crypto_wallet" : "mentions_identity";

    this.addEdge(source, leadNodeId, relation, {
      foundOn: lead.foundOn,
      confidence: lead.confidence || 0.9
    });
  }

  findOriginatingNode(username) {
    const lower = username.toLowerCase();
    // 1. Direct lead node match
    for (const [id, node] of this.nodes) {
      if (node.type === "lead" && node.metadata?.identifier?.toLowerCase() === lower) {
        return id;
      }
    }
    // 2. Profile node match
    for (const [id, node] of this.nodes) {
      if (node.type === "profile" && node.metadata?.username?.toLowerCase() === lower) {
        return id;
      }
    }
    // 3. Email root query localpart match
    if (this.rootType === "email") {
      const [localPart] = this.rootQuery.toLowerCase().split("@");
      if (localPart === lower) {
        return `root:${this.rootType}:${this.rootQuery}`;
      }
    }
    return null;
  }

  toJSON() {
    return {
      rootQuery: this.rootQuery,
      rootType: this.rootType,
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      nodes: Array.from(this.nodes.values()),
      edges: this.edges
    };
  }
}
