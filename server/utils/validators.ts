import { z } from 'zod'

/** Request schemas, auto-imported into server routes. */

export const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200)
})

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required')
})

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Enter a valid hex color')

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1, 'Workspace name is required').max(80),
  widgetPrimaryColor: hexColor.optional(),
  logoUrl: z.string().url().nullish()
})

export const invitesSchema = z.object({
  invites: z.array(z.object({
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    role: z.enum(['admin', 'agent']).default('agent')
  })).min(1, 'Add at least one teammate').max(20)
})
