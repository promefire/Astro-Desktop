import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }

const buttonVariants = cva('button', {
  variants: {
    variant: { primary: 'button-primary', secondary: 'button-secondary', ghost: 'button-ghost' },
    size: { default: '', small: 'button-small', icon: 'button-icon' },
  },
  defaultVariants: { variant: 'secondary', size: 'default' },
})

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Component = asChild ? Slot : 'button'
  return <Component className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
})
Button.displayName = 'Button'

export function Badge({ className, children, tone = 'neutral' }: { className?: string; children: React.ReactNode; tone?: 'neutral' | 'accent' | 'warning' }) {
  return <span className={cn('badge', `badge-${tone}`, className)}>{children}</span>
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn('input', className)} {...props} />)
Input.displayName = 'Input'
