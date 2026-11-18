/**
 * Platform definitions for LocalFingerprint OSINT engine.
 * Reverse-engineered & enhanced from fingerprint.to and Maigret catalogs.
 */

import { estimateInstagramCreationDate } from "../engine/instagram-resolver.mjs";

export const MAJOR_PLATFORMS = [
  {
    name: "GitHub",
    category: "Coding",
    url: "https://github.com/{username}",
    urlMain: "https://github.com",
    probeUrl: "https://github.com/{username}",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    async check(res, text, username) {
      if (res.status === 404) return { exists: false };
      if (res.status === 200) {
        // If JSON response (from API fallback)
        if (text.trim().startsWith("{")) {
          try {
            const data = JSON.parse(text);
            if (data.login) {
              return {
                exists: true,
                username: data.login || username,
                displayName: data.name || data.login || username,
                userId: String(data.id || ""),
                profileUrl: data.html_url || `https://github.com/${username}`,
                platformUrl: "https://github.com",
                pfpUrl: data.avatar_url || "",
                bio: data.bio || "",
                location: data.location || "",
                website: data.blog ? (data.blog.startsWith("http") ? data.blog : `https://${data.blog}`) : "",
                followers: data.followers || 0,
                following: data.following || 0,
                posts: data.public_repos || 0,
                createdAt: data.created_at ? new Date(data.created_at).toLocaleDateString() : "",
                isVerified: false,
                isPrivate: false,
                emails: data.email ? [data.email] : [],
                extras: {
                  publicRepos: data.public_repos,
                  publicGists: data.public_gists,
                  company: data.company || "",
                  twitterUsername: data.twitter_username || ""
                },
                discoveredUsernames: data.twitter_username ? [{ username: data.twitter_username, foundOn: "GitHub", queryType: "username" }] : []
              };
            }
          } catch {}
        }

        // HTML Response parsing (Edge-Native Zero Rate Limits)
        // Extract display name: itemprop="name">[\s]*(.*?)[\s]*</span>
        const nameMatch = text.match(/itemprop="name">\s*([^<]+?)\s*<\/span>/i);
        const displayName = nameMatch ? nameMatch[1].trim() : username;

        // Extract bio: data-bio-text="([^"]+)" or class="p-note user-profile-bio[^>]*>([\s\S]*?)<\/div>
        let bio = "";
        const bioDataMatch = text.match(/data-bio-text="([^"]+)"/i);
        if (bioDataMatch) {
          bio = bioDataMatch[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
        } else {
          const bioDivMatch = text.match(/class="[^"]*user-profile-bio[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
          if (bioDivMatch) bio = bioDivMatch[1].replace(/<[^>]+>/g, "").trim();
        }

        // Extract location: aria-label="Home location:\s*([^"]+)" or itemprop="homeLocation"[^>]*>[\s\S]*?<span class="p-label">\s*([^<]+)\s*<\/span>
        let location = "";
        const locAriaMatch = text.match(/aria-label="Home location:\s*([^"]+)"/i);
        if (locAriaMatch) {
          location = locAriaMatch[1].trim();
        } else {
          const locSpanMatch = text.match(/itemprop="homeLocation"[\s\S]*?<span class="p-label">\s*([^<]+)\s*<\/span>/i);
          if (locSpanMatch) location = locSpanMatch[1].trim();
        }

        // Extract avatar: itemprop="image"\s+href="([^"]+)" or class="avatar-user" src="([^"]+)"
        const avatarMatch = text.match(/itemprop="image"\s+href="([^"]+)"/i) || text.match(/class="[^"]*avatar-user[^"]*"\s+src="([^"]+)"/i);
        const pfpUrl = avatarMatch ? avatarMatch[1] : "";

        // Discovered leads and outlinks from HTML (Twitter, LinkedIn, personal website, social icons)
        const discovered = [];
        const outlinksSet = new Set();

        // Extract website from itemprop="url" or rel="nofollow me"
        let website = "";
        const websiteMatch = text.match(/itemprop="url"[^>]*>\s*<a[^>]*href="([^"]+)"/i) ||
                             text.match(/data-test-selector="profile-website-url"[^>]*>\s*<a[^>]*href="([^"]+)"/i) ||
                             text.match(/<a[^>]*rel="nofollow me"[^>]*href="(https?:\/\/(?!(?:www\.)?(?:twitter|x|linkedin|github)\.com)[^"]+)"/i);
        if (websiteMatch) {
          website = websiteMatch[1].trim();
          outlinksSet.add(website);
        }

        // Extract social outlinks
        const socialMatches = text.matchAll(/<li[^>]*itemprop="social"[^>]*>\s*<a[^>]*href="([^"]+)"/gi);
        for (const sm of socialMatches) {
          outlinksSet.add(sm[1].trim());
        }
        const relMeMatches = text.matchAll(/<a[^>]*rel="nofollow me"[^>]*href="([^"]+)"/gi);
        for (const rm of relMeMatches) {
          outlinksSet.add(rm[1].trim());
        }

        const outlinks = Array.from(outlinksSet).filter(u => typeof u === "string" && u.startsWith("http"));
        const linkedAccounts = [];

        const twitterMatch = text.match(/href="https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})"/i);
        if (twitterMatch) {
          discovered.push({ username: twitterMatch[1], foundOn: "GitHub", queryType: "username" });
          linkedAccounts.push({ platform: "Twitter", username: twitterMatch[1], url: `https://x.com/${twitterMatch[1]}` });
        }
        const linkedinMatch = text.match(/href="https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)"/i);
        if (linkedinMatch) {
          discovered.push({ username: linkedinMatch[1], foundOn: "GitHub", queryType: "username", leadType: "linkedin" });
          linkedAccounts.push({ platform: "LinkedIn", username: linkedinMatch[1], url: `https://linkedin.com/in/${linkedinMatch[1]}` });
        }

        return {
          exists: true,
          username,
          displayName,
          profileUrl: `https://github.com/${username}`,
          platformUrl: "https://github.com",
          pfpUrl,
          bio,
          location,
          website: website || (outlinks[0] || ""),
          followers: null,
          following: null,
          posts: null,
          isVerified: false,
          isPrivate: false,
          emails: [],
          extras: {
            extractedFromHtml: true,
            outlinks,
            linkedAccounts
          },
          discoveredUsernames: discovered
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Instagram",
    category: "Social",
    url: "https://www.instagram.com/{username}",
    urlMain: "https://www.instagram.com",
    probeUrl: "https://www.instagram.com/{username}/",
    headers: {
      "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    async check(res, text, username) {
      if (res.status === 404) return { exists: false };

      const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].replace(/&#064;/g, "@").replace(/&amp;/g, "&") : "";

      const notFound = title.includes("Page Not Found") ||
                       title.includes("Profile isn't available") ||
                       title.trim() === "Instagram" ||
                       text.includes("Sorry, this page isn't available");

      if (notFound) {
        return { exists: false };
      }

      // 1. Search for embedded JSON structures (xig_user_by_igid_v2, Relay, Polaris)
      let embeddedUser = null;
      const scriptRegex = /<script\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
      let scriptMatch;
      while ((scriptMatch = scriptRegex.exec(text)) !== null) {
        const content = scriptMatch[1];
        if (content.includes("xig_user_by_igid_v2") || content.includes('"biography"') || content.includes('"full_name"')) {
          const igidMatch = content.match(/"xig_user_by_igid_v2":\s*(\{[\s\S]*?\})(?:,\s*"(?:xig_logged_out|polaris|require)|$)/);
          if (igidMatch) {
            try {
              embeddedUser = JSON.parse(igidMatch[1]);
              break;
            } catch {}
          }
          try {
            const parsed = JSON.parse(content);
            const candidate = parsed?.require?.[0]?.[3]?.[0]?.__bbox?.result?.data?.user ||
                              parsed?.xig_user_by_igid_v2 ||
                              parsed?.user;
            if (candidate) {
              embeddedUser = candidate;
              break;
            }
          } catch {}
        }
      }

      // 2. Display Name extraction
      let displayName = embeddedUser?.full_name || "";
      if (!displayName) {
        const nameMatch = title.match(/^(.+?)\s*\(@/);
        displayName = nameMatch ? nameMatch[1].trim() : username;
      }

      // 3. User ID extraction
      let userId = embeddedUser?.pk || embeddedUser?.id || "";
      if (!userId) {
        const idMatch = text.match(/"profile_id":"(\d+)"/) || text.match(/"id":"(\d{5,})"/);
        userId = idMatch ? idMatch[1] : "";
      }

      // 4. Follower metrics extraction
      let followers = (embeddedUser?.follower_count !== undefined && embeddedUser?.follower_count !== null)
        ? String(embeddedUser.follower_count)
        : null;
      let following = (embeddedUser?.following_count !== undefined && embeddedUser?.following_count !== null)
        ? String(embeddedUser.following_count)
        : null;
      let posts = (embeddedUser?.media_count !== undefined && embeddedUser?.media_count !== null)
        ? String(embeddedUser.media_count)
        : null;

      const ogDescMatch = text.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
      const ogDesc = ogDescMatch ? ogDescMatch[1].replace(/&amp;/g, "&").replace(/&#064;/g, "@") : "";

      if (ogDesc) {
        const statsMatch = ogDesc.match(/([\d.,KMkm]+)\s*Followers,\s*([\d.,KMkm]+)\s*Following,\s*([\d.,KMkm]+)\s*Posts/i);
        if (statsMatch) {
          if (followers === null) followers = statsMatch[1];
          if (following === null) following = statsMatch[2];
          if (posts === null) posts = statsMatch[3];
        }
      }

      // 5. Clean Biography extraction (separate follower counts from actual bio)
      let bio = embeddedUser?.biography ?? "";
      if (!bio && ogDesc) {
        const bioMatch = ogDesc.match(/on Instagram:\s*"?([\s\S]*?)"?\s*$/i);
        if (bioMatch && bioMatch[1]) {
          bio = bioMatch[1].replace(/^["']/, "").replace(/["']$/, "").replace(/&quot;/g, '"').trim();
        }
      }
      if (bio) {
        bio = bio.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#064;/g, "@").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      }

      // 6. Avatar URL extraction
      let pfpUrl = embeddedUser?.profile_pic_url_hd || embeddedUser?.profile_pic_url || "";
      if (!pfpUrl) {
        const ogImgMatch = text.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
        pfpUrl = ogImgMatch ? ogImgMatch[1].replace(/&amp;/g, "&") : "";
      }

      // 7. Verification & Privacy Status
      let isVerified = Boolean(embeddedUser?.is_verified);
      if (!isVerified) {
        isVerified = /"is_verified":\s*true/i.test(text);
      }
      let isPrivate = Boolean(embeddedUser?.is_private);
      if (!isPrivate) {
        isPrivate = /"is_private":\s*true/i.test(text);
      }

      // 8. Category & Outlinks
      let category = embeddedUser?.category_name || "";
      if (!category) {
        const catMatch = text.match(/"category_name":"([^"]+)"/) || text.match(/"business_category_name":"([^"]+)"/);
        if (catMatch) category = catMatch[1];
      }

      const outlinksSet = new Set();
      if (embeddedUser?.external_url) {
        outlinksSet.add(embeddedUser.external_url.replace(/\\\//g, "/"));
      }
      if (Array.isArray(embeddedUser?.bio_links)) {
        for (const link of embeddedUser.bio_links) {
          if (link?.url) outlinksSet.add(link.url.replace(/\\\//g, "/"));
        }
      }
      const extMatch = text.match(/"external_url":"([^"]+)"/);
      if (extMatch && extMatch[1] && extMatch[1] !== "null") {
        outlinksSet.add(extMatch[1].replace(/\\\//g, "/"));
      }
      const bioLinkMatches = text.matchAll(/"url":"(https?:\\\/\\\/[^"]+)"/g);
      for (const blm of bioLinkMatches) {
        outlinksSet.add(blm[1].replace(/\\\//g, "/"));
      }
      const isIgnoredAssetUrl = (url) => {
        if (!url || typeof url !== "string") return true;
        const lower = url.toLowerCase();
        if (lower.includes("cdninstagram.com") || lower.includes("fbcdn.net") || lower.includes("rsrc.php")) return true;
        if (lower.includes("instagram.com/static") || lower.includes("facebook.com/tr")) return true;
        if (/\.(js|css|png|jpg|jpeg|gif|woff2?|svg|ico|webp)(\?|$)/i.test(lower)) return true;
        return false;
      };

      const outlinks = Array.from(outlinksSet).filter(u => typeof u === "string" && u.startsWith("http") && !isIgnoredAssetUrl(u));
      const website = outlinks.length > 0 ? outlinks[0] : "";

      // 9. Threads integration
      let threadsHandle = "";
      if (embeddedUser?.threads_profile_glyph_url || embeddedUser?.has_threads_profile || text.includes("threads.net")) {
        const thMatch = text.match(/threads\.net\/@([a-zA-Z0-9_.]+)/i);
        threadsHandle = thMatch ? thMatch[1] : (embeddedUser?.has_threads_profile ? username : "");
      }

      // 10. Discovered Username Leads
      const discovered = [];
      if (threadsHandle) {
        discovered.push({
          username: threadsHandle,
          foundOn: "Instagram (Threads)",
          from: username,
          queryType: "username",
          confidence: 0.98,
          entityType: "handle"
        });
      }
      if (bio) {
        const mentions = bio.matchAll(/@([a-zA-Z0-9_.]{3,30})\b/g);
        for (const m of mentions) {
          const handle = m[1];
          if (handle.toLowerCase() !== username.toLowerCase()) {
            discovered.push({
              username: handle,
              foundOn: "Instagram Bio @mention",
              from: username,
              queryType: "username",
              confidence: 0.85,
              entityType: "bio_mention"
            });
          }
        }
      }
      for (const url of outlinks) {
        const ltMatch = url.match(/linktr\.ee\/([a-zA-Z0-9_.-]+)/i);
        if (ltMatch) {
          discovered.push({
            username: ltMatch[1],
            foundOn: "Instagram Outlink (Linktree)",
            from: username,
            queryType: "username",
            confidence: 0.95,
            entityType: "social_link"
          });
        }
        const ghMatch = url.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
        if (ghMatch) {
          discovered.push({
            username: ghMatch[1],
            foundOn: "Instagram Outlink (GitHub)",
            from: username,
            queryType: "username",
            confidence: 0.95,
            entityType: "social_link"
          });
        }
        const xMatch = url.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})/i);
        if (xMatch) {
          discovered.push({
            username: xMatch[1],
            foundOn: "Instagram Outlink (Twitter)",
            from: username,
            queryType: "username",
            confidence: 0.95,
            entityType: "social_link"
          });
        }
      }

      // Deep Bio Email and Phone Extraction
      const bioEmails = [];
      const bioPhones = [];
      if (bio) {
        const emailMatches = bio.matchAll(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
        for (const em of emailMatches) {
          const foundEm = em[1].toLowerCase();
          if (!bioEmails.includes(foundEm)) {
            bioEmails.push(foundEm);
            discovered.push({
              username: foundEm,
              foundOn: "Instagram Bio Contact",
              from: username,
              queryType: "email",
              confidence: 0.95,
              entityType: "email"
            });
          }
        }
        const phoneMatches = bio.matchAll(/(?:\+?\d{1,4}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/g);
        for (const pm of phoneMatches) {
          const cleanPhone = pm[0].trim();
          const digits = cleanPhone.replace(/\D/g, "");
          if (digits.length >= 10 && digits.length <= 15 && !bioPhones.includes(cleanPhone)) {
            bioPhones.push(cleanPhone);
            discovered.push({
              username: cleanPhone,
              foundOn: "Instagram Bio Phone",
              from: username,
              queryType: "phone",
              confidence: 0.9,
              entityType: "phone"
            });
          }
        }
      }

      const registrationEst = estimateInstagramCreationDate(userId);

      return {
        exists: true,
        username,
        displayName,
        userId,
        profileUrl: `https://www.instagram.com/${username}`,
        platformUrl: "https://www.instagram.com",
        pfpUrl,
        bio,
        location: "",
        website,
        followers,
        following,
        posts,
        createdAt: registrationEst?.estimatedYear ? String(registrationEst.estimatedYear) : "",
        isVerified,
        isPrivate,
        emails: bioEmails,
        phones: bioPhones,
        extras: {
          instagramUserId: userId,
          rawTitle: title,
          category,
          threadsHandle,
          registrationEst,
          outlinks,
          linkedAccounts: threadsHandle
            ? [{ platform: "Threads", username: threadsHandle, url: `https://threads.net/@${threadsHandle}` }]
            : []
        },
        discoveredUsernames: discovered
      };
    }
  },
  {
    name: "Reddit",
    category: "Social",
    url: "https://www.reddit.com/user/{username}",
    urlMain: "https://www.reddit.com",
    probeUrl: "https://www.reddit.com/user/{username}/about.json",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    async check(res, text, username) {
      if (res.status === 404 || res.status === 403) {
        return { exists: false };
      }
      try {
        const json = JSON.parse(text);
        if (json.data && json.data.name) {
          const d = json.data;
          const s = d.subreddit || {};

          const outlinks = [];
          const linkedAccounts = [];
          const discovered = [];

          // Parse social_links array
          const rawSocialLinks = d.social_links || s.social_links || [];
          if (Array.isArray(rawSocialLinks)) {
            for (const sl of rawSocialLinks) {
              const url = sl.url || "";
              if (url && url.startsWith("http")) {
                if (!outlinks.includes(url)) outlinks.push(url);
                const platform = sl.provider || "External";
                const handle = sl.handle || sl.username || "";
                linkedAccounts.push({ platform, username: handle, url });
                if (handle) {
                  discovered.push({ username: handle, foundOn: `Reddit (${platform})`, from: d.name, queryType: "username" });
                }
              }
            }
          }

          // Scan bio / public_description for URLs & mentions
          const desc = s.public_description || "";
          const descUrls = desc.matchAll(/https?:\/\/[^\s"<>()]+/gi);
          for (const u of descUrls) {
            if (!outlinks.includes(u[0])) outlinks.push(u[0]);
          }

          return {
            exists: true,
            username: d.name,
            displayName: s.title || d.name,
            userId: d.id || "",
            profileUrl: `https://www.reddit.com/user/${d.name}`,
            platformUrl: "https://reddit.com",
            pfpUrl: (s.icon_img || d.icon_img || "").split("?")[0],
            bannerUrl: (s.banner_img || "").split("?")[0],
            bio: desc,
            website: outlinks[0] || "",
            followers: s.subscribers || 0,
            posts: (d.link_karma || 0) + (d.comment_karma || 0),
            createdAt: d.created_utc ? new Date(d.created_utc * 1000).toLocaleDateString() : "",
            isVerified: Boolean(d.is_gold || d.has_verified_email),
            isPrivate: Boolean(s.over_18),
            extras: {
              totalKarma: d.total_karma,
              linkKarma: d.link_karma,
              commentKarma: d.comment_karma,
              isSuspended: Boolean(d.is_suspended),
              outlinks,
              linkedAccounts
            },
            discoveredUsernames: discovered
          };
        }
      } catch {}
      return { exists: false };
    }
  },
  {
    name: "Telegram",
    category: "Messaging",
    url: "https://t.me/{username}",
    urlMain: "https://telegram.org",
    probeUrl: "https://t.me/{username}",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    async check(res, text, username) {
      if (res.status !== 200) return { exists: false };
      if (text.includes("tgme_page_extra") && !text.includes("If you have Telegram, you can contact") && !text.includes("no such account")) {
        const titleMatch = text.match(/<div class="tgme_page_title"[^>]*>([^<]+)<\/div>/i);
        const descMatch = text.match(/<div class="tgme_page_description"[^>]*>([\s\S]*?)<\/div>/i);
        const photoMatch = text.match(/<img class="tgme_page_photo_image" src="([^"]+)"/i);
        const extraMatch = text.match(/<div class="tgme_page_extra"[^>]*>([^<]+)<\/div>/i);
        
        const rawDesc = descMatch ? descMatch[1] : "";
        const bio = rawDesc.replace(/<[^>]+>/g, " ").trim();

        const outlinks = [];
        const discovered = [];
        const emails = [];

        const linkMatches = rawDesc.matchAll(/href="([^"]+)"/gi);
        for (const lm of linkMatches) {
          const u = (lm[1] || "").replace(/[.,;:!?)]+$/, "");
          if (u.startsWith("http") && !outlinks.includes(u)) outlinks.push(u);
        }
        const textUrls = bio.matchAll(/https?:\/\/[^\s"<>()]+/gi);
        for (const tu of textUrls) {
          const u = (tu[0] || "").replace(/[.,;:!?)]+$/, "");
          if (u.startsWith("http") && !outlinks.includes(u)) outlinks.push(u);
        }

        const emailMatches = bio.matchAll(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g);
        for (const em of emailMatches) {
          emails.push(em[1]);
          discovered.push({ username: em[1], foundOn: "Telegram", from: username, queryType: "email" });
        }

        const mentionMatches = bio.matchAll(/@([a-zA-Z0-9_]{4,32})\b/g);
        for (const mm of mentionMatches) {
          if (mm[1].toLowerCase() !== username.toLowerCase()) {
            discovered.push({ username: mm[1], foundOn: "Telegram", from: username, queryType: "username" });
          }
        }

        return {
          exists: true,
          username,
          displayName: titleMatch ? titleMatch[1].trim() : username,
          profileUrl: `https://t.me/${username}`,
          platformUrl: "https://telegram.org",
          pfpUrl: photoMatch ? photoMatch[1] : "",
          bio,
          location: "",
          website: outlinks[0] || "",
          emails,
          extras: {
            handle: extraMatch ? extraMatch[1].trim() : `@${username}`,
            outlinks
          },
          discoveredUsernames: discovered
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Steam",
    category: "Gaming",
    url: "https://steamcommunity.com/id/{username}",
    urlMain: "https://steamcommunity.com",
    probeUrl: "https://steamcommunity.com/id/{username}",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("The specified profile could not be found")) {
        const nameMatch = text.match(/<span class="actual_persona_name">([^<]+)<\/span>/i);
        const avatarMatch = text.match(/<div class="playerAvatarAutoSizeInner">\s*<img src="([^"]+)"/i);
        const summaryMatch = text.match(/<div class="profile_summary">([\s\S]*?)<\/div>/i);
        const levelMatch = text.match(/<span class="friendPlayerLevelNum">(\d+)<\/span>/i);
        
        const bio = summaryMatch ? summaryMatch[1].replace(/<[^>]+>/g, " ").trim() : "";
        return {
          exists: true,
          username,
          displayName: nameMatch ? nameMatch[1].trim() : username,
          profileUrl: `https://steamcommunity.com/id/${username}`,
          platformUrl: "https://steamcommunity.com",
          pfpUrl: avatarMatch ? avatarMatch[1] : "",
          bio,
          extras: {
            steamLevel: levelMatch ? levelMatch[1] : null
          }
        };
      }
      return { exists: false };
    }
  },
  {
    name: "GitLab",
    category: "Coding",
    url: "https://gitlab.com/{username}",
    urlMain: "https://gitlab.com",
    probeUrl: "https://gitlab.com/api/v4/users?username={username}",
    headers: {
      "User-Agent": "Mozilla/5.0"
    },
    async check(res, text, username) {
      if (res.status === 200) {
        try {
          const arr = JSON.parse(text);
          if (Array.isArray(arr) && arr.length > 0) {
            const u = arr[0];
            return {
              exists: true,
              username: u.username,
              displayName: u.name || u.username,
              userId: String(u.id),
              profileUrl: u.web_url || `https://gitlab.com/${username}`,
              platformUrl: "https://gitlab.com",
              pfpUrl: u.avatar_url || "",
              bio: u.bio || "",
              location: u.location || "",
              website: u.website_url || "",
              createdAt: u.created_at ? new Date(u.created_at).toLocaleDateString() : "",
              extras: { state: u.state }
            };
          }
        } catch {}
      }
      return { exists: false };
    }
  },
  {
    name: "Keybase",
    category: "Security",
    url: "https://keybase.io/{username}",
    urlMain: "https://keybase.io",
    probeUrl: "https://keybase.io/_/api/1.0/user/lookup.json?usernames={username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200) {
        try {
          const data = JSON.parse(text);
          if (data.status?.code === 0 && data.them?.length > 0) {
            const user = data.them[0];
            const profile = user.profile || {};
            const proofs = user.proofs_summary?.by_proof_type || {};
            const discovered = [];
            
            // Keybase connects Twitter, GitHub, Reddit, Hackernews handles!
            if (proofs.twitter?.length) proofs.twitter.forEach(p => discovered.push({ username: p.nametag, foundOn: "Twitter", from: "Keybase" }));
            if (proofs.github?.length) proofs.github.forEach(p => discovered.push({ username: p.nametag, foundOn: "GitHub", from: "Keybase" }));
            if (proofs.reddit?.length) proofs.reddit.forEach(p => discovered.push({ username: p.nametag, foundOn: "Reddit", from: "Keybase" }));
            if (proofs.hackernews?.length) proofs.hackernews.forEach(p => discovered.push({ username: p.nametag, foundOn: "HackerNews", from: "Keybase" }));

            return {
              exists: true,
              username,
              displayName: profile.full_name || username,
              userId: user.id || "",
              profileUrl: `https://keybase.io/${username}`,
              platformUrl: "https://keybase.io",
              pfpUrl: user.pictures?.primary?.url || "",
              bio: profile.bio || "",
              location: profile.location || "",
              isVerified: true,
              extras: {
                cryptocurrencyAddresses: user.cryptocurrency_addresses || {},
                devices: Object.keys(user.devices || {}).length
              },
              discoveredUsernames: discovered
            };
          }
        } catch {}
      }
      return { exists: false };
    }
  },
  {
    name: "HackerNews",
    category: "Tech",
    url: "https://news.ycombinator.com/user?id={username}",
    urlMain: "https://news.ycombinator.com",
    probeUrl: "https://hacker-news.firebaseio.com/v0/user/{username}.json",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && text && text !== "null") {
        try {
          const data = JSON.parse(text);
          if (data.id) {
            return {
              exists: true,
              username: data.id,
              displayName: data.id,
              profileUrl: `https://news.ycombinator.com/user?id=${data.id}`,
              platformUrl: "https://news.ycombinator.com",
              bio: data.about ? data.about.replace(/<[^>]+>/g, " ").trim() : "",
              posts: (data.submitted || []).length,
              createdAt: data.created ? new Date(data.created * 1000).toLocaleDateString() : "",
              extras: {
                karma: data.karma,
                submittedItems: (data.submitted || []).length
              }
            };
          }
        } catch {}
      }
      return { exists: false };
    }
  },
  {
    name: "Chess.com",
    category: "Gaming",
    url: "https://www.chess.com/member/{username}",
    urlMain: "https://chess.com",
    probeUrl: "https://api.chess.com/pub/player/{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200) {
        try {
          const data = JSON.parse(text);
          if (data.username) {
            return {
              exists: true,
              username: data.username,
              displayName: data.name || data.username,
              userId: String(data.player_id || ""),
              profileUrl: data.url || `https://www.chess.com/member/${data.username}`,
              platformUrl: "https://chess.com",
              pfpUrl: data.avatar || "",
              location: data.location || "",
              followers: data.followers || 0,
              createdAt: data.joined ? new Date(data.joined * 1000).toLocaleDateString() : "",
              isVerified: Boolean(data.verified || data.title),
              extras: {
                title: data.title || null,
                status: data.status || "active",
                league: data.league || null
              }
            };
          }
        } catch {}
      }
      return { exists: false };
    }
  },
  {
    name: "Lichess",
    category: "Gaming",
    url: "https://lichess.org/@/{username}",
    urlMain: "https://lichess.org",
    probeUrl: "https://lichess.org/api/user/{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200) {
        try {
          const d = JSON.parse(text);
          if (d.id) {
            const p = d.profile || {};
            return {
              exists: true,
              username: d.username,
              displayName: `${p.firstName || ""} ${p.lastName || ""}`.trim() || d.username,
              profileUrl: `https://lichess.org/@/${d.username}`,
              platformUrl: "https://lichess.org",
              bio: p.bio || "",
              location: p.country || p.location || "",
              posts: d.count?.all || 0,
              createdAt: d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "",
              isVerified: Boolean(d.patron || d.title),
              extras: {
                title: d.title || null,
                bulletRating: d.perfs?.bullet?.rating,
                blitzRating: d.perfs?.blitz?.rating,
                rapidRating: d.perfs?.rapid?.rating
              }
            };
          }
        } catch {}
      }
      return { exists: false };
    }
  },
  {
    name: "Duolingo",
    category: "Learning",
    url: "https://www.duolingo.com/profile/{username}",
    urlMain: "https://duolingo.com",
    probeUrl: "https://www.duolingo.com/2017-06-30/users?username={username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200) {
        try {
          const data = JSON.parse(text);
          if (data.users && data.users.length > 0) {
            const u = data.users[0];
            return {
              exists: true,
              username: u.username,
              displayName: u.name || u.username,
              userId: String(u.id),
              profileUrl: `https://www.duolingo.com/profile/${u.username}`,
              platformUrl: "https://duolingo.com",
              pfpUrl: u.picture ? `${u.picture}/medium` : "",
              bio: u.bio || "",
              createdAt: u.creationDate ? new Date(u.creationDate * 1000).toLocaleDateString() : "",
              extras: {
                streak: u.streak,
                totalXp: u.totalXp,
                courses: (u.courses || []).map(c => c.title)
              }
            };
          }
        } catch {}
      }
      return { exists: false };
    }
  },
  {
    name: "DockerHub",
    category: "Coding",
    url: "https://hub.docker.com/u/{username}",
    urlMain: "https://hub.docker.com",
    probeUrl: "https://hub.docker.com/v2/users/{username}/",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200) {
        try {
          const d = JSON.parse(text);
          if (d.username) {
            return {
              exists: true,
              username: d.username,
              displayName: d.full_name || d.username,
              userId: d.id || "",
              profileUrl: `https://hub.docker.com/u/${d.username}`,
              platformUrl: "https://hub.docker.com",
              pfpUrl: d.gravatar_url || "",
              location: d.location || "",
              createdAt: d.date_joined ? new Date(d.date_joined).toLocaleDateString() : "",
              extras: { company: d.company }
            };
          }
        } catch {}
      }
      return { exists: false };
    }
  },
  {
    name: "NPM",
    category: "Coding",
    url: "https://www.npmjs.com/~{username}",
    urlMain: "https://npmjs.com",
    probeUrl: "https://www.npmjs.com/~{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("404 Not Found") && text.includes(`class="`)) {
        const nameMatch = text.match(/<h2[^>]*>([^<]+)<\/h2>/i);
        const avatarMatch = text.match(/<img[^>]+src="([^"]+avatars\.npm[^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: nameMatch ? nameMatch[1].trim() : username,
          profileUrl: `https://www.npmjs.com/~${username}`,
          platformUrl: "https://npmjs.com",
          pfpUrl: avatarMatch ? avatarMatch[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Medium",
    category: "Publishing",
    url: "https://medium.com/@{username}",
    urlMain: "https://medium.com",
    probeUrl: "https://medium.com/@{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("PAGE NOT FOUND") && !text.includes("404")) {
        const titleMatch = text.match(/<title>([^<]+)<\/title>/i);
        const descMatch = text.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
        const imageMatch = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: titleMatch ? titleMatch[1].replace(/ – Medium$/, "").trim() : username,
          profileUrl: `https://medium.com/@${username}`,
          platformUrl: "https://medium.com",
          pfpUrl: imageMatch ? imageMatch[1] : "",
          bio: descMatch ? descMatch[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Pinterest",
    category: "Social",
    url: "https://www.pinterest.com/{username}/",
    urlMain: "https://pinterest.com",
    probeUrl: "https://www.pinterest.com/{username}/",
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("User not found") && !text.includes("404")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        const ogDesc = text.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].replace(/ \(.*?\)$/, "").trim() : username,
          profileUrl: `https://www.pinterest.com/${username}/`,
          platformUrl: "https://pinterest.com",
          pfpUrl: ogImage ? ogImage[1] : "",
          bio: ogDesc ? ogDesc[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Twitch",
    category: "Streaming",
    url: "https://www.twitch.tv/{username}",
    urlMain: "https://twitch.tv",
    probeUrl: "https://www.twitch.tv/{username}",
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("content is currently unavailable") && !text.includes("channel was not found")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        const ogDesc = text.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].replace(/ - Twitch$/, "").trim() : username,
          profileUrl: `https://www.twitch.tv/${username}`,
          platformUrl: "https://twitch.tv",
          pfpUrl: ogImage ? ogImage[1] : "",
          bio: ogDesc ? ogDesc[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Spotify",
    category: "Music",
    url: "https://open.spotify.com/user/{username}",
    urlMain: "https://spotify.com",
    probeUrl: "https://open.spotify.com/user/{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("Page not found") && !text.includes("404")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].replace(/ on Spotify$/, "").trim() : username,
          profileUrl: `https://open.spotify.com/user/${username}`,
          platformUrl: "https://spotify.com",
          pfpUrl: ogImage ? ogImage[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "SoundCloud",
    category: "Music",
    url: "https://soundcloud.com/{username}",
    urlMain: "https://soundcloud.com",
    probeUrl: "https://soundcloud.com/{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("We can't find that user")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        const ogDesc = text.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].trim() : username,
          profileUrl: `https://soundcloud.com/${username}`,
          platformUrl: "https://soundcloud.com",
          pfpUrl: ogImage ? ogImage[1] : "",
          bio: ogDesc ? ogDesc[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "DevTo",
    category: "Coding",
    url: "https://dev.to/{username}",
    urlMain: "https://dev.to",
    probeUrl: "https://dev.to/api/users/by_username?url={username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200) {
        try {
          const d = JSON.parse(text);
          if (d.username) {
            const discovered = [];
            if (d.twitter_username) discovered.push({ username: d.twitter_username, foundOn: "Twitter", from: "DevTo" });
            if (d.github_username) discovered.push({ username: d.github_username, foundOn: "GitHub", from: "DevTo" });
            return {
              exists: true,
              username: d.username,
              displayName: d.name || d.username,
              userId: String(d.id),
              profileUrl: `https://dev.to/${d.username}`,
              platformUrl: "https://dev.to",
              pfpUrl: d.profile_image || "",
              bio: d.summary || "",
              location: d.location || "",
              website: d.website_url || "",
              createdAt: d.joined_at ? new Date(d.joined_at).toLocaleDateString() : "",
              discoveredUsernames: discovered
            };
          }
        } catch {}
      }
      return { exists: false };
    }
  },
  {
    name: "CodePen",
    category: "Coding",
    url: "https://codepen.io/{username}",
    urlMain: "https://codepen.io",
    probeUrl: "https://codepen.io/{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("404 Not Found") && !text.includes("Couldn't find that")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].replace(/ on CodePen$/, "").trim() : username,
          profileUrl: `https://codepen.io/${username}`,
          platformUrl: "https://codepen.io",
          pfpUrl: ogImage ? ogImage[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Replit",
    category: "Coding",
    url: "https://replit.com/@{username}",
    urlMain: "https://replit.com",
    probeUrl: "https://replit.com/@{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("User not found")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].replace(/ - Replit$/, "").trim() : username,
          profileUrl: `https://replit.com/@${username}`,
          platformUrl: "https://replit.com",
          pfpUrl: ogImage ? ogImage[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Dribbble",
    category: "Design",
    url: "https://dribbble.com/{username}",
    urlMain: "https://dribbble.com",
    probeUrl: "https://dribbble.com/{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("Whoops, that page is gone")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        const ogDesc = text.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].replace(/ on Dribbble$/, "").trim() : username,
          profileUrl: `https://dribbble.com/${username}`,
          platformUrl: "https://dribbble.com",
          pfpUrl: ogImage ? ogImage[1] : "",
          bio: ogDesc ? ogDesc[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Behance",
    category: "Design",
    url: "https://www.behance.net/{username}",
    urlMain: "https://behance.net",
    probeUrl: "https://www.behance.net/{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("Oops, looks like you're lost")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].replace(/ on Behance$/, "").trim() : username,
          profileUrl: `https://www.behance.net/${username}`,
          platformUrl: "https://behance.net",
          pfpUrl: ogImage ? ogImage[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Substack",
    category: "Publishing",
    url: "https://{username}.substack.com",
    urlMain: "https://substack.com",
    probeUrl: "https://{username}.substack.com/api/v1/publication",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200) {
        try {
          const d = JSON.parse(text);
          if (d.name) {
            return {
              exists: true,
              username,
              displayName: d.name,
              profileUrl: `https://${username}.substack.com`,
              platformUrl: "https://substack.com",
              pfpUrl: d.logo_url || d.cover_image_url || "",
              bio: d.hero_text || "",
              createdAt: d.created_at ? new Date(d.created_at).toLocaleDateString() : ""
            };
          }
        } catch {}
      }
      return { exists: false };
    }
  },
  {
    name: "Patreon",
    category: "Creator",
    url: "https://www.patreon.com/{username}",
    urlMain: "https://patreon.com",
    probeUrl: "https://www.patreon.com/{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("404: Not Found") && !text.includes("page doesn't exist")) {
        const ogTitle = text.match(/<meta\s+name="twitter:title"\s+content="([^"]+)"/i) || text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        const ogDesc = text.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].replace(/ is creating .*? \| Patreon$/, "").trim() : username,
          profileUrl: `https://www.patreon.com/${username}`,
          platformUrl: "https://patreon.com",
          pfpUrl: ogImage ? ogImage[1] : "",
          bio: ogDesc ? ogDesc[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "BuyMeACoffee",
    category: "Creator",
    url: "https://www.buymeacoffee.com/{username}",
    urlMain: "https://buymeacoffee.com",
    probeUrl: "https://www.buymeacoffee.com/{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("Page Not Found") && !text.includes("404")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        const ogDesc = text.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].trim() : username,
          profileUrl: `https://www.buymeacoffee.com/${username}`,
          platformUrl: "https://buymeacoffee.com",
          pfpUrl: ogImage ? ogImage[1] : "",
          bio: ogDesc ? ogDesc[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Linktree",
    category: "Social",
    url: "https://linktr.ee/{username}",
    urlMain: "https://linktr.ee",
    probeUrl: "https://linktr.ee/{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("The page you're looking for doesn't exist")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        const ogDesc = text.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);

        let displayName = ogTitle ? ogTitle[1].replace(/ \| Linktree$/, "").trim() : username;
        let pfpUrl = ogImage ? ogImage[1] : "";
        let bio = ogDesc ? ogDesc[1] : "";
        const outlinks = [];
        const linkedAccounts = [];
        const discovered = [];

        // Parse Next.js __NEXT_DATA__
        const nextDataMatch = text.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
        if (nextDataMatch) {
          try {
            const nextData = JSON.parse(nextDataMatch[1]);
            const pageProps = nextData?.props?.pageProps;
            if (pageProps) {
              if (pageProps.account?.name) displayName = pageProps.account.name;
              if (pageProps.account?.description) bio = pageProps.account.description;
              if (pageProps.account?.profilePictureUrl) pfpUrl = pageProps.account.profilePictureUrl;

              // Parse custom links
              if (Array.isArray(pageProps.links)) {
                for (const item of pageProps.links) {
                  if (item?.url && typeof item.url === "string" && item.url.startsWith("http")) {
                    outlinks.push(item.url);
                  }
                }
              }

              // Parse social links
              if (Array.isArray(pageProps.socialLinks)) {
                for (const sl of pageProps.socialLinks) {
                  if (sl?.url && typeof sl.url === "string" && sl.url.startsWith("http")) {
                    outlinks.push(sl.url);
                    linkedAccounts.push({
                      platform: sl.type || "social",
                      username: "",
                      url: sl.url
                    });
                  }
                }
              }
            }
          } catch {}
        }

        // Fallback DOM anchor scan for outlinks
        if (outlinks.length === 0) {
          const anchorMatches = text.matchAll(/<a[^>]+href="(https?:\/\/(?!(?:www\.)?linktr\.ee)[^"]+)"/gi);
          for (const am of anchorMatches) {
            if (!outlinks.includes(am[1])) outlinks.push(am[1]);
          }
        }

        // Extract social handle leads from outlinks
        for (const link of outlinks) {
          const ig = link.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
          if (ig) discovered.push({ username: ig[1], foundOn: "Linktree (Instagram)", from: username, queryType: "username" });
          const tw = link.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})/i);
          if (tw) discovered.push({ username: tw[1], foundOn: "Linktree (Twitter)", from: username, queryType: "username" });
          const tg = link.match(/t\.me\/([a-zA-Z0-9_]{4,32})/i);
          if (tg) discovered.push({ username: tg[1], foundOn: "Linktree (Telegram)", from: username, queryType: "username" });
          const gh = link.match(/github\.com\/([a-zA-Z0-9_-]+)/i);
          if (gh) discovered.push({ username: gh[1], foundOn: "Linktree (GitHub)", from: username, queryType: "username" });
          const yt = link.match(/youtube\.com\/@([a-zA-Z0-9_.-]+)/i);
          if (yt) discovered.push({ username: yt[1], foundOn: "Linktree (YouTube)", from: username, queryType: "username" });
        }

        const uniqueOutlinks = Array.from(new Set(outlinks));

        return {
          exists: true,
          username,
          displayName,
          profileUrl: `https://linktr.ee/${username}`,
          platformUrl: "https://linktr.ee",
          pfpUrl,
          bio,
          location: "",
          website: uniqueOutlinks[0] || "",
          followers: null,
          following: null,
          posts: uniqueOutlinks.length,
          isVerified: false,
          isPrivate: false,
          emails: [],
          extras: {
            outlinks: uniqueOutlinks,
            linkedAccounts
          },
          discoveredUsernames: discovered
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Gravatar",
    category: "Identity",
    url: "https://gravatar.com/{username}",
    urlMain: "https://gravatar.com",
    probeUrl: "https://en.gravatar.com/{username}.json",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200) {
        try {
          const d = JSON.parse(text);
          if (d.entry && d.entry.length > 0) {
            const entry = d.entry[0];
            const discovered = [];
            const linkedAccounts = [];
            const outlinks = [];

            if (Array.isArray(entry.accounts)) {
              for (const acc of entry.accounts) {
                if (acc.username) {
                  discovered.push({
                    username: acc.username,
                    foundOn: acc.shortname || acc.domain,
                    from: "Gravatar",
                    queryType: "username"
                  });
                }
                linkedAccounts.push({
                  platform: acc.shortname || acc.domain,
                  username: acc.username || "",
                  url: acc.url || "",
                  verified: Boolean(acc.verified)
                });
              }
            }

            if (Array.isArray(entry.urls)) {
              for (const u of entry.urls) {
                if (u?.value && u.value.startsWith("http")) {
                  outlinks.push(u.value);
                }
              }
            }

            return {
              exists: true,
              username: entry.preferredUsername || username,
              displayName: entry.displayName || entry.preferredUsername || username,
              userId: entry.id || "",
              profileUrl: entry.profileUrl || `https://gravatar.com/${username}`,
              platformUrl: "https://gravatar.com",
              pfpUrl: entry.thumbnailUrl || "",
              bio: entry.aboutMe || "",
              location: entry.currentLocation || "",
              website: outlinks[0] || "",
              emails: (entry.emails || []).map(e => e.value),
              extras: {
                outlinks,
                linkedAccounts
              },
              discoveredUsernames: discovered
            };
          }
        } catch {}
      }
      return { exists: false };
    }
  },
  {
    name: "Kaggle",
    category: "Data Science",
    url: "https://www.kaggle.com/{username}",
    urlMain: "https://kaggle.com",
    probeUrl: "https://www.kaggle.com/{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("404 Not Found") && !text.includes("User not found")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].replace(/ \| Kaggle$/, "").trim() : username,
          profileUrl: `https://www.kaggle.com/${username}`,
          platformUrl: "https://kaggle.com",
          pfpUrl: ogImage ? ogImage[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Hashnode",
    category: "Coding",
    url: "https://hashnode.com/@{username}",
    urlMain: "https://hashnode.com",
    probeUrl: "https://hashnode.com/@{username}",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("User does not exist") && !text.includes("404")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        const ogDesc = text.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].replace(/ - Hashnode$/, "").trim() : username,
          profileUrl: `https://hashnode.com/@${username}`,
          platformUrl: "https://hashnode.com",
          pfpUrl: ogImage ? ogImage[1] : "",
          bio: ogDesc ? ogDesc[1] : ""
        };
      }
      return { exists: false };
    }
  },
  {
    name: "Disqus",
    category: "Discussion",
    url: "https://disqus.com/by/{username}/",
    urlMain: "https://disqus.com",
    probeUrl: "https://disqus.com/by/{username}/",
    headers: { "User-Agent": "Mozilla/5.0" },
    async check(res, text, username) {
      if (res.status === 200 && !text.includes("Page not found") && !text.includes("user_not_found")) {
        const ogTitle = text.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const ogImage = text.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
        return {
          exists: true,
          username,
          displayName: ogTitle ? ogTitle[1].replace(/ - Disqus$/, "").trim() : username,
          profileUrl: `https://disqus.com/by/${username}/`,
          platformUrl: "https://disqus.com",
          pfpUrl: ogImage ? ogImage[1] : ""
        };
      }
      return { exists: false };
    }
  }
];
