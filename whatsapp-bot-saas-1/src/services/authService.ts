import { User } from '../models/User';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const saltRounds = 10;

export const registerUser = async (userData) => {
    const hashedPassword = await bcrypt.hash(userData.password, saltRounds);
    const newUser = new User({
        ...userData,
        password: hashedPassword,
    });
    return await newUser.save();
};

export const loginUser = async (email, password) => {
    const user = await User.findOne({ email });
    if (!user) {
        throw new Error('User not found');
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        throw new Error('Invalid credentials');
    }
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
    return { token, user };
};

export const getUserById = async (userId) => {
    return await User.findById(userId);
};