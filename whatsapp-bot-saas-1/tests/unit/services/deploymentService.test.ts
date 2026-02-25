import { DeploymentService } from '../../../src/services/deploymentService';
import { Deployment } from '../../../src/models/Deployment';

describe('DeploymentService', () => {
    let deploymentService: DeploymentService;

    beforeEach(() => {
        deploymentService = new DeploymentService();
    });

    describe('createDeployment', () => {
        it('should create a new deployment', async () => {
            const mockDeploymentData = {
                botId: '123',
                businessId: '456',
                configuration: { /* configuration details */ },
            };

            const deployment = await deploymentService.createDeployment(mockDeploymentData);
            expect(deployment).toBeInstanceOf(Deployment);
            expect(deployment.botId).toEqual(mockDeploymentData.botId);
            expect(deployment.businessId).toEqual(mockDeploymentData.businessId);
        });
    });

    describe('getDeployment', () => {
        it('should retrieve a deployment by ID', async () => {
            const mockDeploymentId = '789';
            const deployment = await deploymentService.getDeployment(mockDeploymentId);
            expect(deployment).toBeDefined();
            expect(deployment.id).toEqual(mockDeploymentId);
        });
    });

    describe('updateDeployment', () => {
        it('should update an existing deployment', async () => {
            const mockDeploymentId = '789';
            const updateData = { configuration: { /* new configuration details */ } };

            const updatedDeployment = await deploymentService.updateDeployment(mockDeploymentId, updateData);
            expect(updatedDeployment).toBeDefined();
            expect(updatedDeployment.configuration).toEqual(updateData.configuration);
        });
    });

    describe('deleteDeployment', () => {
        it('should delete a deployment by ID', async () => {
            const mockDeploymentId = '789';
            const result = await deploymentService.deleteDeployment(mockDeploymentId);
            expect(result).toBeTruthy();
        });
    });
});