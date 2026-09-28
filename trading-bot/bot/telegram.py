"""Telegram bot: trade alerts on your phone, plus /status, /pause and /resume.

Create the bot with @BotFather (/newbot), set TELEGRAM_BOT_TOKEN, message the bot once to learn
your chat id, then set TELEGRAM_CHAT_ID. Only that chat can use the commands. The bot runs on the
server, so nothing has to stay switched on at home.
"""
import json
import logging
import threading
import urllib.error
import urllib.request

log = logging.getLogger("trading-bot")
API_URL = "https://api.telegram.org/bot{token}/{method}"
POLL_TIMEOUT_S = 30

HELP = ("/status - equity, trades today, last chart check\n"
        "/pause - stop new buys (sells still allowed)\n"
        "/resume - allow buys again")


def format_status(s):
    mode = "LIVE" if s["live_trading"] and s["broker"] != "paper" else "paper"
    lines = [f"Broker: {s['broker']} ({mode})",
             f"Equity: {s['equity']:,.2f}",
             f"Trades today: {s['trades_today']}"]
    if s.get("paused"):
        lines.append("PAUSED: no new buys (/resume to allow)")
    if s.get("halted"):
        lines.append(f"Halted: {s['halted']}")
    auto = s.get("auto_trader")
    if auto and auto.get("error"):
        lines.append(f"Last check {auto['checked_at']}: error: {auto['error']}")
    elif auto:
        lines.append(f"Last check {auto['checked_at']}: {auto['symbol']} closed {auto['close']:,.2f} "
                     f"on {auto['candle']}, 200 SMA {auto['sma']}, "
                     f"{'holding' if auto['holding'] else 'flat'}, signal: {auto['signal'] or 'none'}")
    return "\n".join(lines)


class TelegramBot:
    def __init__(self, token, chat_id, engine, opener=urllib.request.urlopen):
        self.token = token
        self.chat_id = str(chat_id).strip()
        self.engine = engine
        self._open = opener
        self._offset = None
        self._stop = threading.Event()

    def _call(self, method, params, http_timeout=15):
        req = urllib.request.Request(API_URL.format(token=self.token, method=method),
                                     data=json.dumps(params).encode(),
                                     headers={"Content-Type": "application/json"})
        with self._open(req, timeout=http_timeout) as resp:
            body = json.loads(resp.read())
        if not body.get("ok"):
            raise RuntimeError(body.get("description", "Telegram error"))
        return body["result"]

    def send(self, text, chat_id=None):
        chat_id = chat_id or self.chat_id
        if not chat_id:
            return
        try:
            self._call("sendMessage", {"chat_id": chat_id, "text": text})
        except (urllib.error.URLError, RuntimeError, ValueError) as e:
            # Never let a Telegram outage affect trading. Don't log the error text: it can contain the token.
            log.error("telegram send failed (%s)", type(e).__name__)

    def notify(self, text):
        """Send without blocking the caller (the engine calls this while holding its lock)."""
        threading.Thread(target=self.send, args=(text,), daemon=True).start()

    def handle(self, update):
        """Return the reply for one incoming update, or None to ignore it."""
        msg = update.get("message") or {}
        chat = str((msg.get("chat") or {}).get("id", ""))
        text = (msg.get("text") or "").strip()
        if not chat or not text:
            return None
        if not self.chat_id:
            return (f"Your chat id is {chat}. Set TELEGRAM_CHAT_ID={chat} in the bot's environment "
                    "to enable commands.")
        if chat != self.chat_id:
            log.warning("telegram: ignored message from unknown chat %s", chat)
            return None
        command = text.split()[0].split("@")[0].lower()
        if command == "/status":
            return format_status(self.engine.status())
        if command == "/pause":
            self.engine.paused = True
            return "Paused: no new buys. Sells still go through. /resume to undo."
        if command == "/resume":
            self.engine.paused = False
            return "Resumed: buys allowed again."
        return HELP

    def poll_once(self):
        params = {"timeout": POLL_TIMEOUT_S, "allowed_updates": ["message"]}
        if self._offset is not None:
            params["offset"] = self._offset
        for update in self._call("getUpdates", params, http_timeout=POLL_TIMEOUT_S + 10):
            self._offset = update["update_id"] + 1
            reply = self.handle(update)
            if reply:
                self.send(reply, chat_id=update["message"]["chat"]["id"])

    def run(self):
        log.info("telegram bot on%s", "" if self.chat_id else " (TELEGRAM_CHAT_ID not set: replies with your chat id)")
        while not self._stop.is_set():
            try:
                self.poll_once()
            except Exception as e:  # network blips: wait a little and poll again
                log.error("telegram poll failed (%s)", type(e).__name__)
                self._stop.wait(10)

    def start(self):
        threading.Thread(target=self.run, daemon=True, name="telegram").start()

    def stop(self):
        self._stop.set()
