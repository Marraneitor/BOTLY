import { Request, Response } from 'express';
import { BusinessService } from '../services/businessService';

export class BusinessController {
    private businessService: BusinessService;

    constructor() {
        this.businessService = new BusinessService();
    }

    public async createBusiness(req: Request, res: Response): Promise<void> {
        try {
            const businessData = req.body;
            const newBusiness = await this.businessService.createBusiness(businessData);
            res.status(201).json(newBusiness);
        } catch (error) {
            res.status(500).json({ message: 'Error creating business', error });
        }
    }

    public async getBusiness(req: Request, res: Response): Promise<void> {
        try {
            const businessId = req.params.id;
            const business = await this.businessService.getBusiness(businessId);
            if (business) {
                res.status(200).json(business);
            } else {
                res.status(404).json({ message: 'Business not found' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error fetching business', error });
        }
    }

    public async updateBusiness(req: Request, res: Response): Promise<void> {
        try {
            const businessId = req.params.id;
            const updatedData = req.body;
            const updatedBusiness = await this.businessService.updateBusiness(businessId, updatedData);
            if (updatedBusiness) {
                res.status(200).json(updatedBusiness);
            } else {
                res.status(404).json({ message: 'Business not found' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error updating business', error });
        }
    }

    public async deleteBusiness(req: Request, res: Response): Promise<void> {
        try {
            const businessId = req.params.id;
            const deleted = await this.businessService.deleteBusiness(businessId);
            if (deleted) {
                res.status(204).send();
            } else {
                res.status(404).json({ message: 'Business not found' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error deleting business', error });
        }
    }
}