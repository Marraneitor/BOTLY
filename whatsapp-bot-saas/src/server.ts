import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { app } from './app';

const PORT = process.env.PORT || 3000;

const server = createServer(app);

// ─── Socket.io Setup ───────────────────────────────────
const io = new SocketServer(server, {
    cors: { origin: '*' }
});

io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
        console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
});

// Export io so other modules (e.g. whatsappService) can emit events
export { io };

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});