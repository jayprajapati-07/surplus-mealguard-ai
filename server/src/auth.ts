import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from './prisma';

export type Role = 'SUPER_ADMIN' | 'INSTITUTION_ADMIN' | 'KITCHEN_MANAGER' | 'STAFF' | 'NGO';

export function newToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function sessionExpiry(): Date {
  const hours = Number(process.env.SESSION_TTL_HOURS ?? 72);
  return new Date(Date.now() + hours * 3600 * 1000);
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRole?: Role;
  sessionToken?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  currentUser?: any;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    // also support x-session-token header for simplicity
    const token = bearer ?? (req.headers['x-session-token'] as string | undefined) ?? null;
    if (!token) {
      return res.status(401).json({ error: 'Not signed in. Please log in.' });
    }
    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }
    if (session.expiresAt.getTime() < Date.now()) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    req.userId = session.userId;
    req.userRole = session.user.role as Role;
    req.sessionToken = token;
    req.currentUser = session.user;
    return next();
  } catch {
    return res.status(500).json({ error: 'Authentication check failed.' });
  }
}

export function requireRole(...allowed: Role[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.userRole) {
      return res.status(401).json({ error: 'Not signed in.' });
    }
    if (!allowed.includes(req.userRole)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    return next();
  };
}

export async function audit(action: string, opts: { userId?: string; organizationId?: string; entityType?: string; entityId?: string; metadata?: unknown }) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        userId: opts.userId,
        organizationId: opts.organizationId,
        entityType: opts.entityType,
        entityId: opts.entityId,
        metadataJson: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
      },
    });
  } catch {
    // audit must never break the request
  }
}
