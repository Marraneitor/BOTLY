import { Router } from 'express';
import { BotController } from '../controllers/botController';
import { authMiddleware } from '../middleware/auth';
import { botValidator } from '../validators/botValidator';

const router = Router();
const botController = new BotController();

// Route to create a new bot
router.post('/create', authMiddleware, botValidator, botController.createBot);

// Route to update an existing bot
router.put('/update/:id', authMiddleware, botValidator, botController.updateBot);

// Route to delete a bot
router.delete('/delete/:id', authMiddleware, botController.deleteBot);

// Route to get bot details
router.get('/:id', authMiddleware, botController.getBotDetails);

// Route to list all bots for the authenticated user
router.get('/', authMiddleware, botController.listBots);

export default router;