import type { Request, Response, NextFunction } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    roles: string[];
  };
}

/**
 * Middleware to require authentication
 * Expects user info to be passed via headers from API gateway/auth service
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const userId = req.headers['x-user-id'] as string;
  const userEmail = req.headers['x-user-email'] as string;
  const userRoles = req.headers['x-user-roles'] as string;

  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  req.user = {
    id: userId,
    email: userEmail || '',
    roles: userRoles ? userRoles.split(',') : [],
  };

  next();
}

/**
 * Middleware to require specific permission/role
 */
export function requirePermission(...requiredRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const hasPermission = requiredRoles.some((role) =>
      req.user!.roles.includes(role)
    );

    if (!hasPermission) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}

/**
 * Middleware to optionally extract user info if present
 */
export function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const userId = req.headers['x-user-id'] as string;
  const userEmail = req.headers['x-user-email'] as string;
  const userRoles = req.headers['x-user-roles'] as string;

  if (userId) {
    req.user = {
      id: userId,
      email: userEmail || '',
      roles: userRoles ? userRoles.split(',') : [],
    };
  }

  next();
}
