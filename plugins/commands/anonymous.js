const crypto = require("crypto");

const SESSION_TIMEOUT = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 1500;
const TRIGGERS = ["anonymous", "anon", "feedback", "report"];
const CATEGORIES = {
  "1": "General feedback",
  "2": "Workplace concern",
  "3": "Safety issue",
  "4": "Payroll or HR",
  "5": "Other",
};

function getSessions() {
  global.GoatBot.anonymousSessions = global.GoatBot.anonymousSessions || new Map();
  return global.GoatBot.anonymousSessions;
}

function getSessionKey({ event, message }) {
  const threadID = event?.threadID || message?.threadID || message?.key?.remoteJid;
  const senderID =
    event?.senderID ||
    message?.senderID ||
    message?.key?.participant ||
    message?.key?.remoteJid;

  if (!threadID || !senderID) {
    return null;
  }

  return `${threadID}:${senderID}`;
}

function getIds({ event, message }) {
  const threadID = event?.threadID || message?.threadID || message?.key?.remoteJid || null;
  const senderID =
    event?.senderID ||
    message?.senderID ||
    message?.key?.participant ||
    message?.key?.remoteJid ||
    null;
  const isGroup =
    event?.isGroup ||
    message?.isGroup ||
    threadID?.endsWith("@g.us") ||
    false;

  return { threadID, senderID, isGroup };
}

async function sendToChat({ sock, event, message, text, reply }) {
  if (typeof reply === "function") {
    return reply(text);
  }

  const { threadID, senderID } = getIds({ event, message });
  const targetId = threadID || senderID;
  if (targetId && sock?.sendMessage) {
    return sock.sendMessage(targetId, { text });
  }

  return null;
}

function isExpired(session) {
  return !session || Date.now() - session.updatedAt > SESSION_TIMEOUT;
}

function menuText(prefix = ".") {
  return (
    "Anonymous message menu\n\n" +
    "Reply with a number:\n" +
    "1. General feedback\n" +
    "2. Workplace concern\n" +
    "3. Safety issue\n" +
    "4. Payroll or HR\n" +
    "5. Other\n\n" +
    `You can also send ${prefix}anonymous <message> for a quick anonymous message.\n` +
    "Type cancel to stop."
  );
}

async function sendAnonymousMessage({ text, category, config, sock, logger, reply }) {
  const admins = Array.isArray(config.admins) ? config.admins.filter(Boolean) : [];

  if (!text) {
    return reply("Please write the message you want to send anonymously.");
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    return reply(`Please keep anonymous messages under ${MAX_MESSAGE_LENGTH} characters.`);
  }

  if (admins.length === 0) {
    return reply("Anonymous messages are not configured yet because no admins are set.");
  }

  const reportId = crypto.randomBytes(4).toString("hex").toUpperCase();
  const sentAt = new Date().toLocaleString();
  const adminMessage =
    `Anonymous message #${reportId}\n\n` +
    `Category: ${category || "General feedback"}\n\n` +
    `${text}\n\n` +
    `Received: ${sentAt}\n` +
    "Sender identity was intentionally hidden by the bot.";

  const results = await Promise.allSettled(
    admins.map((adminId) => sock.sendMessage(adminId, { text: adminMessage }))
  );
  const delivered = results.filter((result) => result.status === "fulfilled").length;

  if (delivered === 0) {
    logger.warn(`Anonymous message #${reportId} could not be delivered to any admin`);
    return reply("I could not deliver your anonymous message. Please try again later.");
  }

  logger.info(`Anonymous message #${reportId} delivered to ${delivered}/${admins.length} admin(s)`);
  return reply(`Your anonymous message was sent. Reference: #${reportId}`);
}

module.exports = {
  config: {
    name: "anonymous",
    aliases: ["anon", "feedback", "report"],
    version: "1.1.0",
    author: "@anbuinfosec",
    countDown: 5,
    role: 0,
    description: "Menu-driven anonymous messages to the bot admins",
    category: "utility",
    guide: "{pn}anonymous - Open anonymous menu\n{pn}anonymous <message> - Send quick anonymous message",
  },

  onCmd: async ({ args, reply, config, sock, logger, event, message, utils }) => {
    const text = args.join(" ").trim();

    if (text) {
      return sendAnonymousMessage({
        text,
        category: "Quick message",
        config,
        sock,
        logger,
        reply,
      });
    }

    const sessions = getSessions();
    const sessionKey = getSessionKey({ event, message });
    if (!sessionKey) {
      return reply("I could not start anonymous mode for this chat. Please try again.");
    }

    sessions.set(sessionKey, {
      step: "category",
      updatedAt: Date.now(),
    });

    return sendToChat({ sock, event, message, text: menuText(utils.getPrefix()), reply });
  },

  onChat: async ({ body, reply, config, sock, logger, event, message, utils }) => {
    const text = body.trim();
    const normalized = text.toLowerCase();
    const sessions = getSessions();
    const sessionKey = getSessionKey({ event, message });
    if (!sessionKey) return;
    const session = sessions.get(sessionKey);

    if (TRIGGERS.includes(normalized)) {
      sessions.set(sessionKey, {
        step: "category",
        updatedAt: Date.now(),
      });
      logger.info("Anonymous menu opened");
      return sendToChat({ sock, event, message, text: menuText(utils.getPrefix()), reply });
    }

    if (!session) return;

    if (isExpired(session)) {
      sessions.delete(sessionKey);
      return sendToChat({
        sock,
        event,
        message,
        text: "Anonymous message session expired. Send anonymous to start again.",
        reply,
      });
    }

    if (normalized === "cancel" || normalized === "stop") {
      sessions.delete(sessionKey);
      return sendToChat({ sock, event, message, text: "Anonymous message cancelled.", reply });
    }

    if (session.step === "category") {
      const category = CATEGORIES[text];
      if (!category) {
        return sendToChat({
          sock,
          event,
          message,
          text: "Please reply with 1, 2, 3, 4, or 5. Type cancel to stop.",
          reply,
        });
      }

      sessions.set(sessionKey, {
        step: "message",
        category,
        updatedAt: Date.now(),
      });

      return sendToChat({
        sock,
        event,
        message,
        text: `Category selected: ${category}\n\nNow send the anonymous message you want delivered.`,
        reply,
      });
    }

    if (session.step === "message") {
      sessions.delete(sessionKey);
      return sendAnonymousMessage({
        text,
        category: session.category,
        config,
        sock,
        logger,
        reply,
      });
    }
  },
};
