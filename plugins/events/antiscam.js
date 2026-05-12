const SCAM_KEYWORDS = [
  "invest",
  "investment",
  "profit",
  "usdt",
  "trx",
  "mining",
  "cashback",
  "commission",
  "bonus",
  "deposit",
  "referral",
  "register",
  "registration",
  "daily",
  "earn",
  "kamaen",
  "dipozit",
  "kaishabaik",
  "kameeshan",
  "bonas",
  "maining",
  "rajistreshan",
];

const SUSPICIOUS_DOMAINS = [
  "cointerac.com",
  "cointerac.top",
  "t.me/",
  "chat.whatsapp.com/",
];

function getLinks(text) {
  return text.match(/https?:\/\/[^\s]+/gi) || [];
}

function scoreMessage(text) {
  const normalized = text.toLowerCase();
  const links = getLinks(text);
  const keywordHits = SCAM_KEYWORDS.filter((word) => normalized.includes(word)).length;
  const suspiciousDomainHits = SUSPICIOUS_DOMAINS.filter((domain) =>
    normalized.includes(domain)
  ).length;

  let score = 0;
  if (links.length >= 2) score += 3;
  if (links.length >= 4) score += 2;
  if (keywordHits >= 3) score += 3;
  if (keywordHits >= 6) score += 2;
  if (suspiciousDomainHits > 0) score += 3;
  if (normalized.includes("4%-12%") || normalized.includes("3000 usdt")) score += 2;

  return { score, links, keywordHits, suspiciousDomainHits };
}

module.exports = {
  config: {
    name: "antiscam",
    author: "Codex",
    version: "1.0.0",
    category: "events",
  },

  onChat: async ({ sock, message, body, role, logger }) => {
    try {
      if (!message?.isGroup || !body) return;

      const senderRole = await role.getRole();
      if (senderRole >= 1) return;

      const result = scoreMessage(body);
      if (result.score < 7) return;

      await sock.sendMessage(message.threadID, { delete: message.msg.key });
      await sock.sendMessage(message.threadID, {
        text:
          "Suspicious investment or referral spam was removed automatically.",
      });

      logger.warn(
        `Antiscam removed message in ${message.threadID}: score=${result.score}, links=${result.links.length}, keywords=${result.keywordHits}`
      );
    } catch (error) {
      logger.error("Antiscam event error:", error);
    }
  },
};
