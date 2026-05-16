/**
 * events.js — WebSocket event name constants.
 * Using constants prevents typos and enables autocomplete.
 */
module.exports = {
  // Room / Lobby events
  ROOM_CREATE:    'room:create',
  ROOM_JOIN:      'room:join',
  ROOM_LEAVE:     'room:leave',
  ROOM_LIST:      'room:list',
  ROOM_UPDATED:   'room:updated',
  ROOM_GAME_START:'room:gameStart',
  ROOM_KICKED:    'room:kicked',

  // Game events
  GAME_COMMAND:       'game:command',
  GAME_READY:         'game:ready',
  GAME_PHASE_START:   'game:phaseStart',
  GAME_PULSE_RESULT:  'game:pulseResult',
  GAME_ENDED:         'game:ended',
  GAME_STATE_SYNC:    'game:stateSync',

  // Chat
  CHAT_MESSAGE:   'chat:message',

  // System
  ERROR:          'error',
  PLAYER_INFO:    'player:info',
};
