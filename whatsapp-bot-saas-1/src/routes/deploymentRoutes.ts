import { Router } from 'express';
import { DeploymentController } from '../controllers/deploymentController';
import { auth } from '../middleware/auth';

const router = Router();
const deploymentController = new DeploymentController();

// Route to deploy a bot
router.post('/deploy', auth, deploymentController.deployBot);

// Route to get deployment status
router.get('/status/:id', auth, deploymentController.getDeploymentStatus);

// Route to list all deployments for a user
router.get('/', auth, deploymentController.listDeployments);

export default router;