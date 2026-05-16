const io = require('socket.io-client');
const fetch = require('node-fetch');

const users = ['sekartav', 'mcodel', 'msirac', 'edpolat'];
const clients = [];

async function loginAndConnect(username) {
  // 1. Send direct login POST request
  const res = await fetch('http://localhost:3000/auth/42/direct-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: username })
  });
  
  // 2. Extract session cookie (connect.sid)
  const rawCookie = res.headers.raw()['set-cookie'];
  const cookieStr = rawCookie ? rawCookie[0].split(';')[0] : '';
  
  // Add a small delay to ensure SQLite has finished writing the session
  await new Promise(r => setTimeout(r, 500));

  // 3. Connect Socket.IO using the session cookie
  const socket = io('http://localhost:3000', {
    extraHeaders: {
      cookie: cookieStr
    }
  });

  return new Promise((resolve, reject) => {
    socket.on('connect', () => {
      console.log(`✅ [${username}] Sunucuya bağlandı (Socket ID: ${socket.id})`);
      resolve({ username, socket });
    });
    socket.on('connect_error', (err) => {
      console.error(`❌ [${username}] Socket bağlantı hatası: ${err.message}`);
    });
  });
}

async function runTest() {
  console.log('🚀 4 Kişilik Oyun Testi Başlıyor...\n');
  
  for (const u of users) {
    const client = await loginAndConnect(u);
    clients.push(client);
  }

  // 1. Oyuncu (sekartav) oda kuruyor
  console.log('\n🏠 sekartav oda kuruyor...');
  const p1 = clients[0].socket;
  p1.emit('room:create', { name: '42 Game Jam Final' });

  let roomId = null;

  p1.on('room:updated', (room) => {
    if (room.playerCount === 1 && !roomId) {
      roomId = room.id;
      console.log(`🎯 Oda oluşturuldu! Kodu: ${room.id}. Diğer oyuncular katılıyor...`);
      
      // Diğer 3 oyuncuyu odaya al
      for (let i = 1; i < 4; i++) {
        clients[i].socket.emit('room:join', { roomId: room.id });
      }
    }
  });

  // Oyunun başlama event'ini dinle
  for (const client of clients) {
    client.socket.on('room:gameStart', (data) => {
      console.log(`🔥 [${client.username}] GameStart sinyalini aldı! Oyun Evresi: ${data.gameState.phase}`);
      
      // Test başarılı olursa çıkış yap
      if (client.username === 'sekartav') {
        console.log('\n🎉 TEST BAŞARILI! 4 oyuncu başarıyla odaya bağlandı ve oyun döngüsü başladı.');
        setTimeout(() => process.exit(0), 1000);
      }
    });
  }
}

// Hata ayıklama
setTimeout(() => {
  console.log('❌ Timeout! Oyun başlayamadı.');
  process.exit(1);
}, 30000);

runTest();
