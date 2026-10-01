// main/apps/server/src/bootstrap/optional-import.ts

function describeImportError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function importOptionalCapability(
  specifier: string,
  capability: string,
): Promise<Record<string, unknown>> {
  try {
    const mod: unknown = await import(specifier);
    if (mod !== null && typeof mod === 'object') {
      return mod as Record<string, unknown>;
    }
    throw new Error(`Module ${specifier} did not resolve to an object`);
  } catch (error) {
    throw new Error(
      `Capability "${capability}" is enabled, but optional module "${specifier}" could not be loaded: ${describeImportError(error)}`,
    );
  }
}
