// server.js

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = process.env.PORT || 3000;

// Serve static files from the "public" folder
app.use(express.static('public'));

app.get('/', (req, res) => { 
  res.sendFile(__dirname + '/public/index.html'); 
});
app.get('/choose', (req, res) => { 
  res.sendFile(__dirname + '/public/choose.html'); 
});
app.get('/chat', (req, res) => { 
  res.sendFile(__dirname + '/public/chat.html'); 
});

// In-memory store for each room’s messages' reactions
// Structure: roomReactions[roomCode][messageId] = { [username]: emoji }
const roomReactions = {};

// Message ID counter
let nextMessageId = 1;

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Host a room
  socket.on('host-room', (data) => {
    const roomCode = Math.floor(10000000 + Math.random() * 90000000).toString();
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.isHost = true;
    socket.username = data.username;
    
    // Initialize reaction store for the room
    roomReactions[roomCode] = {};
    
    socket.emit('room-hosted', roomCode);
    console.log(`Room hosted by ${socket.username}, code: ${roomCode}`);
  });

  // Join an existing room
  socket.on('join-room', (data) => {
    const roomCode = data.roomCode;
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.username = data.username;
    
    if (!roomReactions[roomCode]) {
      roomReactions[roomCode] = {};
    }
    
    // Broadcast a system message that the user joined
    const timestamp = Date.now();
    io.to(roomCode).emit('chat-message', {
      id: Date.now().toString(),
      username: 'System',
      message: `${socket.username} has joined the room.`,
      isSystem: true,
      timestamp: timestamp
    });
    console.log(`${socket.username} joined room ${roomCode}`);
  });

  // Regular chat message
  socket.on('chat-message', (message) => {
    const timestamp = Date.now();
    const messageId = (nextMessageId++).toString();
    io.to(socket.roomCode).emit('chat-message', {
      id: messageId,
      username: socket.username,
      message: message,
      isSystem: false,
      timestamp: timestamp
    });
  });

  // Typing indicator events
  socket.on('typing', () => {
    // Broadcast typing event to others in the room
    socket.to(socket.roomCode).emit('typing', { username: socket.username });
  });
  
  socket.on('stop-typing', () => {
    // Broadcast stop-typing event to others in the room
    socket.to(socket.roomCode).emit('stop-typing', { username: socket.username });
  });

  // Handle message reactions (one reaction per user per message)
  socket.on('message-reaction', (data) => {
    const roomCode = socket.roomCode;
    const { messageId, reaction } = data;

    if (!roomReactions[roomCode]) {
      roomReactions[roomCode] = {};
    }
    if (!roomReactions[roomCode][messageId]) {
      roomReactions[roomCode][messageId] = {};
    }

    // Overwrite any previous reaction by the same user
    roomReactions[roomCode][messageId][socket.username] = reaction;

    // Aggregate reaction counts for that message
    const aggregated = {};
    for (const user in roomReactions[roomCode][messageId]) {
      const r = roomReactions[roomCode][messageId][user];
      aggregated[r] = (aggregated[r] || 0) + 1;
    }

    // Broadcast updated reaction counts
    io.to(roomCode).emit('message-reaction-update', {
      messageId,
      reactions: aggregated
    });
  });

  // Leave room for non-host users
  socket.on('leave-room', () => {
    if (!socket.isHost) {
      const roomCode = socket.roomCode;
      const username = socket.username;
      const timestamp = Date.now();
      io.to(roomCode).emit('chat-message', {
        id: Date.now().toString(),
        username: 'System',
        message: `${username} has left the room.`,
        isSystem: true,
        timestamp: timestamp
      });
      socket.leave(roomCode);
      console.log(`${username} left room ${roomCode}`);
    }
  });

  // Host closes the room
  socket.on('close-room', () => {
    if (socket.isHost) {
      const roomCode = socket.roomCode;
      io.to(roomCode).emit('room-closed');
      io.in(roomCode).fetchSockets().then(sockets => {
        sockets.forEach(s => s.leave(roomCode));
      });
      console.log(`Room ${roomCode} closed by host.`);
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

http.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});