const io = require('socket.io-client');
const fetch = require('node-fetch');

const bots = ['mcodel', 'msirac', 'edpolat'];

async function startBots() {
  console.log('Botlar 8 saniye bekliyor (senin oda kurman için)...');
  await new Promise(r => setTimeout(r, 8000));

  for (const botName of bots) {
    const res = await fetch('http://localhost:3000/auth/42/direct-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: botName })
    });
    
    const rawCookie = res.headers.raw()['set-cookie'];
    const cookieStr = rawCookie ? rawCookie[0].split(';')[0] : '';
    await new Promise(r => setTimeout(r, 500));
    
    const socket = io('http://localhost:3000', { extraHeaders: { cookie: cookieStr } });
    
    socket.on('connect', () => {
      console.log(`🤖 Bot ${botName} bağlandı.`);
      
      // Odayı bulup katıl
      socket.on('room:list', (rooms) => {
        if (rooms.length > 0) {
          socket.emit('room:join', { roomId: rooms[0].id });
          console.log(`🤖 Bot ${botName} ${rooms[0].name} odasına katıldı.`);
        }
      });
    });
    
    // Her bot arası biraz bekle (gerçekçi olsun)
    await new Promise(r => setTimeout(r, 1500));
  }
}

startBots();
