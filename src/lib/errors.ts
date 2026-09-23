/** Expected, user-facing failures (mapped to 4xx by the API layer). */
export class DomainError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
