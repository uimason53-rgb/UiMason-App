import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const validateJwt = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ message: 'Authorization header is missing' });
    return;
  }

  const parts = authHeader.split(' ');

  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    res.status(401).json({ message: 'Authorization header must be in the format: Bearer <token>' });
    return;
  }

  const token = parts[1];

  if (!token) {
    res.status(401).json({ message: 'Token is missing' });
    return;
  }

  const secret = process.env.JWT_SECRET;

  if (!secret) {
    console.error('JWT_SECRET environment variable is not set');
    res.status(500).json({ message: 'Internal server error' });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({ message: 'Token has expired' });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ message: 'Invalid token' });
      return;
    }

    console.error('JWT validation error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export default validateJwt;