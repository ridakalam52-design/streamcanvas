import WebSocket from "ws";
/** Subscribe to Twitch raid and follow events over EventSub WebSocket. */
export class EventSub {
  constructor({
    clientId,
    clientSecret,
    userToken,
    onEvent = () => {},
    onStatus = () => {},
  }) {
    Object.assign(this, {
      clientId,
      clientSecret,
      userToken,
      onEvent,
      onStatus,
    });
    this.socket = null;
    this.sessionId = null;
    this.reconnect = true;
  }
  /** Start EventSub only when all configured credentials are available. */
  async connect() {
    if (!this.clientId || !this.clientSecret || !this.userToken) return;
    this.socket = new WebSocket("wss://eventsub.wss.twitch.tv/ws");
    this.socket.on("message", async (d) => {
      try {
        await this.message(JSON.parse(String(d)));
      } catch {}
    });
    this.socket.on("close", () => {
      if (this.reconnect) setTimeout(() => this.connect(), 3000);
    });
    this.socket.on("error", () => {});
  }
  /** Process welcome, notification, and reconnect messages from Twitch. */
  async message(data) {
    const m = data.metadata ?? {},
      p = data.payload ?? {};
    if (m.message_type === "session_welcome") {
      this.sessionId = p.session.id;
      this.onStatus("connected");
      await this.subscribe("channel.follow", {
        broadcaster_user_id: process.env.TWITCH_BROADCASTER_ID,
        moderator_user_id: process.env.TWITCH_BROADCASTER_ID,
      });
      await this.subscribe("channel.raid", {
        to_broadcaster_user_id: process.env.TWITCH_BROADCASTER_ID,
      });
    } else if (m.message_type === "notification") {
      this.onEvent({ type: m.subscription_type, event: p.event });
    } else if (m.message_type === "session_reconnect") {
      this.socket?.close();
      const old = this.socket;
      this.socket = new WebSocket(p.session.reconnect_url);
      this.socket.on("message", (d) => this.message(JSON.parse(String(d))));
      old?.close();
    }
  }
  /** Register an EventSub subscription for the current WebSocket session. */
  async subscribe(type, condition) {
    if (!this.sessionId || Object.values(condition).some((v) => !v)) return;
    const token = this.userToken.replace(/^oauth:/, "");
    await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: {
        "Client-ID": this.clientId,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type,
        version: "2",
        condition,
        transport: { method: "websocket", session_id: this.sessionId },
      }),
    }).catch(() => {});
  }
  /** Stop reconnecting and close the current EventSub session. */
  close() {
    this.reconnect = false;
    this.socket?.close();
  }
}
