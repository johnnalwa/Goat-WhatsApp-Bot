const anonchat = require("../../libs/anonchat");

module.exports = {
  config: {
    name: "anonchat",
    aliases: ["stranger", "relaychat", "randomchat"],
    version: "1.0.0",
    author: "GoatBot",
    countDown: 2,
    role: 0,
    description: "Anonymous 1:1 chat via bot relay (numbers hidden)",
    category: "utility",
    guide: [
      "{pn}anonchat start — join queue / find a stranger",
      "{pn}anonchat stop — leave chat",
      "{pn}anonchat next — skip partner and rematch",
      "{pn}anonchat status — am I paired or waiting?",
    ],
  },

  onCmd: async ({ args, reply, sock, config, db, logger, event }) => {
    if (event?.isGroup) {
      return reply("Anonymous relay only works in a private chat with the bot, not in groups.");
    }
    const sender = event?.senderID;
    if (!sender) return reply("Could not detect your account. Try again.");

    const sub = (args[0] || "start").toLowerCase();

    switch (sub) {
      case "start":
      case "join":
      case "match":
        return anonchat.joinQueue({ sock, sender, reply, config, db, logger });
      case "stop":
      case "leave":
      case "end":
        return anonchat.stopSession({ sock, sender, reply, db, logger });
      case "next":
      case "skip":
        return anonchat.nextPartner({ sock, sender, reply, config, db, logger });
      case "status":
        return anonchat.status({ sender, reply, db });
      default:
        return reply(
          `Usage:\n${config.prefix}anonchat start — find a stranger\n` +
            `${config.prefix}anonchat stop — leave\n` +
            `${config.prefix}anonchat next — new partner\n` +
            `${config.prefix}anonchat status`
        );
    }
  },
};
