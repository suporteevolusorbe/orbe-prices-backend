/**
 * 🔥 BACKEND DE PREÇOS - ULTRA RÁPIDO COM CACHE
 * 
 * Endpoint: GET /api/prices
 * Retorna todos os preços em cache (atualiza a cada 30s automaticamente)
 * 
 * Deploy: Node.js + Express
 * Porta: 10000 (ou variável PORT)
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 10000; // Render usa 10000 por padrão

// Middleware
app.use(helmet());
app.use(cors({ origin: '*' })); // Permitir todos os domínios
app.use(express.json());

// ============================================
// CACHE DE PREÇOS EM MEMÓRIA
// ============================================

let priceCache = {
  data: {},
  lastUpdate: null,
  isUpdating: false
};

const CACHE_DURATION = 30000; // 30 segundos
const STABLECOINS = ['USDT', 'USDC', 'BUSD', 'DAI'];
const STANDARD_TOKENS = ['BTC', 'ETH', 'BNB', 'SOL'];

// Mapeamento CoinGecko IDs
const COINGECKO_IDS = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'BNB': 'binancecoin',
  'SOL': 'solana'
};

// ============================================
// FETCH COINGECKO (BATCH)
// ============================================

async function fetchCoinGeckoPrices() {
  try {
    const ids = Object.values(COINGECKO_IDS).join(',');

    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000)
      }
    );

    if (!response.ok) {
      console.warn(`⚠️ CoinGecko returned ${response.status}`);
      return {};
    }

    const data = await response.json();

    const prices = {};
    for (const [symbol, id] of Object.entries(COINGECKO_IDS)) {
      if (data[id] && data[id].usd > 0) {
        prices[symbol] = {
          price: data[id].usd,
          change24h: data[id].usd_24h_change || 0,
          source: 'coingecko',
          updatedAt: Date.now()
        };
      }
    }

    console.log(`✅ CoinGecko: ${Object.keys(prices).length} tokens`);
    return prices;

  } catch (error) {
    console.error('❌ CoinGecko error:', error.message);
    return {};
  }
}

// ============================================
// FETCH ORBE (DEXSCREENER)
// ============================================

async function fetchOrbePrice() {
  try {
    const response = await fetch(
      'https://api.dexscreener.com/latest/dex/pairs/solana/dbEamNkWgS3N6JGRcL3T4VDJM2ooUnVzbrN2o1NP4YA',
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(4000)
      }
    );

    if (!response.ok) {
      console.warn(`⚠️ DexScreener returned ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.pair && data.pair.priceUsd) {
      const price = parseFloat(data.pair.priceUsd);
      const change24h = parseFloat(data.pair.priceChange?.h24 || 0);

      console.log(`✅ ORBE: $${price.toFixed(6)}`);

      return {
        ORBE: {
          price,
          change24h,
          source: 'dexscreener',
          updatedAt: Date.now()
        }
      };
    }

    return null;

  } catch (error) {
    console.error('❌ DexScreener error:', error.message);
    return null;
  }
}

// ============================================
// UPDATE CACHE - FUNÇÃO PRINCIPAL
// ============================================

async function updatePriceCache() {
  if (priceCache.isUpdating) {
    console.log('⏳ Update já em andamento, skip...');
    return;
  }

  priceCache.isUpdating = true;
  const startTime = Date.now();

  try {
    console.log(`\n🔄 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔄 ATUALIZANDO CACHE DE PREÇOS`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const newData = {};

    // Stablecoins instantâneos
    STABLECOINS.forEach(token => {
      newData[token] = {
        price: 1.0,
        change24h: 0,
        source: 'fixed',
        updatedAt: Date.now()
      };
    });

    // Fetch paralelo com timeout
    const [coinGeckoData, orbeData] = await Promise.all([
      fetchCoinGeckoPrices(),
      fetchOrbePrice()
    ]);

    // Merge results
    Object.assign(newData, coinGeckoData);
    if (orbeData) Object.assign(newData, orbeData);

    // Update cache
    priceCache.data = newData;
    priceCache.lastUpdate = Date.now();

    const duration = Date.now() - startTime;
    console.log(`✅ Cache atualizado em ${duration}ms`);
    console.log(`📊 ${Object.keys(newData).length} tokens disponíveis`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  } catch (error) {
    console.error('❌ Erro ao atualizar cache:', error);
  } finally {
    priceCache.isUpdating = false;
  }
}

// ============================================
// AUTO-UPDATE LOOP
// ============================================

async function startAutoUpdate() {
  console.log('🚀 Iniciando auto-update de preços (30s)...');

  // Update imediato
  await updatePriceCache();

  // Loop a cada 30s
  setInterval(async () => {
    await updatePriceCache();
  }, CACHE_DURATION);
}

// ============================================
// API ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'prices-api',
    uptime: process.uptime(),
    lastUpdate: priceCache.lastUpdate,
    tokensAvailable: Object.keys(priceCache.data).length,
    timestamp: Date.now()
  });
});

// Get all prices (cached)
app.get('/api/prices', (req, res) => {
  const cacheAge = priceCache.lastUpdate ? Date.now() - priceCache.lastUpdate : null;

  res.json({
    success: true,
    data: priceCache.data,
    meta: {
      lastUpdate: priceCache.lastUpdate,
      cacheAge: cacheAge,
      tokensCount: Object.keys(priceCache.data).length,
      isUpdating: priceCache.isUpdating
    }
  });
});

// Get specific token price
app.get('/api/prices/:token', (req, res) => {
  const token = req.params.token.toUpperCase();
  const price = priceCache.data[token];

  if (!price) {
    return res.status(404).json({
      success: false,
      error: `Token ${token} not found`,
      availableTokens: Object.keys(priceCache.data)
    });
  }

  res.json({
    success: true,
    token,
    data: price,
    meta: {
      lastUpdate: priceCache.lastUpdate,
      cacheAge: Date.now() - priceCache.lastUpdate
    }
  });
});

// Force refresh (admin only - use API key in production)
app.post('/api/prices/refresh', async (req, res) => {
  // TODO: Add API key validation in production

  await updatePriceCache();

  res.json({
    success: true,
    message: 'Cache refreshed',
    data: priceCache.data,
    timestamp: Date.now()
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, async () => {
  console.log(`\n🚀 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🚀 PRICES API - RUNNING ON PORT ${PORT}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`🌐 Health: /health`);
  console.log(`💰 Prices: /api/prices`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // Start auto-update
  await startAutoUpdate();
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});
