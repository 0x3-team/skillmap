export class CatalogInputError extends Error {
  readonly code: "INVALID_QUERY" | "INVALID_CURSOR";

  constructor(code: "INVALID_QUERY" | "INVALID_CURSOR", message: string) {
    super(message);
    this.name = "CatalogInputError";
    this.code = code;
  }
}

export class CatalogDataError extends Error {
  readonly code = "CATALOG_DATA_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "CatalogDataError";
  }
}

export const MAX_PUBLIC_SKILL_RELATIONSHIPS = 100;

export function assertPublicSkillRelationshipLimit(rows: readonly unknown[]): void {
  if (rows.length > MAX_PUBLIC_SKILL_RELATIONSHIPS) {
    throw new CatalogDataError("Published relationships exceed the hosted skill contract limit.");
  }
}

export class CatalogQueryError extends Error {
  readonly code = "CATALOG_QUERY_FAILED";

  constructor(message = "The hosted catalog query failed.") {
    super(message);
    this.name = "CatalogQueryError";
  }
}
