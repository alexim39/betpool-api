// Type helper for Mongoose 8 lean queries
// Mongoose 8 returns FlattenMaps<T> from .lean() which TypeScript doesn't automatically cast to T

// Type assertion helper for Mongoose lean queries
export function toLeanArray<T>(promise: Promise<any>): Promise<any[]> {
  return promise as unknown as Promise<any[]>;
}

export function toLean<T>(promise: Promise<any>): Promise<any | null> {
  return promise as unknown as Promise<any | null>;
}