export function removeEmptyParams<T extends Record<string, any>>(
  obj: T
): Partial<T> {
  const newObj: Partial<T> = {};
  for (const key in obj) {
    if (obj[key] !== null && obj[key] !== undefined) {
      newObj[key] = obj[key];
    }
  }
  return newObj;
}

/**
 * Normalizes temperature for providers that expect a 0-1 range
 * if the input is 0-2. This was specific to Bedrock's handling.
 * Other models might need different normalization.
 */
export function normalizeTemperature(temperature?: number): number | undefined {
  if (temperature === undefined) {
    return undefined;
  }
  // This logic was specific to Bedrock: if temperature > 1, assume it's on a 0-2 scale.
  // For now, keeping it simple. If a more general approach is needed, this should be revisited.
  if (temperature > 1.0 && temperature <= 2.0) {
    // Only scale if it seems to be on 0-2 range
    return temperature / 2;
  }
  return temperature; // Assume 0-1 or other scale, pass through
}

export function consoleWarn(message: string): void {
  console.warn(`Warning: ${message}`);
}

export function isObject(variable: any): boolean {
  return (
    typeof variable === "object" &&
    variable !== null &&
    !Array.isArray(variable)
  );
}

export function isEmptyObject(obj: any): boolean {
  if (!isObject(obj)) {
    return false; // Or true, depending on how you want to treat non-objects
  }
  return Object.keys(obj).length === 0;
}
