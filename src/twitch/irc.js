import WebSocket from "ws";
/** Connect to a channel using Twitch's IRC-over-WebSocket endpoint. */
export class TwitchIRC {
  constructor({
    channel,
    token,
    username,
    onMessage = () => {},
    onStatus = () => {},
  }) {
    Object.assign(this, {
      channel: channel?.replace(/^#/, "").toLowerCase(),
      token,
      username,
      onMessage,
      onStatus,
    });
    this.ws = null;
    this.reconnect = true;
  }
  /** Open the socket, authenticate anonymously or as the optional bot, and join. */
  connect() {
    if (!this.channel) return;
    this.ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    this.ws.on("open", () => {
      this.onStatus("connected");
      this.ws.send(
        "CAP REQ :twitch.tv/tags twitch.tv/commands twitch.tv/membership",
      );
      this.ws.send(
        `PASS ${this.token ? `oauth:${this.token.replace(/^oauth:/, "")}` : "SCHMOOPIIE"}`,
      );
      this.ws.send(
        `NICK ${this.username || `justinfan${Math.floor(Math.random() * 99999)}`}`,
      );
      this.ws.send(`JOIN #${this.channel}`);
    });
    this.ws.on("message", (d) => this.handle(String(d)));
    this.ws.on("close", () => {
      this.onStatus("disconnected");
      if (this.reconnect) setTimeout(() => this.connect(), 3000);
    });
    this.ws.on("error", () => {});
  }
  /** Parse IRC frames and forward PRIVMSG text with decoded tags. */
  handle(raw) {
    for (const line of raw.split("\r\n").filter(Boolean)) {
      if (line.startsWith("PING")) {
        this.ws?.send("PONG :tmi.twitch.tv");
        continue;
      }
      const m = line.match(/^(?:@([^ ]+) )?:([^!]+)!.* PRIVMSG #[^ ]+ :(.*)$/);
      if (!m) continue;
      const tags = Object.fromEntries(
        (m[1] || "")
          .split(";")
          .filter(Boolean)
          .map((x) => {
            const [k, ...v] = x.split("=");
            return [k, v.join("=")];
          }),
      );
      const badges = Object.fromEntries(
        (tags.badges || "")
          .split(",")
          .filter(Boolean)
          .map((x) => x.split("/")),
      );
      this.onMessage({
        user: m[2],
        message: m[3],
        tags: {
          ...tags,
          badges,
          mod: tags.mod === "1",
          vip: !!badges.vip,
          broadcaster: !!badges.broadcaster,
          subscriber: tags.subscriber === "1",
          bits: Number(tags.bits) || 0,
        },
      });
    }
  }
  /** Send an optional bot reply when an authenticated connection is ready. */
  say(message) {
    if (this.token && this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(`PRIVMSG #${this.channel} :${message}`);
  }
  /** Stop reconnecting and close the socket during shutdown. */
  close() {
    this.reconnect = false;
    this.ws?.close();
  }
}
