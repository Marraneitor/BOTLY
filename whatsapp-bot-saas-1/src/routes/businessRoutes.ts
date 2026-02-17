import { Router } from 'express';
import { BusinessController } from '../controllers/businessController';
import { authMiddleware } from '../middleware/auth';
import { businessValidator } from '../validators/businessValidator';

const router = Router();
const businessController = new BusinessController();

// Route to create a new business configuration
router.post('/', authMiddleware, businessValidator, businessController.createBusiness);

// Route to get all business configurations for the authenticated user
router.get('/', authMiddleware, businessController.getAllBusinesses);

// Route to get a specific business configuration by ID
router.get('/:id', authMiddleware, businessController.getBusinessById);

// Route to update a specific business configuration by ID
router.put('/:id', authMiddleware, businessValidator, businessController.updateBusiness);

// Route to delete a specific business configuration by ID
router.delete('/:id', authMiddleware, businessController.deleteBusiness);

export default router;