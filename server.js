// Glitch-ready Dialogflow ES webhook
const express = require('express');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

function dfText(text) {
  return { fulfillmentMessages: [{ text: { text: [String(text)] } }] };
}

const handlers = {
  'Default Welcome Intent': () => dfText(process.env.WELCOME_MESSAGE || "Hello! How can I help?"),
  'GetStoreHours': () => dfText(process.env.STORE_HOURS || "We are open Mon-Sat, 9 AM to 7 PM."),
  'CheckOrderStatus': (req) => {
    const orderId = req.body?.queryResult?.parameters?.order_id || "N/A";
    return dfText(`Order ${orderId}: packed and ready to ship 🚚`);
  },
  'Default Fallback Intent': () => dfText("Sorry, I didn’t get that. Can you rephrase?")
};

app.post('/webhook', (req, res) => {
  const intent = req.body?.queryResult?.intent?.displayName;
  const handler = handlers[intent] || (() => dfText("No handler for this intent."));
  res.json(handler(req));
});

app.get('/', (_req, res) => res.send("Dialogflow Webhook is running on Glitch"));

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
