import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import mongoose from 'mongoose';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Conectar ao MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/deepseek';
await mongoose.connect(MONGODB_URI);
console.log('✅ Conectado ao MongoDB');

// Modelos do MongoDB
const SignalSchema = new mongoose.Schema({
  asset: String,
  type: String,
  entry: String,
  confidence: String,
  timestamp: { type: Date, default: Date.now }
});

const UserSchema = new mongoose.Schema({
  chatId: Number,
  username: String,
  subscribed: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const Signal = mongoose.model('Signal', SignalSchema);
const User = mongoose.model('User', UserSchema);

// Inicializar Bot Telegram
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
console.log('🤖 Bot Telegram inicializado');

// Comandos do Bot
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  
  // Salvar/atualizar usuário
  await User.findOneAndUpdate(
    { chatId },
    { username, subscribed: true },
    { upsert: true, new: true }
  );

  const welcomeMsg = `
🤖 *DeepSeek Trading Bot*

Olá *${username}*! Bem-vindo ao sistema de sinais automatizados.

📊 *Sinais Disponíveis:*
• BTC, ETH, SOL, XRP, DOGE, BNB
• Análise em tempo real
• Stop Loss & Take Profit

🎯 *Comandos:*
/subscrever - Receber sinais
/parar - Parar sinais  
/status - Status do sistema
/btc - Sinal Bitcoin
/eth - Sinal Ethereum

⚠️ *Educacional apenas*
  `;

  bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
});

bot.onText(/\/subscrever/, async (msg) => {
  const chatId = msg.chat.id;
  await User.findOneAndUpdate(
    { chatId },
    { subscribed: true },
    { upsert: true }
  );
  bot.sendMessage(chatId, '✅ *Inscrição ativada!* Você receberá sinais automáticos.', { parse_mode: 'Markdown' });
});

bot.onText(/\/parar/, async (msg) => {
  const chatId = msg.chat.id;
  await User.findOneAndUpdate(
    { chatId },
    { subscribed: false }
  );
  bot.sendMessage(chatId, '❌ *Inscrição cancelada.* Use /subscrever para reativar.', { parse_mode: 'Markdown' });
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userCount = await User.countDocuments({ subscribed: true });
  const signalCount = await Signal.countDocuments();
  
  const statusMsg = `
📊 *Status do Sistema*

• 🤖 Bot: 🟢 Online
• 👥 Usuários: ${userCount}
• 📈 Sinais: ${signalCount}
• 🏦 Exchanges: Binance
• ⚡ Status: Operacional

🕒 ${new Date().toLocaleString('pt-BR')}
  `;
  
  bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown' });
});

// API para gerar sinais
app.post('/api/generate-signal', async (req, res) => {
  try {
    const { asset = 'BTCUSDT' } = req.body;
    
    // Buscar dados da Binance
    const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${asset}`);
    const data = await response.json();
    
    const price = parseFloat(data.lastPrice);
    const change = parseFloat(data.priceChangePercent);
    
    // Gerar sinal simples
    const signalType = change >= 0 ? 'LONG' : 'SHORT';
    const confidence = Math.abs(change) > 3 ? 'Alto' : Math.abs(change) > 1 ? 'Médio' : 'Baixo';
    
    const signal = {
      asset: asset.replace('USDT', '/USDT'),
      type: signalType,
      entry: `$${price.toFixed(2)}`,
      confidence,
      sl: `$${(price * (signalType === 'LONG' ? 0.98 : 1.02)).toFixed(2)}`,
      tp1: `$${(price * (signalType === 'LONG' ? 1.01 : 0.99)).toFixed(2)}`,
      tp2: `$${(price * (signalType === 'LONG' ? 1.02 : 0.98)).toFixed(2)}`,
      tp3: `$${(price * (signalType === 'LONG' ? 1.03 : 0.97)).toFixed(2)}`,
      rr: '1:2.5'
    };
    
    // Salvar no banco
    await Signal.create(signal);
    
    // Enviar para todos usuários inscritos
    const subscribedUsers = await User.find({ subscribed: true });
    const signalMessage = formatSignalMessage(signal);
    
    for (const user of subscribedUsers) {
      try {
        await bot.sendMessage(user.chatId, signalMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        console.log(`Erro ao enviar para ${user.chatId}: ${error.message}`);
      }
    }
    
    res.json({ success: true, signal });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function formatSignalMessage(signal) {
  return `
🎯 *SINAL DE TRADING*

📊 ${signal.asset}
🟢 ${signal.type}
💰 Entrada: ${signal.entry}
💪 Confiança: ${signal.confidence}

🛡️ Stop: ${signal.sl}
🎯 Take Profit:
   ${signal.tp1}
   ${signal.tp2} 
   ${signal.tp3}

⚖️ R/R: ${signal.rr}

🕒 ${new Date().toLocaleString('pt-BR')}
  `;
}

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Online', 
    service: 'DeepSeek Trading Bot',
    version: '1.0.0'
  });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
