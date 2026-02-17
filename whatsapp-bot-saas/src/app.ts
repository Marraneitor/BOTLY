import express from 'express';
import path from 'path';
import { connectToDatabase } from './config/database';
import setupRoutes from './routes/index';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { env } from './config/env';

const app = express();

// Middleware
app.use(express.json());
app.use(rateLimiter);

// Serve static frontend files (dashboard)
app.use(express.static(path.join(__dirname, 'public')));

// Connect to the database
connectToDatabase();

// Setup routes
setupRoutes(app);

// SPA fallback — serve index.html for non-API routes
app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use(errorHandler);

export { app };