import { Request, Response } from 'express';
import { DeploymentService } from '../services/deploymentService';

export class DeploymentController {
    private deploymentService: DeploymentService;

    constructor() {
        this.deploymentService = new DeploymentService();
    }

    public async deployBot(req: Request, res: Response): Promise<void> {
        try {
            const { botId, userId } = req.body;
            const deployment = await this.deploymentService.deployBot(botId, userId);
            res.status(201).json(deployment);
        } catch (error) {
            res.status(500).json({ message: 'Deployment failed', error: error.message });
        }
    }

    public async getDeployments(req: Request, res: Response): Promise<void> {
        try {
            const { userId } = req.params;
            const deployments = await this.deploymentService.getDeploymentsByUser(userId);
            res.status(200).json(deployments);
        } catch (error) {
            res.status(500).json({ message: 'Failed to retrieve deployments', error: error.message });
        }
    }

    public async deleteDeployment(req: Request, res: Response): Promise<void> {
        try {
            const { deploymentId } = req.params;
            await this.deploymentService.deleteDeployment(deploymentId);
            res.status(204).send();
        } catch (error) {
            res.status(500).json({ message: 'Failed to delete deployment', error: error.message });
        }
    }
}