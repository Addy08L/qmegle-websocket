const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const uuid = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let onlineUsers = 0;
const waitingRoom = [];
const activeConnections = new Map();

// User session management
class UserSession {
  constructor(ws, interests = [], strictMatch = false) {
    this.id = uuid.v4();
    this.ws = ws;
    this.interests = interests;
    this.strictMatch = strictMatch;
    this.partner = null;
    this.lastMessageTime = 0;
    this.messageCount = 0;
  }
}

// Matchmaking system
function findMatch(newUser) {
  for (let user of waitingRoom) {
    if (user.id === newUser.id) continue;
    
    if (newUser.strictMatch || user.strictMatch) {
      const commonInterests = newUser.interests.filter(interest => 
        user.interests.includes(interest)
      );
      if (commonInterests.length === 0) continue;
    }

    return user;
  }
  return null;
}

wss.on('connection', (ws) => {
  onlineUsers++;
  const user = new UserSession(ws);
  activeConnections.set(user.id, user);

  // Send initial connection data
  ws.send(JSON.stringify({
    type: 'init',
    userId: user.id,
    onlineUsers
  }));

  ws.on('message', (data) => {
    const message = JSON.parse(data);
    
    switch(message.type) {
      case 'start-chat':
        user.interests = message.interests;
        user.strictMatch = message.strictMatch;
        waitingRoom.push(user);
        process.nextTick(() => matchUsers(user));
        break;

      case 'message':
        handleMessage(user, message);
        break;

      case 'typing':
        if (user.partner) {
          activeConnections.get(user.partner).ws.send(JSON.stringify({
            type: 'typing',
            isTyping: message.isTyping
          }));
        }
        break;

      case 'disconnect':
        handleDisconnect(user);
        break;
    }
  });

  ws.on('close', () => {
    onlineUsers--;
    handleDisconnect(user);
    activeConnections.delete(user.id);
  });
});

function matchUsers(user) {
  const partner = findMatch(user);
  if (!partner) return;

  // Remove both users from waiting room
  waitingRoom.splice(waitingRoom.indexOf(user), 1);
  waitingRoom.splice(waitingRoom.indexOf(partner), 1);

  // Create chat room
  user.partner = partner.id;
  partner.partner = user.id;

  // Notify both users
  user.ws.send(JSON.stringify({
    type: 'matched',
    partnerId: partner.id
  }));

  partner.ws.send(JSON.stringify({
    type: 'matched',
    partnerId: user.id
  }));
}

function handleMessage(sender, message) {
  // Spam protection
  const now = Date.now();
  if (now - sender.lastMessageTime < 1000) return;
  if (sender.messageCount++ > 30) {
    sender.ws.close();
    return;
  }
  sender.lastMessageTime = now;

  // Message validation
  if (message.text.length > 500 || containsBannedWords(message.text)) return;

  if (sender.partner && activeConnections.has(sender.partner)) {
    activeConnections.get(sender.partner).ws.send(JSON.stringify({
      type: 'message',
      text: message.text,
      sender: sender.id
    }));
  }
}

function handleDisconnect(user) {
  if (user.partner && activeConnections.has(user.partner)) {
    activeConnections.get(user.partner).ws.send(JSON.stringify({
      type: 'disconnect'
    }));
    activeConnections.get(user.partner).partner = null;
  }
  if (user.ws.readyState === WebSocket.OPEN) {
    user.ws.close();
  }
}

function containsBannedWords(text) {
  const bannedWords = ['badword', 'inappropriate', 'spam'];
  return bannedWords.some(word => text.toLowerCase().includes(word));
}

server.listen(process.env.PORT || 8080, () => {
  console.log(`Server running on port ${process.env.PORT || 8080}`);
});
