/**
 * Anonymous peer relay: two users message the bot; the bot forwards text between them
 * without exposing phone numbers to each other.
 */

const waiting = new Set();
/** @type {Map<string, string>} */
const partner = new Map();

let loadPromise = null;

function getOptions(config) {
  const ac = config?.anonchat || {};
  return {
    enabled: ac.enabled !== false,
    maxLen: Math.min(Math.max(ac.maxMessageLength || 2000, 100), 8000),
    label: typeof ac.strangerLabel === "string" ? ac.strangerLabel : "Stranger",
  };
}

async function ensureLoaded(db) {
  if (!db || loadPromise) return loadPromise;
  loadPromise = db
    .get("anonchat_state")
    .then((s) => {
      if (!s || typeof s !== "object") return;
      waiting.clear();
      partner.clear();
      if (Array.isArray(s.queue)) {
        for (const jid of s.queue) {
          if (typeof jid === "string") waiting.add(jid);
        }
      }
      if (s.pairs && typeof s.pairs === "object") {
        for (const [a, b] of Object.entries(s.pairs)) {
          if (typeof a === "string" && typeof b === "string") {
            partner.set(a, b);
          }
        }
      }
    })
    .catch(() => {});
  return loadPromise;
}

async function persist(db) {
  if (!db) return;
  const pairsObj = {};
  const seen = new Set();
  for (const [a, b] of partner.entries()) {
    if (seen.has(a)) continue;
    seen.add(a);
    seen.add(b);
    pairsObj[a] = b;
    pairsObj[b] = a;
  }
  await db.set("anonchat_state", {
    queue: [...waiting],
    pairs: pairsObj,
    updatedAt: Date.now(),
  });
}

function unpair(jid, notifyOther, sock, textForOther) {
  const other = partner.get(jid);
  if (other) {
    partner.delete(jid);
    partner.delete(other);
    if (notifyOther && sock?.sendMessage && textForOther) {
      sock.sendMessage(other, { text: textForOther }).catch(() => {});
    }
    return other;
  }
  return null;
}

/**
 * @returns {Promise<boolean>} true if message was consumed by relay
 */
async function relayIfPaired({ sock, sender, body, config, db, logger }) {
  await ensureLoaded(db);
  const opts = getOptions(config);
  if (!opts.enabled || !sock?.sendMessage) return false;

  const peer = partner.get(sender);
  if (!peer) return false;

  const text = String(body || "").trim();
  if (!text) return true;

  if (text.length > opts.maxLen) {
    try {
      await sock.sendMessage(sender, {
        text: `Message too long for relay (max ${opts.maxLen} characters).`,
      });
    } catch (_) {}
    return true;
  }

  const line = `${opts.label}: ${text}`;
  try {
    await sock.sendMessage(peer, { text: line });
  } catch (e) {
    logger?.warn?.(`Anonchat relay failed: ${e.message}`);
    try {
      await sock.sendMessage(sender, {
        text: "Could not deliver to your partner. They may be offline. Try .anonchat next or .anonchat stop.",
      });
    } catch (_) {}
  }
  return true;
}

async function joinQueue({ sock, sender, reply, config, db, logger }) {
  await ensureLoaded(db);
  const opts = getOptions(config);
  if (!opts.enabled) return reply("Anonymous chat relay is disabled.");

  if (partner.has(sender)) {
    return reply("You're already in a chat. Say .anonchat stop to leave.");
  }
  if (waiting.has(sender)) {
    return reply("You're already waiting for a match. Hang tight…");
  }

  waiting.add(sender);
  await persist(db);
  logger?.info?.(`Anonchat: ${sender} joined queue (${waiting.size} waiting)`);

  const peer = pickPeer(sender);
  if (peer) {
    waiting.delete(sender);
    waiting.delete(peer);
    partner.set(sender, peer);
    partner.set(peer, sender);
    await persist(db);

    const intro =
      "You're connected to a stranger. Your number is not shown to them.\n" +
      "Messages you send here (without the bot prefix) are relayed.\n" +
      "Commands: .anonchat stop — leave | .anonchat next — new partner";

    if (sock?.sendMessage) {
      await sock.sendMessage(peer, { text: intro }).catch(() => {});
    }
    return reply(intro);
  }

  return reply("Looking for someone… You'll get a message when you're matched.");
}

function pickPeer(excludeJid) {
  for (const jid of waiting) {
    if (jid !== excludeJid) return jid;
  }
  return null;
}

async function stopSession({ sock, sender, reply, db, logger }) {
  await ensureLoaded(db);
  waiting.delete(sender);
  const other = unpair(
    sender,
    true,
    sock,
    "The stranger ended the chat. Send .anonchat start to find someone new."
  );
  await persist(db);
  logger?.info?.(`Anonchat: ${sender} stopped`);
  if (other) {
    return reply("You left the anonymous chat. Your partner was notified.");
  }
  return reply("You weren't in an anonymous chat.");
}

async function nextPartner({ sock, sender, reply, config, db, logger }) {
  await ensureLoaded(db);
  const opts = getOptions(config);
  if (!opts.enabled) return reply("Anonymous chat relay is disabled.");

  waiting.delete(sender);
  unpair(
    sender,
    true,
    sock,
    "Your partner skipped to someone new. Send .anonchat start to match again."
  );
  await persist(db);

  waiting.add(sender);
  await persist(db);

  const peer = pickPeer(sender);
  if (peer) {
    waiting.delete(sender);
    waiting.delete(peer);
    partner.set(sender, peer);
    partner.set(peer, sender);
    await persist(db);
    const intro =
      "You're connected to a new stranger.\n" +
      "Commands: .anonchat stop | .anonchat next";
    if (sock?.sendMessage) {
      await sock.sendMessage(peer, { text: intro }).catch(() => {});
    }
    return reply(intro);
  }

  return reply("Skipped. Waiting for a new match…");
}

async function status({ sender, reply, db }) {
  await ensureLoaded(db);
  if (partner.has(sender)) {
    return reply("Status: in an anonymous chat. .anonchat stop to leave.");
  }
  if (waiting.has(sender)) {
    return reply("Status: waiting for a match…");
  }
  return reply("Status: idle. Send .anonchat start to find a stranger.");
}

module.exports = {
  relayIfPaired,
  joinQueue,
  stopSession,
  nextPartner,
  status,
  ensureLoaded,
  getOptions,
};
