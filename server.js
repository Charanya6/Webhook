// Dialogflow ES Webhook (Render-ready) — Ordering flow using menu_items + number params
// Intents: Default Welcome, GetStoreHours, CheckOrderStatus,
//          AddToCart, ShowCart, RemoveFromCart, ClearCart, Checkout, Default Fallback

const express = require('express');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* --------------------------- Helpers --------------------------- */

function dfText(text) {
  return { fulfillmentMessages: [{ text: { text: [String(text)] } }] };
}

// Extract Dialogflow ES session id from request body
// Example: "projects/.../agent/sessions/<SESSION_ID>"
function sessionIdFromReq(req) {
  const s = req.body?.session || '';
  const parts = s.split('/sessions/');
  return parts[1] || 'anon';
}

// INR formatting
function formatINR(n) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
  } catch {
    return `₹${Number(n).toFixed(2)}`;
  }
}

/* --------------------- In-memory data stores -------------------- */
// Demo only. Replace with DB later if needed.

const carts = new Map(); // sessionId -> { items:[{item, qty, price}], subtotal }
const menu = {
  'pizza':       { name: 'Margherita Pizza',  price: 10.99 },
  'ramen':       { name: 'Spicy Ramen',       price: 12.50 },
  'veggie bowl': { name: 'Veggie Power Bowl', price:  9.75 }
};

function getCart(sessionId) {
  if (!carts.has(sessionId)) carts.set(sessionId, { items: [], subtotal: 0 });
  return carts.get(sessionId);
}

function recalc(cart) {
  cart.subtotal = cart.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  return cart.subtotal;
}

// Robust parameter getters that prefer your names
function getItemParam(params) {
  return (
    params.menu_items ??     // your preferred name
    params['menu_items'] ??
    params['menu item'] ??
    params.item ??
    ''
  ).toString().toLowerCase().trim();
}

function getQtyParam(params, fallback = 1) {
  const raw =
    params.number ??         // your preferred name
    params['number'] ??
    params.qty ??
    fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/* --------------------------- Handlers --------------------------- */

function DefaultWelcomeIntent(_req) {
  const msg = process.env.WELCOME_MESSAGE
    || "Hi! I can add items to your cart, show totals, and place your order. Try: 'add a pizza' or 'show my cart'.";
  return dfText(msg);
}

function GetStoreHours(_req) {
  const hours = process.env.STORE_HOURS || "We are open Mon–Sat, 9 AM to 7 PM.";
  return dfText(hours);
}

function CheckOrderStatus(req) {
  const id = req.body?.queryResult?.parameters?.order_id ?? 'N/A';
  return dfText(`Order ${id}: packed and ready to ship 🚚`);
}

/* ---------- Ordering flow (Add / Show / Remove / Clear / Checkout) ---------- */

async function AddToCart(req) {
  const sessionId = sessionIdFromReq(req);
  const params = req.body?.queryResult?.parameters || {};

  const rawItem = getItemParam(params);
  const qty = getQtyParam(params, 1);

  if (!rawItem) return dfText("Which item would you like to add? Try pizza, ramen, or veggie bowl.");
  if (!menu[rawItem]) return dfText(`I don’t have "${rawItem}". Try pizza, ramen, or veggie bowl.`);

  const cart = getCart(sessionId);
  const existing = cart.items.find(i => i.item === rawItem);
  if (existing) existing.qty += qty;
  else cart.items.push({ item: rawItem, qty, price: menu[rawItem].price });

  const subtotal = recalc(cart);
  return dfText(`${menu[rawItem].name} × ${qty} added. Subtotal: ${formatINR(subtotal)}.`);
}

async function ShowCart(req) {
  const sessionId = sessionIdFromReq(req);
  const cart = getCart(sessionId);
  if (!cart.items.length) return dfText("Your cart is empty. Try: add a pizza.");

  const lines = cart.items.map(i => `• ${menu[i.item].name} × ${i.qty} = ${formatINR(i.qty * i.price)}`);
  const subtotal = recalc(cart);
  return dfText(`Your cart:\n${lines.join('\n')}\nSubtotal: ${formatINR(subtotal)}`);
}

async function RemoveFromCart(req) {
  const sessionId = sessionIdFromReq(req);
  const params = req.body?.queryResult?.parameters || {};

  const rawItem = getItemParam(params);
  // qty: if provided, remove that many; if missing/0, remove all of that item
  const qty = Number(params.number ?? params.qty ?? 0);

  if (!rawItem) return dfText("Which item should I remove?");
  const cart = getCart(sessionId);
  const idx = cart.items.findIndex(i => i.item === rawItem);
  if (idx < 0) return dfText(`"${rawItem}" isn’t in your cart.`);

  if (qty > 0) {
    cart.items[idx].qty -= qty;
    if (cart.items[idx].qty <= 0) cart.items.splice(idx, 1);
  } else {
    cart.items.splice(idx, 1);
  }

  const subtotal = recalc(cart);
  return dfText(`Updated. Subtotal: ${formatINR(subtotal)}.`);
}

async function ClearCart(req) {
  const sessionId = sessionIdFromReq(req);
  carts.set(sessionId, { items: [], subtotal: 0 });
  return dfText("Cart cleared.");
}

async function Checkout(req) {
  const sessionId = sessionIdFromReq(req);
  const cart = getCart(sessionId);
  if (!cart.items.length) return dfText("Your cart is empty.");

  const subtotal = recalc(cart);
  const taxRate = 0.05; // Example 5% GST
  const tax = +(subtotal * taxRate).toFixed(2);
  const grand = +(subtotal + tax).toFixed(2);

  // (Real app: create order record, generate order id, etc.)
  carts.set(sessionId, { items: [], subtotal: 0 });

  return dfText(`Order placed ✅ Subtotal ${formatINR(subtotal)}, Tax ${formatINR(tax)}, Total ${formatINR(grand)}.`);
}

/* -------------------------- Intent Router -------------------------- */

const handlers = {
  'Default Welcome Intent': DefaultWelcomeIntent,
  'GetStoreHours': GetStoreHours,
  'CheckOrderStatus': CheckOrderStatus,

  'AddToCart': AddToCart,
  'ShowCart': ShowCart,
  'RemoveFromCart': RemoveFromCart,
  'ClearCart': ClearCart,
  'Checkout': Checkout,

  'Default Fallback Intent': (_req) =>
    dfText("Sorry, I didn’t get that. Try: add a pizza, show my cart, or checkout.")
};

// Aliases for alternate intent names (keep or add more as needed)
handlers['Add to cart']       = handlers['AddToCart'];
handlers['Add Item']          = handlers['AddToCart'];
handlers['Show cart']         = handlers['ShowCart'];
handlers['Cart total']        = handlers['ShowCart'];
handlers['Remove from cart']  = handlers['RemoveFromCart'];
handlers['Clear cart']        = handlers['ClearCart'];
handlers['Store Hours']       = handlers['GetStoreHours'];
handlers['Order Status']      = handlers['CheckOrderStatus'];

/* --------------------------- HTTP Routes --------------------------- */

app.post('/webhook', async (req, res) => {
  try {
    const intent = req.body?.queryResult?.intent?.displayName;
    const handler = handlers[intent] || (() => dfText(`No handler for intent: ${intent}`));
    const response = await handler(req);
    res.json(response);
  } catch (err) {
    console.error('Webhook error:', err);
    res.json(dfText('An error occurred in the webhook.'));
  }
});

app.get('/', (_req, res) => res.send('Dialogflow ES Webhook is running.'));

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
