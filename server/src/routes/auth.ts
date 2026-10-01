import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma';
import { supabase } from '../supabase';
import { hashPassword, verifyPassword, newToken, sessionExpiry, requireAuth, audit, type AuthenticatedRequest } from '../auth';

const router = Router();

const signupSchema = z.object({
  name: z.string().trim().min(2, 'Please enter your full name (min 2 characters).'),
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  role: z.enum(['INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF', 'NGO']).optional().default('INSTITUTION_ADMIN'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.'),
  password: z.string().min(1, 'Please enter your password.'),
});

function zodError(res: import('express').Response, err: z.ZodError) {
  const first = err.errors[0];
  return res.status(400).json({ error: first?.message ?? 'Please check the form and try again.', details: err.errors });
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const { name, email, password, role } = parsed.data;
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Try logging in or use forgot password.' });
    }
    const passwordHash = await hashPassword(password);
    const assignedRole = role ?? 'INSTITUTION_ADMIN';

    // Register user in Supabase Auth when configured (visible in Supabase Dashboard -> Authentication -> Users)
    if (supabase) {
      try {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name, role: assignedRole },
          },
        });
        if (error) console.warn('Supabase Auth registration notice:', error.message);
      } catch (sbErr) {
        console.warn('Supabase Auth registration notice:', sbErr);
      }
    }

    // Save user in Supabase PostgreSQL database
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: assignedRole,
        emailVerified: true,
        verificationToken: null,
      },
    });

    await audit('user.signup', { userId: user.id, entityType: 'User', entityId: user.id, metadata: { email, role: assignedRole } });
    return res.status(201).json({
      message: 'Account created successfully! Please log in with your email and password.',
      userId: user.id,
    });
  } catch {
    return res.status(500).json({ error: 'Could not create account. Please try again.' });
  }
});

// POST /api/auth/verify (noop for backwards compatibility)
router.post('/verify', async (req, res) => {
  return res.json({ message: 'Email verified. You can now log in.' });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const { email, password } = parsed.data;
  let user = await prisma.user.findUnique({ where: { email } });

  // If not found in Prisma, try signing in with Supabase Auth in case created via Supabase dashboard
  if (!user && supabase) {
    try {
      const { data: sbData, error: sbError } = await supabase.auth.signInWithPassword({ email, password });
      if (!sbError && sbData?.user) {
        const passwordHash = await hashPassword(password);
        const allowedRoles = ['INSTITUTION_ADMIN', 'KITCHEN_MANAGER', 'STAFF', 'NGO'] as const;
        const metaRole = sbData.user.user_metadata?.role;
        const safeRole = (allowedRoles as readonly string[]).includes(metaRole) ? metaRole : 'INSTITUTION_ADMIN';
        // Never trust Supabase UUID as local PK (local IDs are cuid). Let Prisma generate the id.
        user = await prisma.user.create({
          data: {
            email,
            passwordHash,
            name: sbData.user.user_metadata?.name || email.split('@')[0],
            role: safeRole,
            emailVerified: true,
          },
        });
      }
    } catch {
      // ignore
    }
  }

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (!user.emailVerified) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verificationToken: null },
    });
  }
  const token = newToken(32);
  await prisma.session.create({
    data: { token, userId: user.id, expiresAt: sessionExpiry() },
  });
  await audit('user.login', { userId: user.id });
  return res.json({ message: 'Signed in successfully.', token });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (req.sessionToken) {
      await prisma.session.deleteMany({ where: { token: req.sessionToken } });
    }
    await audit('user.logout', { userId: req.userId });
    return res.json({ message: 'Signed out. Session ended.' });
  } catch {
    return res.status(500).json({ error: 'Could not sign out.' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId! },
    include: {
      organization: {
        include: { kitchens: true, profile: true },
      },
      ngoOrganization: {
        select: { id: true, name: true },
      },
    },
  });
  if (!user) return res.status(401).json({ error: 'Account not found.' });
  const { passwordHash: _ph, verificationToken: _vt, resetToken: _rt, ...safe } = user;
  return res.json({ user: safe });
});

// POST /api/auth/forgot
router.post('/forgot', async (req, res) => {
  const schema = z.object({ email: z.string().trim().toLowerCase().email('Please enter a valid email address.') });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  // Always respond OK to avoid account enumeration, but only create token if user exists.
  if (user) {
    const resetToken = newToken(24);
    const resetExpiresAt = new Date(Date.now() + 2 * 3600 * 1000);
    await prisma.user.update({ where: { id: user.id }, data: { resetToken, resetExpiresAt } });
    await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        title: 'Password reset',
        body: `Use this password-reset token within 2 hours: ${resetToken}.`,
        token: resetToken,
      },
    });
    await audit('user.forgot', { userId: user.id });
    return res.json({
      message: 'If an account exists for that email, a password reset request has been processed.',
      ...(process.env.NODE_ENV === 'test' ? { debugToken: resetToken } : {}),
    });
  }
  return res.json({ message: 'If an account exists for that email, a password reset request has been processed.' });
});

// POST /api/auth/reset
router.post('/reset', async (req, res) => {
  const schema = z.object({
    token: z.string().trim().min(10, 'Reset token is required.'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters.'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  const user = await prisma.user.findUnique({ where: { resetToken: parsed.data.token } });
  if (!user || !user.resetExpiresAt || user.resetExpiresAt.getTime() < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired reset token. Request a new one.' });
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, resetToken: null, resetExpiresAt: null },
  });
  // End all sessions for safety
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await audit('user.reset', { userId: user.id });
  return res.json({ message: 'Password updated. Please log in with your new password.' });
});

export default router;
