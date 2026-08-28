export class AclError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AclError";
    this.status = status;
  }
}

export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}
