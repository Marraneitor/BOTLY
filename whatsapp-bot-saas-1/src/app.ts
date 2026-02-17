import express from 'express';
import { connectToDatabase } from './config/database';
import { setupRoutes } from './routes/index';
import { errorHandler } from './middleware/errorHandler';
import { rateLimiter } from './middleware/rateLimiter';
import { env } from './config/env';

const app = express();

// Middleware
app.use(express.json());
app.use(rateLimiter);

// Connect to the database
connectToDatabase();

// Setup routes
setupRoutes(app);

// Error handling middleware
app.use(errorHandler);

export default app;