import "server-only";

export const ACCOUNT_DELETION_CONFIRMATION = "delete my skillmap account";

export function hasExactAccountDeletionConfirmation(formData: FormData): boolean {
  const values = formData.getAll("confirmation");
  return values.length === 1 && values[0] === ACCOUNT_DELETION_CONFIRMATION;
}
