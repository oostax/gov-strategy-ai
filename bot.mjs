/**
 * Telegram Mini App Bot
 *
 * Запуск: node bot.mjs
 *
 * Перед запуском:
 * 1. Получите токен бота у @BotFather в Telegram
 * 2. Установите переменную BOT_TOKEN
 * 3. На серверах с блокировкой Telegram — SOCKS_PROXY (socks5h://user:pass@host:port)
 * 4. В @BotFather настройте Mini App:
 *    /mybots → ваш бот → Bot Settings → Menu Button → Configure menu button
 *    URL: https://drgsapp.online
 */

import { fetch, ProxyAgent } from "undici";

const BOT_TOKEN = process.env.BOT_TOKEN || "YOUR_BOT_TOKEN_HERE";
const WEB_APP_URL = process.env.WEB_APP_URL || "https://drgsapp.online";

// socks5:// — undici ProxyAgent (не socks5h)
const SOCKS_PROXY = process.env.SOCKS_PROXY;
const dispatcher = SOCKS_PROXY ? new ProxyAgent(SOCKS_PROXY) : undefined;

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tgFetch(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.headers,
    body: options.body,
    dispatcher,
  });
  return {
    ok: response.ok,
    json: () => response.json(),
  };
}

async function sendMessage(chatId, text, options = {}) {
  const body = { chat_id: chatId, text, parse_mode: "HTML", ...options };
  const response = await tgFetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const text = message.text;

  if (text === "/start") {
    await sendMessage(
      chatId,
      `<b>🏛 ИИ-штаб госсектора</b>\n\n` +
        `Стратегический ИИ-ассистент для руководителя департамента по работе с госсектором.\n\n` +
        `<b>Что умеет:</b>\n` +
        `• Подготовка к встречам с ЛПР\n` +
        `• Позиции для ВП и правления\n` +
        `• Стратегия Сбера по регионам\n` +
        `• Сценарный анализ\n\n` +
        `Нажмите кнопку ниже, чтобы открыть приложение 👇`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: "🚀 Открыть ИИ-штаб", web_app: { url: WEB_APP_URL } }]],
        },
      }
    );
    return;
  }

  await sendMessage(chatId, `Используйте кнопку ниже для работы с ИИ-штабом:`, {
    reply_markup: {
      inline_keyboard: [[{ text: "🚀 Открыть ИИ-штаб", web_app: { url: WEB_APP_URL } }]],
    },
  });
}

async function poll(offset = 0) {
  try {
    const response = await tgFetch(`${API}/getUpdates?offset=${offset}&timeout=30`);
    const data = await response.json();

    if (!data.ok) {
      console.error("Telegram API error:", data.description);
      await new Promise((r) => setTimeout(r, 5000));
      return poll(offset);
    }

    for (const update of data.result || []) {
      await handleUpdate(update);
      offset = update.update_id + 1;
    }
  } catch (error) {
    console.error("Poll error:", error.message);
    await new Promise((r) => setTimeout(r, 3000));
  }

  return poll(offset);
}

console.log("🤖 Telegram bot starting...");
console.log(`📱 Web App URL: ${WEB_APP_URL}`);
console.log(`🔑 Bot token: ${BOT_TOKEN.slice(0, 10)}...`);
if (SOCKS_PROXY) {
  const masked = SOCKS_PROXY.replace(/:([^:@/]+)@/, ":***@");
  console.log(`🔒 SOCKS proxy: ${masked}`);
} else {
  console.log("⚠️  SOCKS_PROXY не задан — прямое подключение к Telegram API");
}
console.log("");
console.log("Для настройки Mini App в @BotFather:");
console.log("1. /mybots → ваш бот → Bot Settings → Menu Button");
console.log(`2. URL: ${WEB_APP_URL}`);
console.log("");

if (BOT_TOKEN === "YOUR_BOT_TOKEN_HERE") {
  console.error("❌ Установите BOT_TOKEN! Получите его у @BotFather в Telegram.");
  console.log("   Запуск: BOT_TOKEN=123456:ABC-DEF node bot.mjs");
  process.exit(1);
}

poll();
