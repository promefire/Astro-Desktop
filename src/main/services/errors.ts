export class ServiceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ServiceError'
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}
