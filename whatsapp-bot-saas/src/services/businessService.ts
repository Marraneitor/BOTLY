import { Business } from '../models/Business';

export class BusinessService {
    async createBusiness(data: any): Promise<Business> {
        const business = new Business(data);
        return await business.save();
    }

    async getBusinessById(businessId: string): Promise<Business | null> {
        return await Business.findById(businessId);
    }

    async updateBusiness(businessId: string, data: any): Promise<Business | null> {
        return await Business.findByIdAndUpdate(businessId, data, { new: true });
    }

    async deleteBusiness(businessId: string): Promise<Business | null> {
        return await Business.findByIdAndDelete(businessId);
    }

    async getAllBusinesses(): Promise<Business[]> {
        return await Business.find();
    }
}