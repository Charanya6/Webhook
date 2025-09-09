// Dialogflow ES Webhook (Render/Glitch-ready) — Full ordering flow
// - In-memory menu & cart (per Dialogflow session)
// - Intents handled: Default Welcome, GetStoreHours, CheckOrderStatus,
//   AddToCart, ShowCart, RemoveFromCart, ClearCart, Checkout, Default Fallback

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

// Format as INR (₹). Fallback if Intl not fully supported on host.
function formatINR(n) {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
  } catch {
    return `₹${Number(n).toFixed(2)}`;
  }
}

/* --------------------- In-memory data stores -------------------- */
// NOTE: For demo. If you restart the server, this resets.
// Swap to MySQL later by replacing these with DB calls.

const carts = new Map(); // sessionId -> { items:[{item, qty, price}], subtotal }
const menu = {
  'pizza':       { name: 'Margherita Pizza', price: 10.99 },
  'ramen':       { name: 'Spicy Ramen',      price: 12.50 },
  'veggie bowl': { name: 'Veggie Power Bowl',price:  9.75 }
};

function getCart(sessionId) {
  if (!carts.has(sessionId)) carts.set(sessionId, { items: [], subtotal: 0 });
  return carts.get(sessionId);
}

function recalc(cart) {
  cart.subtotal = cart.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  return cart.subtotal;
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
  // Expecting Dialogflow params like:
  // - params.item (custom @menu_item entity)
  // - params.qty  (@sys.number, optional)
  const rawItem = (params.item ?? '').toString().toLowerCase().trim();
  const qty = Number(params.qty ?? 1);

  if (!rawItem) return dfText("Which item would you like to add? Try pizza, ramen, or veggie bowl.");
  if (!menu[rawItem]) return dfText(`I don’t have "${params.item}". Try pizza, ramen, or veggie bowl.`);
  if (!(qty >= 1)) return dfText("Quantity must be at least 1.");

  const cart = getCart(sessionId);
  const existing = cart.items.find(i => i.item === rawItem);
  if (existing) existing.qty += qty;
  else cart.items.push({ item: rawItem, qty, price: menu[rawItem].price });

  const subtotal = recalc(cart);
  const line = `${menu[rawItem].name} × ${qty} added. Subtotal: ${formatINR(subtotal)}.`;
  return dfText(line);
}

async function ShowCart(req) {
  const sessionId = sessionIdFromReq(req);
  const cart = getCart(sessionId);
  if (!cart.items.length) return dfText("Your cart is empty. Try: add a pizza.");

  const lines = cart.items.map(i => `• ${menu[i.item].name} × ${i.qty} = ${formatINR(i.qty * i.price)}`);
  const subtotal = recalc(cart);
  const resp = `Your cart:\n${lines.join('\n')}\nSubtotal: ${formatINR(subtotal)}`;
  return dfText(resp);
}

async function RemoveFromCart(req) {
  const sessionId = sessionIdFromReq(req);
  const params = req.body?.queryResult?.parameters || {};
  const rawItem = (params.item ?? '').toString().toLowerCase().trim();
  const qty = Number(params.qty ?? 0); // 0 or missing => remove all of that item

  if (!rawItem) return dfText("Which item should I remove?");
  const cart = getCart(sessionId);
  const idx = cart.items.findIndex(i => i.item === rawItem);
  if (idx < 0) return dfText(`"${params.item}" isn’t in your cart.`);

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
  const taxRate = 0.05; // e.g., 5% GST
  const tax = +(subtotal * taxRate).toFixed(2);
  const grand = +(subtotal + tax).toFixed(2);

  // In a real app you would:
  // 1) Create an order record in DB
  // 2) Generate an order id
  // 3) Clear the cart after saving
  carts.set(sessionId, { items: [], subtotal: 0 });

  return dfText(`Order placed ✅ Subtotal ${formatINR(subtotal)}, Tax ${formatINR(tax)}, Total ${formatINR(grand)}.`);
}

/* -------------------------- Intent Router -------------------------- */

// Map Dialogflow intent displayName -> handler
const handlers = {
  'Default Welcome Intent': DefaultWelcomeIntent,
  'GetStoreHours': GetStoreHours,
  'CheckOrderStatus': CheckOrderStatus,

  'AddToCart': AddToCart,
  'ShowCart': ShowCart,
  'RemoveFromCart': RemoveFromCart,
  'ClearCart': ClearCart,
  'Checkout': Checkout,

  'Default Fallback Intent': (_req) => dfText("Sorry, I didn’t get that. Try: add a pizza, show my cart, or checkout.")
};

// Optional aliases if your intent names differ in Dialogflow console:
handlers['Add to cart']         = handlers['AddToCart'];
handlers['Show cart']           = handlers['ShowCart'];
handlers['Remove from cart']    = handlers['RemoveFromCart'];
handlers['Clear cart']          = handlers['ClearCart'];
handlers['Store Hours']         = handlers['GetStoreHours'];
handlers['Order Status']        = handlers['CheckOrderStatus'];

/* --------------------------- HTTP Routes --------------------------- */

// Async route so handlers can be async (DB-friendly)
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
